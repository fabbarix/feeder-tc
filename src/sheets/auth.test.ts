import { describe, expect, it } from "vitest";
import { createGoogleAuth, DRIVE_FILE_SCOPE, parseStoredToken, type GoogleAuthDeps } from "./auth.ts";
import { ReAuthRequiredError } from "./errors.ts";
import type { GoogleTokenClient, GoogleTokenResponse } from "./google-globals.ts";

const CLIENT_ID = "test-client-id.apps.googleusercontent.com";

interface FakeGis {
  readonly deps: GoogleAuthDeps;
  readonly requestCalls: ReadonlyArray<{ prompt?: string } | undefined>;
  readonly revokedTokens: readonly string[];
  createTokenClientCallCount(): number;
  respondWith(response: GoogleTokenResponse): void;
  setNow(ms: number): void;
  consentHint(): boolean;
  storedToken(): StoredTokenState | undefined;
}

type StoredTokenState = { accessToken: string; expiresAt: number };

function createFakeGis(
  initialNow = 0,
  initialConsentHint = false,
  initialStoredToken: StoredTokenState | undefined = undefined,
): FakeGis {
  let callback: ((r: GoogleTokenResponse) => void) | undefined;
  let nextResponse: GoogleTokenResponse = { access_token: "tok-1", expires_in: 3600 };
  let now = initialNow;
  let clientCalls = 0;
  const requestCalls: Array<{ prompt?: string } | undefined> = [];
  const revokedTokens: string[] = [];
  let consentHint = initialConsentHint;
  let storedToken: StoredTokenState | undefined = initialStoredToken;

  const client: GoogleTokenClient = {
    requestAccessToken(options) {
      requestCalls.push(options);
      const response = nextResponse;
      queueMicrotask(() => callback?.(response));
    },
  };

  const deps: GoogleAuthDeps = {
    async createTokenClient(cb) {
      clientCalls += 1;
      callback = cb;
      return client;
    },
    async revoke(accessToken) {
      revokedTokens.push(accessToken);
    },
    now: () => now,
    readConsentHint: () => consentHint,
    writeConsentHint(consented) {
      consentHint = consented;
    },
    readStoredToken: () => storedToken,
    writeStoredToken(next) {
      storedToken = next;
    },
  };

  return {
    deps,
    requestCalls,
    revokedTokens,
    createTokenClientCallCount: () => clientCalls,
    respondWith(response) {
      nextResponse = response;
    },
    setNow(ms) {
      now = ms;
    },
    consentHint: () => consentHint,
    storedToken: () => storedToken,
  };
}

// localStorage is attacker-writable, so the cached-token cell is parsed, never
// trusted. These pin the degrade-to-undefined behaviour — a non-string
// accessToken reaching an Authorization header is the failure that matters.
describe("parseStoredToken", () => {
  it("round-trips a well-formed token", () => {
    expect(parseStoredToken(JSON.stringify({ accessToken: "tok", expiresAt: 123 }))).toEqual({
      accessToken: "tok",
      expiresAt: 123,
    });
  });

  it.each([
    ["absent", null],
    ["empty", ""],
    ["not JSON", "{not json"],
    ["JSON null", "null"],
    ["a bare string", '"tok"'],
    ["an array", "[]"],
    ["a number token", JSON.stringify({ accessToken: 42, expiresAt: 1 })],
    ["an object token", JSON.stringify({ accessToken: { a: 1 }, expiresAt: 1 })],
    ["an empty token", JSON.stringify({ accessToken: "", expiresAt: 1 })],
    ["a missing expiry", JSON.stringify({ accessToken: "tok" })],
    ["a string expiry", JSON.stringify({ accessToken: "tok", expiresAt: "soon" })],
    ["a NaN expiry", '{"accessToken":"tok","expiresAt":null}'],
  ])("degrades to undefined for %s", (_label, raw) => {
    expect(parseStoredToken(raw)).toBeUndefined();
  });
});

