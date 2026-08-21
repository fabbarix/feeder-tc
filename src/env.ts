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

/**
 * Every `env.*` getter that throws on a missing value — the set
 * `missingEnvVars` below checks. A literal union rather than `keyof
 * ImportMetaEnv`: Vite's own ambient type extends `Record<string, any>` (for
 * user-defined vars it can't know about statically), which makes `keyof
 * ImportMetaEnv` widen to `string | number` and defeats exhaustiveness here.
 */
type RequiredEnvVarName = "VITE_GOOGLE_CLIENT_ID" | "VITE_GOOGLE_API_KEY";
const REQUIRED_ENV_VARS = ["VITE_GOOGLE_CLIENT_ID", "VITE_GOOGLE_API_KEY"] as const satisfies readonly RequiredEnvVarName[];

/**
 * Names of every required `VITE_GOOGLE_*` var that is unset or empty —
 * checked WITHOUT ever throwing, unlike the getters below. `App.tsx` reads
 * this once, before constructing any Google wiring, so a build missing them
 * (a fresh clone with no `.env.local`, a fork that forgot to set the repo
 * Actions variables) can render an informative screen instead of hitting
 * `requireEnvVar`'s throw mid-render: `ShellContainer`'s
 * `useState(createGoogleWiring)` calls `env.googleClientId`/
 * `env.googleApiKey` on the very first render, and an uncaught throw there
 * unmounts the whole React tree with nothing on screen (see
 * `ConfigMissingScreen`'s doc comment, and STATUS.md "Known debt").
 *
 * Returns an empty array in the common case: local dev with `.env.local`
 * filled in, or production, which always supplies both (see this file's
 * header) — every other caller of `env.googleClientId`/`env.googleApiKey`
 * still gets `requireEnvVar`'s throw as defence in depth if it skips this
 * check.
 */
export function missingEnvVars(): readonly RequiredEnvVarName[] {
  return REQUIRED_ENV_VARS.filter((name) => !import.meta.env[name]);
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
