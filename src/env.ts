/**
 * Typed, validated access to build-time env vars.
 *
 * Values are read lazily via getters: importing this module never throws, so
 * `npm run build` and every test that doesn't touch Google auth stay green
 * even when the vars are unset (e.g. a fresh clone with no .env.local, or
 * CI's lint/typecheck/test jobs, which never need real credentials). The
 * first *read* of a missing value throws loudly instead of handing callers
 * `undefined`.
 *
 * In CI, `VITE_GOOGLE_CLIENT_ID` / `VITE_GOOGLE_API_KEY` come from repo
 * Actions **variables** (`vars.*`, not secrets — see deploy.yml) and are only
 * wired into the production `build` job. They must never be committed; local
 * dev gets them from the gitignored .env.local.
 */

function requireEnvVar(name: keyof ImportMetaEnv, value: string | undefined): string {
  if (value === undefined || value === "") {
    throw new Error(
      `Missing required environment variable "${name}". Set it in .env.local for ` +
        `local dev (see .env.local.example if present) or as a repo Actions variable in CI.`,
    );
  }
  return value;
}

export const env = {
  get googleClientId(): string {
    return requireEnvVar("VITE_GOOGLE_CLIENT_ID", import.meta.env.VITE_GOOGLE_CLIENT_ID);
  },
  get googleApiKey(): string {
    return requireEnvVar("VITE_GOOGLE_API_KEY", import.meta.env.VITE_GOOGLE_API_KEY);
  },
  /** True when the app should start the msw browser worker instead of talking to Google. */
  get mocksEnabled(): boolean {
    return import.meta.env.VITE_ENABLE_MOCKS === "true";
  },
};
