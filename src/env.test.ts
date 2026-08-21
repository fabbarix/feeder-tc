import { afterEach, describe, expect, it, vi } from "vitest";

// Every test re-imports src/env.ts fresh (`vi.resetModules`) after stubbing
// `import.meta.env` via `vi.stubEnv` — `env`'s getters and `missingEnvVars`
// both read `import.meta.env` directly, not a value captured at module load,
// but resetting keeps each test's stub isolated from the next regardless.
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("missingEnvVars — the non-throwing check App.tsx gates on", () => {
  it("lists both vars when neither is set", async () => {
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "");
    vi.stubEnv("VITE_GOOGLE_API_KEY", "");
    vi.resetModules();
    const { missingEnvVars } = await import("./env.ts");
    expect(missingEnvVars()).toEqual(["VITE_GOOGLE_CLIENT_ID", "VITE_GOOGLE_API_KEY"]);
  });

  it("lists only the one var that is unset", async () => {
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "a-real-client-id");
    vi.stubEnv("VITE_GOOGLE_API_KEY", "");
    vi.resetModules();
    const { missingEnvVars } = await import("./env.ts");
    expect(missingEnvVars()).toEqual(["VITE_GOOGLE_API_KEY"]);
  });

  it("is empty once both vars are set — never throws either way", async () => {
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "a-real-client-id");
    vi.stubEnv("VITE_GOOGLE_API_KEY", "a-real-api-key");
    vi.resetModules();
    const { missingEnvVars } = await import("./env.ts");
    expect(missingEnvVars()).toEqual([]);
  });
});

describe("env.googleClientId / env.googleApiKey — defence in depth", () => {
  it("still throw on a missing value for any caller that reads them directly, without checking missingEnvVars first", async () => {
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "");
    vi.stubEnv("VITE_GOOGLE_API_KEY", "");
    vi.resetModules();
    const { env } = await import("./env.ts");
    expect(() => env.googleClientId).toThrow(/VITE_GOOGLE_CLIENT_ID/);
    expect(() => env.googleApiKey).toThrow(/VITE_GOOGLE_API_KEY/);
  });

  it("return the value once set", async () => {
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "a-real-client-id");
    vi.stubEnv("VITE_GOOGLE_API_KEY", "a-real-api-key");
    vi.resetModules();
    const { env } = await import("./env.ts");
    expect(env.googleClientId).toBe("a-real-client-id");
    expect(env.googleApiKey).toBe("a-real-api-key");
  });
});
