/**
 * Google Identity Services (GIS) token client wrapper (WP-10).
 *
 * Design constraints (IMPLEMENTATION_PLAN.md WP-10 / HANDOVER.md invariant 8):
 *  - Request exactly the `drive.file` scope, nothing broader.
 *  - Never call any Google API before a user gesture (signIn() is that
 *    gesture; nothing here runs at import/module-init time).
 *  - Never persist the access token to localStorage/sessionStorage/IndexedDB
 *    - it lives only in the closure below, for the life of the tab.
 *
 * Testability: the real GIS script/global is swapped out via `deps` (same
 * injected-adapter shape as domain's Clock/Rng), so unit tests exercise the
 * exact state machine (signed-out -> signed-in -> token-expired-refresh ->
 * revoked) without touching `window.google` or the network at all.
 */
import { ReAuthRequiredError } from "./errors.ts";
import { loadScriptOnce } from "./google-loader.ts";
import type { GoogleTokenClient, GoogleTokenResponse } from "./google-globals.ts";

/** The only scope this app is ever allowed to request (invariant 8). */
export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";

/** Refresh a bit before real expiry so an in-flight request never races the clock. */
const EXPIRY_SAFETY_MARGIN_MS = 60_000;

export type AuthState = "signed-out" | "signed-in";

export interface GoogleAuthDeps {
  /** Creates (or reuses) a token client. Only ever invoked from signIn()/a refresh triggered by a prior signIn(). */
  createTokenClient(
    callback: (response: GoogleTokenResponse) => void,
  ): Promise<GoogleTokenClient>;
  /** Best-effort revoke of an access token. Failures are swallowed by signOut(). */
  revoke(accessToken: string): Promise<void>;
  /** Injected for deterministic tests; defaults to Date.now. */
  now(): number;
}

export interface GoogleAuth {
  signIn(): Promise<void>;
  signOut(): Promise<void>;
  /**
   * Returns a currently-valid access token, transparently refreshing if the
   * cached one is near expiry. Throws ReAuthRequiredError if the user has
   * never signed in, or if silent refresh fails (session revoked elsewhere,
   * consent withdrawn, etc.) - callers must not retry this themselves, only
   * route the user back to a signIn() button.
   */
  getAccessToken(): Promise<string>;
  /**
   * Marks the cached token (if any) as unusable without attempting a
   * network call - the Sheets transport calls this after an unexpected 401
   * so the *next* getAccessToken() is forced to refresh instead of handing
   * back the same rejected token again.
   */
  invalidate(): void;
  state(): AuthState;
  subscribe(listener: (state: AuthState) => void): () => void;
}

function createRealGoogleAuthDeps(clientId: string): GoogleAuthDeps {
  return {
    async createTokenClient(callback) {
      await loadScriptOnce("https://accounts.google.com/gsi/client");
      const oauth2 = window.google?.accounts?.oauth2;
      if (!oauth2) {
        throw new Error("Google Identity Services script loaded but window.google.accounts.oauth2 is missing.");
      }
      return oauth2.initTokenClient({
        client_id: clientId,
        scope: DRIVE_FILE_SCOPE,
        callback,
      });
    },
    async revoke(accessToken) {
      const oauth2 = window.google?.accounts?.oauth2;
      if (!oauth2) return;
      await new Promise<void>((resolve) => oauth2.revoke(accessToken, () => resolve()));
    },
    now: () => Date.now(),
  };
}

interface TokenState {
  readonly accessToken: string;
  readonly expiresAt: number;
}

/**
 * Creates the auth state machine. `deps` defaults to the real GIS-backed
 * implementation (production); tests pass a fake so no script is ever loaded
 * and no network call is ever made.
 */
export function createGoogleAuth(clientId: string, deps: GoogleAuthDeps = createRealGoogleAuthDeps(clientId)): GoogleAuth {
  let token: TokenState | undefined;
  let tokenClient: GoogleTokenClient | undefined;
  let pendingCallback: ((response: GoogleTokenResponse) => void) | undefined;
  const listeners = new Set<(state: AuthState) => void>();

  function currentState(): AuthState {
    return token ? "signed-in" : "signed-out";
  }

  function notify(): void {
    const state = currentState();
    for (const listener of listeners) listener(state);
  }

  async function ensureTokenClient(): Promise<GoogleTokenClient> {
    if (tokenClient) return tokenClient;
    tokenClient = await deps.createTokenClient((response) => {
      const callback = pendingCallback;
      pendingCallback = undefined;
      callback?.(response);
    });
    return tokenClient;
  }

  function requestToken(client: GoogleTokenClient, options?: { prompt?: string }): Promise<TokenState> {
    return new Promise<TokenState>((resolve, reject) => {
      pendingCallback = (response) => {
        if (response.error || !response.access_token) {
          reject(new ReAuthRequiredError(response.error_description ?? response.error ?? "Google did not return an access token."));
          return;
        }
        const expiresIn = response.expires_in ?? 3600;
        resolve({
          accessToken: response.access_token,
          expiresAt: deps.now() + expiresIn * 1000 - EXPIRY_SAFETY_MARGIN_MS,
        });
      };
      client.requestAccessToken(options);
    });
  }

  return {
    async signIn(): Promise<void> {
      const client = await ensureTokenClient();
      token = await requestToken(client);
      notify();
    },

    async signOut(): Promise<void> {
      const current = token;
      token = undefined;
      // Forget the token client too: signOut() is an explicit "log me out",
      // and getAccessToken() must not be able to silently resurrect a
      // session behind the user's back afterwards - only a fresh signIn()
      // (a new user gesture) may create a new token client.
      tokenClient = undefined;
      notify();
      if (current) {
        await deps.revoke(current.accessToken);
      }
    },

    async getAccessToken(): Promise<string> {
      if (token && token.expiresAt > deps.now()) {
        return token.accessToken;
      }
      // No live token: either never signed in, or it expired/was invalidated.
      // Only attempt a silent refresh if we already have a token client from
      // a prior real sign-in gesture - never bootstrap one here, that would
      // be a Google call with no gesture behind it.
      if (!tokenClient) {
        throw new ReAuthRequiredError();
      }
      try {
        token = await requestToken(tokenClient, { prompt: "" });
      } catch (err) {
        token = undefined;
        notify();
        throw err instanceof ReAuthRequiredError ? err : new ReAuthRequiredError();
      }
      notify();
      return token.accessToken;
    },

    invalidate(): void {
      if (token) {
        token = undefined;
        notify();
      }
    },

    state: currentState,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
