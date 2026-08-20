# Feeder — Build Status

Coordinator-maintained. One line per work package. Updated at every dispatch and merge.

**States:** `pending` · `in-progress` · `in-review` · `merged` · `blocked` · `parked`

Last updated: 2026-08-20

## Stage 0 — Foundations (sequential)

| WP | Title | State | Branch | Notes |
|----|-------|-------|--------|-------|
| WP-01 | Repo scaffold & CI | **merged** | `wp-01-scaffold` (PR #1) | Merged 2026-08-20. 3 coordinator fixes applied at review — see integration log. |
| WP-02 | Interface contracts | in-progress | `wp-02-contracts` | Gates all of Stage 1. Coordinator reviews vs HANDOVER §4 before merge. |
| WP-03 | Path routing + custom domain | in-review | `wp-03-routing` (PR #2) | Owner-requested, added 2026-08-20. Routing done; **domain cutover held** until DNS resolves. |

## Stage 1 — Parallel core (fan out after WP-02 merges)

| WP | Title | State | Branch | Notes |
|----|-------|-------|--------|-------|
| WP-10 | Google auth + Sheets transport | pending | — | Contains the parked live-verification step (owner at browser). |
| WP-11 | Workbook bootstrap + codecs | pending | — | Depends WP-10 for live path; develops against fakes. |
| WP-12 | Inventory engine (pure) | pending | — | |
| WP-13 | Planner engine (pure) | pending | — | |
| WP-14 | Shopping engine (pure) | pending | — | |
| WP-15 | UI shell + component kit | pending | — | |
| WP-16 | Seed ingredient catalog | pending | — | |
| WP-17 | Sync layer: snapshot + outbox | pending | — | |

## Stage 2 — Feature assembly (milestone pipeline)

| WP | Title | State | Branch | Notes |
|----|-------|-------|--------|-------|
| WP-20 | M1 Catalog + Recipes UI | pending | — | needs WP-11, WP-15, WP-16 |
| WP-21 | M2 Pantry UI | pending | — | needs WP-12, WP-17, WP-20 |
| WP-22 | M3 Planner UI | pending | — | needs WP-13, WP-21 |
| WP-23 | M4 Shopping UI | pending | — | needs WP-14, WP-22 |
| WP-24 | M5 PWA + offline | pending | — | needs WP-17; final validation after WP-23 |

## Stage 3 — Hardening & release

| WP | Title | State | Branch | Notes |
|----|-------|-------|--------|-------|
| WP-30 | Cross-feature E2E suite | pending | — | needs WP-23; runs alongside WP-24 |
| WP-31 | Release | pending | — | needs WP-24, WP-30 |

## Parked / blocked on owner

- **WP-10 live verification** — dev-server sign-in + Google Picker open with a real
  Google account. Requires the product owner at the browser. Will be requested once
  the dev server runs an auth screen. Not blocking other packages.

- **Custom domain `feeder.torchetti.us` — needs two owner actions.** Not blocking
  any package; the site stays on `fabbarix.github.io/feeder-tc/` until cutover.
  1. **DNS at GoDaddy** (`torchetti.us` is on ns77/ns78.domaincontrol.com): add
     `CNAME  feeder  →  fabbarix.github.io`. Note the zone currently has a
     **wildcard** — every name, including the apex, resolves to `192.168.5.1`
     (a private address, so nothing public is being served today). An explicit
     `feeder` record overrides the wildcard for that one name and breaks nothing.
  2. **Google Cloud Console** → OAuth client → Authorized JavaScript origins:
     add `https://feeder.torchetti.us`. There is no API for this on personal
     accounts (HANDOVER §7), so it must be done by hand. **Sign-in will fail on
     the new domain until this is done.**

  Coordinator does at cutover, after DNS resolves: set the Pages custom domain,
  add the new referrer to the Picker API key (`gcloud services api-keys update`),
  flip `base` to `/` in `vite.config.ts`, enable Enforce HTTPS, and verify the
  404 fallback with `curl -sI https://feeder.torchetti.us/recipes/12`.
  Setting the Pages domain **before** DNS resolves would make the site
  unreachable, since Pages then redirects the github.io URL to the custom one —
  hence the ordering.

## Integration log

_(merge order per HANDOVER §6: transport/auth → engines → sync → UI shell → features)_

| Date | WP | Result |
|------|----|--------|
| 2026-08-20 | WP-01 | Merged (PR #1, squash). Coordinator review found 3 issues, all fixed before merge: (1) E2E ran on port 5173 with `reuseExistingServer:true` and silently adopted an unrelated project's Vite server — moved to 5273, reuse disabled; (2) CI triggered on both `pull_request` and `push`, doubling every run — `pull_request` only; (3) msw worker (~400 kB) shipped to Pages as a dead chunk because the env check went through a getter and defeated static elimination — now read as a literal at the use site. main green: lint/typecheck/test/build/e2e. |

## Known debt

- **TypeScript pinned to `^6.0.3`**, not current 7.x: `typescript-eslint@8.67` declares
  peer `<6.1.0`. Revisit as a dedicated dependency-bump task once the ecosystem
  catches up — must not drift in via a feature branch.
- **Picker API key referrer allowlist still contains `http://localhost:5173/*`.**
  Needed for development; worth dropping from the production key at WP-31.
