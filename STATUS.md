# Feeder — Build Status

Coordinator-maintained. One line per work package. Updated at every dispatch and merge.

**States:** `pending` · `in-progress` · `in-review` · `merged` · `blocked` · `parked`

Last updated: 2026-08-20

## Stage 0 — Foundations (sequential)

| WP | Title | State | Branch | Notes |
|----|-------|-------|--------|-------|
| WP-01 | Repo scaffold & CI | **merged** | `wp-01-scaffold` (PR #1) | Merged 2026-08-20. 3 coordinator fixes applied at review — see integration log. |
| WP-02 | Interface contracts | **merged** | `wp-02-contracts` (PR #3) | Merged 2026-08-20 after coordinator review forced 2 contract changes. |
| WP-03 | Path routing + custom domain | **merged** | `wp-03-routing` (PR #2), `wp-03-cutover` (PR #4) | Owner-requested. Path routing + live custom domain. |

## Stage 1 — Parallel core (fan out after WP-02 merges)

| WP | Title | State | Branch | Notes |
|----|-------|-------|--------|-------|
| WP-10 | Google auth + Sheets transport| in-progress | `wp-10` | Dispatched 2026-08-20, worktree, E2E_PORT=5310. Contains the parked live-verification step (owner at browser).|
| WP-11 | Workbook bootstrap + codecs | pending | — | Dispatched once WP-10 merges (per dependency graph). |
| WP-12 | Inventory engine (pure)| in-progress | `wp-12` | Dispatched 2026-08-20, worktree, E2E_PORT=5312. |
| WP-13 | Planner engine (pure)| in-progress | `wp-13` | Dispatched 2026-08-20, worktree, E2E_PORT=5313. |
| WP-14 | Shopping engine (pure)| in-progress | `wp-14` | Dispatched 2026-08-20, worktree, E2E_PORT=5314. |
| WP-15 | UI shell + component kit| in-progress | `wp-15` | Dispatched 2026-08-20, worktree, E2E_PORT=5315. |
| WP-16 | Seed ingredient catalog| in-progress | `wp-16` | Dispatched 2026-08-20, worktree, E2E_PORT=5316. |
| WP-17 | Sync layer: snapshot + outbox| in-progress | `wp-17` | Dispatched 2026-08-20, worktree, E2E_PORT=5317. |

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

- **Custom domain — ✅ COMPLETE (2026-08-20).** Site is live at
  `https://feeder.torchetti.us`, HTTPS enforced, `fabbarix.github.io/feeder-tc/`
  301s to it. Owner did the GoDaddy CNAME and added the third OAuth JS origin;
  coordinator set the Pages domain, added the Picker-key referrer, flipped
  `base` to `/`, and verified: root `200`, `/recipes/12` serves the app shell
  (`404` status by design — see HANDOVER §5), `http` → `https` `301`.
  - **Local-network gotcha:** the owner's dnsmasq has
    `address=/torchetti.us/192.168.5.1`, which wildcards every subdomain and
    intercepts port-53 queries regardless of the resolver asked. From that
    network the site appears broken. Verify with DNS-over-HTTPS
    (`curl 'https://dns.google/resolve?name=feeder.torchetti.us&type=A'`) or
    `curl --resolve feeder.torchetti.us:443:185.199.108.153`, never `dig`.
    Fix on the router: add `server=/feeder.torchetti.us/#` (more specific
    match wins; `#` means "use standard upstream servers") and **restart**
    dnsmasq — SIGHUP does not re-read the config file.

## Integration log

_(merge order per HANDOVER §6: transport/auth → engines → sync → UI shell → features)_

| Date | WP | Result |
|------|----|--------|
| 2026-08-20 | WP-01 | Merged (PR #1, squash). Coordinator review found 3 issues, all fixed before merge: (1) E2E ran on port 5173 with `reuseExistingServer:true` and silently adopted an unrelated project's Vite server — moved to 5273, reuse disabled; (2) CI triggered on both `pull_request` and `push`, doubling every run — `pull_request` only; (3) msw worker (~400 kB) shipped to Pages as a dead chunk because the env check went through a getter and defeated static elimination — now read as a literal at the use site. main green: lint/typecheck/test/build/e2e. |
| 2026-08-20 | WP-02 | Merged (PR #3, squash) **after** a coordinator-approved contract change. Review confirmed: branded IDs, deep `readonly` events with no mutator, `SyncOutcome` union, `PlanSlotFilling` 3-way union, IDs taking an injected `Rng` (keeps event creation deterministic for WP-12/14), purity + dependency direction clean by grep. Two gaps sent back and fixed: (1) `SpoilEvent` had no `lotId` — invariant 4 scopes FIFO to "usage, shopping allocation", and WP-21's per-lot pantry view must record *which* lot spoiled; (2) no event could express DESIGN §2's manual expiry override on an existing lot, so `Lot.expiryOverridden` was unreachable after purchase and WP-12 could not implement its own scope — fixed on `AdjustEvent` (`delta` optional, `expiry?` added, `makeAdjustEvent` enforces at least one) rather than a 7th event type. 86 tests. |
| 2026-08-20 | WP-03 | Merged (PRs #2, #4, squash). Owner-requested path routing + custom domain, taken before the Stage 1 fan-out because it was a config change then and would have touched every UI package later. Found and fixed a passing-but-wrong E2E test: Playwright `goto()` with a leading slash resolves against the origin and dropped the base path. Site live at `https://feeder.torchetti.us`. |
| 2026-08-20 | — | **Stage 1 fan-out dispatched:** WP-10, 12, 13, 14, 15, 16, 17 in seven worktrees, each with its own `E2E_PORT` to keep concurrent Playwright runs from colliding on 5273. |

## Known debt

- **TypeScript pinned to `^6.0.3`**, not current 7.x: `typescript-eslint@8.67` declares
  peer `<6.1.0`. Revisit as a dedicated dependency-bump task once the ecosystem
  catches up — must not drift in via a feature branch.
- **Picker API key referrer allowlist still contains `http://localhost:5173/*`.**
  Needed for development; worth dropping from the production key at WP-31.
