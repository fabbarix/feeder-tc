import { describe, expect, it } from "vitest";
import { createGoogleAuth, DRIVE_FILE_SCOPE, type GoogleAuthDeps } from "./auth.ts";
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
}

function createFakeGis(initialNow = 0): FakeGis {
  let callback: ((r: GoogleTokenResponse) => void) | undefined;
  let nextResponse: GoogleTokenResponse = { access_token: "tok-1", expires_in: 3600 };
  let now = initialNow;
  let clientCalls = 0;
  const requestCalls: Array<{ prompt?: string } | undefined> = [];
  const revokedTokens: string[] = [];

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
  };
}

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
});
