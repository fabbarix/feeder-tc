import { copyFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

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

// WP-24: service worker (app-shell precache + versioned updates). Registration
// is injected into the BUILT index.html only (injectRegister: "auto" — a tiny
// generated script, not a source edit), so main.tsx/index.html stay untouched;
// src/pwa/update.ts is the separate, UI-agnostic seam a future work package
// binds a "New version — reload" prompt to (see that file's header comment).
//
// `manifest: false`: public/manifest.webmanifest and its <link rel="manifest">
// in index.html already shipped in PR #12 (UI_DESIGN.md §11) — don't generate
// or inject a second one.
const pwaPlugin = VitePWA({
  registerType: "prompt", // installs new SW versions but never auto-activates one — see src/pwa/update.ts for why.
  injectRegister: "auto",
  manifest: false,
  workbox: {
    // Precache the app shell: hashed JS/CSS, the root HTML, and every icon
    // format PR #12 committed to public/ (favicon.ico, the PNG/maskable set,
    // apple-touch-icon.png, logo.svg, manifest.webmanifest itself).
    globPatterns: ["**/*.{js,css,html,ico,png,svg,webmanifest,woff2}"],
    globIgnores: [
      // Byte-identical copy of index.html (emitSpaFallback below), used only
      // for GitHub Pages' pre-install, cold-load fallback. Once the SW is
      // installed it never serves navigations from 404.html — see
      // navigateFallback — so precaching a second identical copy is waste.
      "404.html",
      // msw's dev/E2E-only mock worker (src/mocks/browser.ts, started only
      // when VITE_ENABLE_MOCKS==="true"); not part of the real app shell.
      "mockServiceWorker.js",
    ],
    // Any navigation (a deep link, a reload, the cold GH Pages 404→200 case
    // described in emitSpaFallback below) is served the cached shell once
    // installed, instead of hitting the network or GitHub Pages' 404.html.
    navigateFallback: "/index.html",
    // Defence in depth, not the only thing preventing this: a `fetch()`/XHR
    // call (Sheets/Drive/OAuth/Picker) is never a "navigate"-mode request, so
    // navigateFallback's NavigationRoute would never intercept one anyway —
    // but spell the exclusion out explicitly rather than rely on that alone.
    navigateFallbackDenylist: [
      /^https:\/\/sheets\.googleapis\.com\//,
      /^https:\/\/www\.googleapis\.com\//,
      /^https:\/\/accounts\.google\.com\//,
      /^https:\/\/apis\.google\.com\//,
      /^https:\/\/oauth2\.googleapis\.com\//,
    ],
    // Invariant 5 (HANDOVER.md §4): Sheets is the source of truth, never a
    // cache. NetworkOnly on every Google origin the app talks to
    // (src/sheets/*) makes that explicit and testable, even though none of
    // these are same-origin precache candidates in the first place:
    // - sheets.googleapis.com — the Sheets REST API (src/sheets/transport.ts,
    //   spreadsheet.ts) — a cached read would silently serve a stale
    //   workbook.
    // - www.googleapis.com — Drive scope/API surface (src/sheets/auth.ts).
    // - accounts.google.com — Google Identity Services OAuth (src/sheets/auth.ts).
    // - apis.google.com — gapi loader + Picker (src/sheets/picker.ts).
    // - oauth2.googleapis.com — token endpoint GIS may call directly.
    runtimeCaching: [
      // M6 barcode scanner (coordinator follow-up on PR #32): the WASM
      // fallback decoder's ~1 MB `.wasm` binary is DELIBERATELY not in
      // `globPatterns` above — it would push its full gzip size onto every
      // install, including every Android/Chrome user who has
      // `BarcodeDetector` and never needs it at all. `CacheFirst` here
      // means: the first time this file is EVER fetched (either the
      // opportunistic background warm from `src/scan/warm-wasm-decoder.ts`,
      // triggered as soon as the app is usable, or — failing that — a live
      // fetch the moment a Safari/iOS user actually opens the scanner), the
      // service worker keeps it, so every subsequent scan (online or not)
      // is served from cache rather than the network. `maxEntries: 2` lets
      // an old and a new content-hashed filename briefly coexist across an
      // app update instead of evicting the still-useful one immediately.
      {
        urlPattern: /\/assets\/zxing_reader-.*\.wasm$/,
        handler: "CacheFirst",
        options: {
          cacheName: "barcode-wasm-decoder",
          expiration: { maxEntries: 2, maxAgeSeconds: 60 * 60 * 24 * 90 },
        },
      },
      {
        urlPattern: /^https:\/\/sheets\.googleapis\.com\//,
        handler: "NetworkOnly",
      },
      {
        urlPattern: /^https:\/\/www\.googleapis\.com\//,
        handler: "NetworkOnly",
      },
      {
        urlPattern: /^https:\/\/accounts\.google\.com\//,
        handler: "NetworkOnly",
      },
      {
        urlPattern: /^https:\/\/apis\.google\.com\//,
        handler: "NetworkOnly",
      },
      {
        urlPattern: /^https:\/\/oauth2\.googleapis\.com\//,
        handler: "NetworkOnly",
      },
    ],
  },
});

// The site is served from the root of https://feeder.torchetti.us (custom
// domain, cut over 2026-08-20), so `base` is "/". It was "/feeder-tc/" while
// the site lived at https://fabbarix.github.io/feeder-tc/ — that URL now
// redirects to the custom domain. The router reads this via
// import.meta.env.BASE_URL (see src/App.tsx).
export default defineConfig({
  base: "/",
  plugins: [react(), emitSpaFallback(), pwaPlugin],
});
