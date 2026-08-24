/**
 * Google Identity Services (GIS) token client wrapper (WP-10).
 *
 * Design constraints (IMPLEMENTATION_PLAN.md WP-10 / HANDOVER.md invariant 8):
 *  - Request exactly the `drive.file` scope, nothing broader.
 *  - Never call any *interactive* Google UI before a user gesture (signIn()
 *    is that gesture; nothing here runs at import/module-init time).
 *
 * TOKEN PERSISTENCE — a deliberate, owner-approved security trade-off
 * (2026-08-21). Do not "fix" this back without asking the owner.
 *
 * WP-10's original rule was "never persist the access token to
 * localStorage/sessionStorage/IndexedDB". **That rule is now broken on
 * purpose.** The consent-hint + silent-`prompt:""` approach below was shipped
 * first precisely because it kept the rule, and it did not work in the
 * owner's environment (installed PWA on mobile). The owner chose persistence
 * with the cost stated explicitly: "ugly - but makes for a better user
 * experience".
 *
 * What this costs: the access token now sits in localStorage, where any XSS
 * on this origin can read it. What bounds the damage:
 *   - the token only ever carries `drive.file` (invariant 8), so it can touch
 *     only files this app itself created - not the user's wider Drive;
 *   - it is short-lived (~1 hour) and is cleared on signOut() and on
 *     invalidate() (the 401 path), so a rejected token is never re-read;
 *   - what is read back is validated, never trusted, since localStorage is
 *     attacker-writable.
 *
 * What it does NOT solve: a browser-only app has no refresh token - that
 * needs a client secret and a backend, and invariant 7 forbids one. So this
 * makes reloads seamless for up to ~1 hour per sign-in, after which the
 * silent path is tried and, where that path is what already failed, the user
 * signs in again. That ceiling is inherent, not a bug to chase.
 *
 * Session restore (owner-approved 2026-08-21, narrowing invariant 8's "no
 * Google call before a user gesture" to "no *interactive* Google UI before a
 * user gesture"):
 *
 * The token and the token client both lived only in this closure, so a page
 * reload lost both — and getAccessToken()'s silent refresh could not run,
 * because it requires a token client that only signIn() ever created. Every
 * refresh therefore forced a full consent round trip. In an installed PWA,
 * which is cold-started far more aggressively than a browser tab, that is
 * constant.
 *
 * restore() fixes it without weakening the rule that matters. What is
 * persisted is a single non-secret boolean - "this browser has consented
 * before" - and never the token, so there is still nothing at rest for an
 * XSS to steal. With the hint set, restore() asks GIS for a token with
 * `prompt: ""`, which Google documents as bypassing the account chooser and
 * consent dialog for an existing session: it renders no UI at all, so it
 * either succeeds invisibly or fails invisibly.
 *
 * A browser that has never signed in has no hint, so restore() returns
 * immediately having made *no* Google call whatsoever - a first-time visitor
 * still triggers zero Google traffic before a gesture, which is the part of
 * invariant 8 worth keeping.
 *
 * Known limits, deliberately not worked around: a browser-only app has no
 * refresh token (that needs a client secret and a backend, and invariant 7
 * forbids one), so this restores a session only while the *Google* session
 * lives; and an installed iOS PWA may hold a cookie jar separate from
 * Safari, in which case the silent request fails and the sign-in button is
 * shown exactly as before.
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
  /**
   * Reads the non-secret "this browser has consented before" hint.
   * This is a boolean, never a token — see the module doc comment.
   */
  readConsentHint(): boolean;
  /** Persists (or clears) the consent hint. */
  writeConsentHint(consented: boolean): void;
  /**
   * Reads the cached access token, or `undefined` if absent/unreadable/malformed.
   * See the module doc comment for why this exists and what it costs.
   */
  readStoredToken(): TokenState | undefined;
  /** Persists the access token, or clears it when passed `undefined`. */
  writeStoredToken(token: TokenState | undefined): void;
}

/** localStorage key for the consent hint. Holds `"1"` or nothing — never a token. */
export const CONSENT_HINT_KEY = "feeder.auth.consented";

/**
 * localStorage key for the cached access token. **This one DOES hold a bearer
 * token** — see the module doc comment for the owner's decision and the
 * reasoning. Anything clearing session state must clear this too.
 */
export const STORED_TOKEN_KEY = "feeder.auth.token";

