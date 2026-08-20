/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Google OAuth Web client ID (public, not a secret). Set as a repo Actions variable in CI. */
  readonly VITE_GOOGLE_CLIENT_ID: string;
  /** Google Picker API key (public, referrer-restricted). Set as a repo Actions variable in CI. */
  readonly VITE_GOOGLE_API_KEY: string;
  /** "true" to start the msw browser worker (src/mocks/browser.ts) at startup. Used by Playwright E2E. */
  readonly VITE_ENABLE_MOCKS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
