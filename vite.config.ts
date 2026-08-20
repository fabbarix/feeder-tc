import { copyFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * GitHub Pages has no server-side rewrites, so a deep link such as
 * /recipes/12 resolves to no file and Pages falls back to 404.html. Emitting
 * 404.html as an exact copy of index.html makes that fallback boot the SPA,
 * which then routes on location.pathname — real paths, no "#/".
 *
 * The response carries HTTP 404 on a cold deep link. The page renders
 * correctly and users never see the status; WP-24's service worker later
 * serves navigations from the precache with a 200.
 *
 * This mechanism cannot be verified by our E2E suite: both `vite dev` and
 * `vite preview` have their own SPA fallback and would serve index.html for
 * any path, masking a broken 404.html. Verify against the deployed site
 * (`curl -sI https://<host>/recipes/12`), not locally.
 */
function emitSpaFallback(): Plugin {
  return {
    name: "emit-spa-fallback",
    apply: "build",
    closeBundle() {
      const outDir = resolve(import.meta.dirname, "dist");
      copyFileSync(resolve(outDir, "index.html"), resolve(outDir, "404.html"));
    },
  };
}

// The site is served from the root of https://feeder.torchetti.us (custom
// domain, cut over 2026-08-20), so `base` is "/". It was "/feeder-tc/" while
// the site lived at https://fabbarix.github.io/feeder-tc/ — that URL now
// redirects to the custom domain. The router reads this via
// import.meta.env.BASE_URL (see src/App.tsx).
export default defineConfig({
  base: "/",
  plugins: [react(), emitSpaFallback()],
});