export interface GoogleAuth {
  signIn(): Promise<void>;
  signOut(): Promise<void>;
  /**
   * Attempts to restore a session on page load WITHOUT any user gesture and
   * WITHOUT rendering any Google UI. Resolves `true` if the app is now
   * signed in, `false` otherwise — it never throws and never rejects, so a
   * caller can fire it on mount and simply ignore a `false`.
   *
   * Returns `false` immediately, having made no Google call at all, when
   * this browser has never completed a sign-in (no consent hint).
   */
  restore(): Promise<boolean>;
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

/**
 * Parses the cached-token cell. Exported so the validation is unit-testable:
 * `createRealGoogleAuthDeps` is only exercised via verify-google.html, never
 * in CI, and this is the one security-relevant branch in it.
 *
 * localStorage is attacker-writable, so nothing here trusts the shape it
 * finds. Anything malformed degrades to `undefined` ("no cached token"), and
 * in particular a non-string `accessToken` must never reach an
 * `Authorization` header.
 */
export function parseStoredToken(raw: string | null): TokenState | undefined {
  if (!raw) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const { accessToken, expiresAt } = parsed as Record<string, unknown>;
  if (typeof accessToken !== "string" || accessToken === "") return undefined;
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) return undefined;
  return { accessToken, expiresAt };
}

function createRealGoogleAuthDeps(clientId: string): GoogleAuthDeps {
  return {
    async createTokenClient(callback) {
      await loadScriptOnce("https://accounts.google.com/gsi/client");
      const oauth2 = window.google?.accounts?.oauth2;
      if (!oauth2) {
        // Plain language on purpose (jargon sweep, WP-fix-sheets-429) -
        // reaches App.tsx's handleSignIn catch, whose toast shows this
        // verbatim.
        throw new Error("Couldn't complete sign-in. Please try again.");
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
    readConsentHint() {
      // Storage can throw in private modes / blocked-cookie contexts. A
      // missing hint is simply "not signed in before", never a crash.
      try {
        return window.localStorage.getItem(CONSENT_HINT_KEY) === "1";
      } catch {
        return false;
      }
    },
    writeConsentHint(consented) {
      try {
        if (consented) {
          window.localStorage.setItem(CONSENT_HINT_KEY, "1");
        } else {
          window.localStorage.removeItem(CONSENT_HINT_KEY);
        }
      } catch {
        // Best-effort: failing to persist the hint costs one extra sign-in,
        // which is strictly better than failing to sign in at all.
      }
    },
    readStoredToken() {
      try {
        return parseStoredToken(window.localStorage.getItem(STORED_TOKEN_KEY));
      } catch {
        return undefined;
      }
    },
    writeStoredToken(tokenState) {
      try {
        if (tokenState) {
          window.localStorage.setItem(STORED_TOKEN_KEY, JSON.stringify(tokenState));
        } else {
          window.localStorage.removeItem(STORED_TOKEN_KEY);
        }
      } catch {
        // Storage full or blocked: the in-memory token still works for this
        // tab, so a write failure degrades to the old behaviour, not an error.
      }
    },
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
      deps.writeConsentHint(true);
      deps.writeStoredToken(token);
      notify();
    },

    async restore(): Promise<boolean> {
      // Already signed in (e.g. restore() raced a signIn()) — nothing to do.
      if (token && token.expiresAt > deps.now()) return true;

      // The cached token: the whole point of the persistence trade-off. A
      // reload adopts it with ZERO Google calls, which is what makes the
      // installed PWA usable where the silent path below does not work.
      const stored = deps.readStoredToken();
      if (stored && stored.expiresAt > deps.now()) {
        token = stored;
        notify();
        return true;
      }
      // Expired or absent: it is dead weight now, and leaving it would keep
      // handing a rejected token to the next load.
      if (stored) deps.writeStoredToken(undefined);

      // No prior consent from this browser: make NO Google call. A
      // first-time visitor still triggers zero Google traffic before a
      // gesture — that part of the original rule is intact.
      if (!deps.readConsentHint()) return false;
      try {
        const client = await ensureTokenClient();
        // `prompt: ""` renders no UI: it either silently succeeds against a
        // live Google session or silently fails. It must never be upgraded
        // to "consent"/"select_account" here — that would put an interactive
        // dialog on page load, which is exactly what invariant 8 forbids.
        token = await requestToken(client, { prompt: "" });
        deps.writeStoredToken(token);
      } catch {
        // Session gone, consent withdrawn, third-party cookies blocked, or
        // an iOS PWA with its own cookie jar. All of these mean the same
        // thing to the caller: show the sign-in button. The hint is left in
        // place — a failure here is usually transient, and the only cost of
        // retrying next load is one silent request that renders nothing.
        token = undefined;
        return false;
      }
      notify();
      return true;
    },

    async signOut(): Promise<void> {
      const current = token;
      token = undefined;
      // Forget the token client too: signOut() is an explicit "log me out",
      // and getAccessToken() must not be able to silently resurrect a
      // session behind the user's back afterwards - only a fresh signIn()
      // (a new user gesture) may create a new token client.
      tokenClient = undefined;
      // Clear the consent hint AND the cached token: an explicit "log me
      // out" must not be silently undone by restore() on the next page load,
      // and must not leave a live bearer token sitting in storage.
      deps.writeConsentHint(false);
      deps.writeStoredToken(undefined);
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
      // Always clear storage, even when nothing is held in memory: the
      // transport calls this after a 401, and the whole point is that the
      // *next* load must not resurrect the token Google just rejected.
      deps.writeStoredToken(undefined);
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
