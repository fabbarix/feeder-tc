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
  /**
   * Picker API key. Used ONLY to initialise the Google Picker widget. It must
   * never be attached to a Sheets or Drive REST call — those authenticate with
   * the user's OAuth bearer token alone. The key is referrer-restricted and
   * API-target-restricted to picker.googleapis.com, so sending it elsewhere
   * would fail anyway, but the rule is about blast radius, not just failure.
   */
  get googleApiKey(): string {
    return requireEnvVar("VITE_GOOGLE_API_KEY", import.meta.env.VITE_GOOGLE_API_KEY);
  },
};

// Note: there is deliberately no `mocksEnabled` helper here. The msw toggle is
// read as a literal `import.meta.env.VITE_ENABLE_MOCKS` at its use site so Vite
// can statically eliminate the mock import from production builds — see
// src/main.tsx. Wrapping it in a getter would silently ship msw to Pages.