describe("createGoogleAuth", () => {
  // The real GoogleAuthDeps factory (createRealGoogleAuthDeps, exercised only
  // via verify-google.html, never in CI) bakes DRIVE_FILE_SCOPE straight into
  // initTokenClient's config - this constant IS the scope request, so pinning
  // its value is what "requests exactly drive.file and nothing else" means
  // for a unit test that never touches window.google.
  it("exports exactly the drive.file scope, nothing broader", () => {
    expect(DRIVE_FILE_SCOPE).toBe("https://www.googleapis.com/auth/drive.file");
  });

  it("signIn() transitions to signed-in once the token client resolves", async () => {
    const fake = createFakeGis();
    const auth = createGoogleAuth(CLIENT_ID, fake.deps);
    await auth.signIn();
    expect(auth.state()).toBe("signed-in");
  });

  it("makes no Google call at all before signIn() is called", () => {
    const fake = createFakeGis();
    createGoogleAuth(CLIENT_ID, fake.deps);
    expect(fake.createTokenClientCallCount()).toBe(0);
  });

  it("getAccessToken throws ReAuthRequiredError, with no Google call, when never signed in", async () => {
    const fake = createFakeGis();
    const auth = createGoogleAuth(CLIENT_ID, fake.deps);
    await expect(auth.getAccessToken()).rejects.toBeInstanceOf(ReAuthRequiredError);
    expect(fake.createTokenClientCallCount()).toBe(0);
  });

  it("signIn stores the token in memory only - never in localStorage", async () => {
    const fake = createFakeGis();
    const before = localStorage.length;
    const auth = createGoogleAuth(CLIENT_ID, fake.deps);
    await auth.signIn();
    expect(await auth.getAccessToken()).toBe("tok-1");
    expect(localStorage.length).toBe(before);
  });

  it("returns the cached token without a new Google call before expiry", async () => {
    const fake = createFakeGis(1_000);
    const auth = createGoogleAuth(CLIENT_ID, fake.deps);
    await auth.signIn();
    expect(fake.requestCalls).toHaveLength(1);

    await auth.getAccessToken();
    await auth.getAccessToken();
    expect(fake.requestCalls).toHaveLength(1); // still just the sign-in call
  });

  it("silently refreshes with prompt: '' once the cached token is near expiry", async () => {
    const fake = createFakeGis(0);
    const auth = createGoogleAuth(CLIENT_ID, fake.deps);
    await auth.signIn();
    expect(fake.requestCalls[0]).toBeUndefined(); // full-consent request: no options

    fake.respondWith({ access_token: "tok-2", expires_in: 3600 });
    fake.setNow(3_600_000); // past the safety-margin-adjusted expiry
    const token = await auth.getAccessToken();

    expect(token).toBe("tok-2");
    expect(fake.requestCalls).toHaveLength(2);
    expect(fake.requestCalls[1]).toEqual({ prompt: "" });
    expect(fake.createTokenClientCallCount()).toBe(1); // token client itself is reused
  });

  it("invalidate() forces the next getAccessToken() to refresh even before expiry", async () => {
    const fake = createFakeGis(0);
    const auth = createGoogleAuth(CLIENT_ID, fake.deps);
    await auth.signIn();

    auth.invalidate();
    expect(auth.state()).toBe("signed-out");

    fake.respondWith({ access_token: "tok-2", expires_in: 3600 });
    const token = await auth.getAccessToken();
    expect(token).toBe("tok-2");
    expect(fake.requestCalls[1]).toEqual({ prompt: "" });
  });

  it("throws ReAuthRequiredError and clears state when silent refresh fails", async () => {
    const fake = createFakeGis(0);
    const auth = createGoogleAuth(CLIENT_ID, fake.deps);
    await auth.signIn();

    fake.respondWith({ error: "invalid_grant" });
    fake.setNow(3_600_000);
    await expect(auth.getAccessToken()).rejects.toBeInstanceOf(ReAuthRequiredError);
    expect(auth.state()).toBe("signed-out");
  });

  it("signOut revokes the token, clears in-memory state, and notifies subscribers", async () => {
    const fake = createFakeGis(0);
    const auth = createGoogleAuth(CLIENT_ID, fake.deps);
    const seen: string[] = [];
    auth.subscribe((state) => seen.push(state));

    await auth.signIn();
    await auth.signOut();

    expect(fake.revokedTokens).toEqual(["tok-1"]);
    expect(auth.state()).toBe("signed-out");
    expect(seen).toEqual(["signed-in", "signed-out"]);
    await expect(auth.getAccessToken()).rejects.toBeInstanceOf(ReAuthRequiredError);
  });

  // Session restore (owner-approved 2026-08-21). These cover the actual
  // reported defect: a page reload — modelled here as a SECOND createGoogleAuth
  // over the same persisted hint, because a reload is precisely what destroys
  // the old closure and builds a new one.
  describe("restore", () => {
    it("makes no Google call at all when this browser has never signed in", async () => {
      const fake = createFakeGis(0, false);
      const auth = createGoogleAuth(CLIENT_ID, fake.deps);

      expect(await auth.restore()).toBe(false);
      // The invariant-8 guarantee worth keeping: a first-time visitor causes
      // zero Google traffic before a gesture. No token client, no request.
      expect(fake.createTokenClientCallCount()).toBe(0);
      expect(fake.requestCalls).toEqual([]);
      expect(auth.state()).toBe("signed-out");
    });

    it("signs in silently after a reload, without any interactive prompt", async () => {
      const first = createFakeGis(0, false);
      const auth1 = createGoogleAuth(CLIENT_ID, first.deps);
      await auth1.signIn();
      expect(first.consentHint()).toBe(true);

      // The reload: a brand-new auth instance (new closure, no token, no
      // token client) over a browser that kept the hint.
      const reloaded = createFakeGis(0, true);
      const auth2 = createGoogleAuth(CLIENT_ID, reloaded.deps);
      const seen: string[] = [];
      auth2.subscribe((state) => seen.push(state));

      expect(await auth2.restore()).toBe(true);
      expect(auth2.state()).toBe("signed-in");
      expect(seen).toEqual(["signed-in"]);
      expect(await auth2.getAccessToken()).toBe("tok-1");
      // Silent means silent: prompt must be "", never "consent"/"select_account".
      expect(reloaded.requestCalls).toEqual([{ prompt: "" }]);
    });

    it("falls back to signed-out when the silent request fails, and never throws", async () => {
      const fake = createFakeGis(0, true);
      fake.respondWith({ error: "interaction_required" });
      const auth = createGoogleAuth(CLIENT_ID, fake.deps);

      // Callers fire this on mount and ignore the result — it must resolve.
      await expect(auth.restore()).resolves.toBe(false);
      expect(auth.state()).toBe("signed-out");
      // Hint is deliberately kept: the failure is usually transient (blocked
      // third-party cookies, an iOS PWA cookie jar), and retrying next load
      // costs one silent request that renders nothing.
      expect(fake.consentHint()).toBe(true);
    });

    it("does not resurrect a session after an explicit signOut", async () => {
      const fake = createFakeGis(0, false);
      const auth = createGoogleAuth(CLIENT_ID, fake.deps);
      await auth.signIn();
      await auth.signOut();
      expect(fake.consentHint()).toBe(false);

      // A reload after signing out must stay signed out and make no call.
      const reloaded = createFakeGis(0, fake.consentHint());
      const auth2 = createGoogleAuth(CLIENT_ID, reloaded.deps);
      expect(await auth2.restore()).toBe(false);
      expect(reloaded.createTokenClientCallCount()).toBe(0);
    });

    // Token caching (owner-approved 2026-08-21). The silent path above did
    // not work in the owner's installed PWA, so the token is now persisted
    // deliberately — see auth.ts's module doc for the trade-off. These tests
    // pin the behaviour AND the things that bound the damage.
    it("adopts a cached unexpired token with ZERO Google calls — the actual fix", async () => {
      const fake = createFakeGis(0, true, { accessToken: "cached-tok", expiresAt: 3_600_000 });
      const auth = createGoogleAuth(CLIENT_ID, fake.deps);

      expect(await auth.restore()).toBe(true);
      expect(auth.state()).toBe("signed-in");
      expect(await auth.getAccessToken()).toBe("cached-tok");
      // The whole point: a reload costs no Google round trip at all, which is
      // what works where the silent prompt:"" path does not.
      expect(fake.createTokenClientCallCount()).toBe(0);
      expect(fake.requestCalls).toEqual([]);
    });

    it("persists the token on sign-in so the next load can adopt it", async () => {
      const fake = createFakeGis(0);
      const auth = createGoogleAuth(CLIENT_ID, fake.deps);
      await auth.signIn();
      expect(fake.storedToken()).toEqual({ accessToken: "tok-1", expiresAt: 3_600_000 - 60_000 });
    });

    it("discards an expired cached token instead of presenting it", async () => {
      const fake = createFakeGis(0, false, { accessToken: "stale", expiresAt: -1 });
      const auth = createGoogleAuth(CLIENT_ID, fake.deps);

      // No consent hint either, so this must not fall through to a Google call.
      expect(await auth.restore()).toBe(false);
      expect(auth.state()).toBe("signed-out");
      // And the dead token must not be left to be re-read next load.
      expect(fake.storedToken()).toBeUndefined();
    });

    it("clears the stored token on signOut — no live bearer token left at rest", async () => {
      const fake = createFakeGis(0);
      const auth = createGoogleAuth(CLIENT_ID, fake.deps);
      await auth.signIn();
      expect(fake.storedToken()).toBeDefined();

      await auth.signOut();
      expect(fake.storedToken()).toBeUndefined();
      expect(fake.consentHint()).toBe(false);
    });

    it("clears the stored token on invalidate so a 401'd token is never resurrected", async () => {
      const fake = createFakeGis(0);
      const auth = createGoogleAuth(CLIENT_ID, fake.deps);
      await auth.signIn();

      // The transport calls invalidate() after an unexpected 401.
      auth.invalidate();
      expect(fake.storedToken()).toBeUndefined();

      // A reload now must not sign in off the rejected token.
      const reloaded = createFakeGis(0, true, fake.storedToken());
      reloaded.respondWith({ error: "interaction_required" });
      const auth2 = createGoogleAuth(CLIENT_ID, reloaded.deps);
      expect(await auth2.restore()).toBe(false);
    });

    it("is a no-op when a live token is already held", async () => {
      const fake = createFakeGis(0, true);
      const auth = createGoogleAuth(CLIENT_ID, fake.deps);
      await auth.signIn();
      const callsAfterSignIn = fake.requestCalls.length;

      expect(await auth.restore()).toBe(true);
      expect(fake.requestCalls.length).toBe(callsAfterSignIn);
    });
  });
});
