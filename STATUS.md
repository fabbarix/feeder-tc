# Feeder — Build Status

Coordinator-maintained. One line per work package. Updated at every dispatch and merge.

**States:** `pending` · `in-progress` · `in-review` · `merged` · `blocked` · `parked`

Last updated: 2026-08-20

## Stage 0 — Foundations (sequential)

| WP | Title | State | Branch | Notes |
|----|-------|-------|--------|-------|
| WP-01 | Repo scaffold & CI | in-progress | `wp-01-scaffold` | Sequential gate. Dispatched. |
| WP-02 | Interface contracts | pending | — | Gates all of Stage 1. Coordinator reviews vs HANDOVER §4 before merge. |

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

## Integration log

_(merge order per HANDOVER §6: transport/auth → engines → sync → UI shell → features)_

| Date | WP | Result |
|------|----|--------|
| — | — | — |
