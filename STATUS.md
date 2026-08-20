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
| WP-10 | Google auth + Sheets transport| **merged** | `wp-10` (PR #11) | Merged 2026-08-20. |
| WP-11 | Workbook bootstrap + codecs | **merged** | `wp-11` (PR #13) | Merged 2026-08-20. Mixed-unit writes rejected at the codec layer; malformed rows quarantined as warnings. |
| WP-12 | Inventory engine (pure)| **merged** | `wp-12` (PR #10) | Merged 2026-08-20. |
| WP-13 | Planner engine (pure)| **merged** | `wp-13` (PR #7) | Merged 2026-08-20. |
| WP-14 | Shopping engine (pure)| **merged** | `wp-14` (PR #6) | Merged 2026-08-20. |
| WP-15 | UI shell + component kit| **merged** | `wp-15` (PR #9) | Merged 2026-08-20. |
| WP-16 | Seed ingredient catalog| **merged** | `wp-16` (PR #5) | Merged 2026-08-20. |
| WP-17 | Sync layer: snapshot + outbox| **merged** | `wp-17` (PR #8) | Merged 2026-08-20. |

| WP-15b | Component kit revision | **merged** | `wp-15b` (PR #15) | OKLCH, CSS Modules, React Aria, Phosphor, list-first. |
| M6-A | Products/prices contracts + codecs | **merged** | `m6a-contracts` (PR #17) | Contract extension, entry-time conversion, 3 new sheets. |
| WP-24a | App icons + manifest | **merged** | `wp-24a-app-icons` (PR #12) | Pulled forward from WP-24. |

## Stage 2 — Feature assembly (milestone pipeline)

| WP | Title | State | Branch | Notes |
|----|-------|-------|--------|-------|
| WP-20 | M1 Catalog + Recipes UI | **merged** | `wp-20` (PR #18) | Real auth wiring, catalog + recipe CRUD, header rebuild. |
| WP-21 | M2 Pantry UI | in-progress | `wp-21` | Dispatched, E2E_PORT=5510. |
| WP-22 | M3 Planner UI | pending | — | needs WP-13, WP-21 |
| WP-23 | M4 Shopping UI | pending | — | needs WP-14, WP-22 |
| WP-24 | M5 PWA + offline | in-progress | `wp24-sw` (PR #16, **merged**), `wp24-ui` | SW merged. UI half (banner, outbox status, update prompt) dispatched, E2E_PORT=5520. |

## Stage 3 — Hardening & release

| WP | Title | State | Branch | Notes |
|----|-------|-------|--------|-------|
| WP-30 | Cross-feature E2E suite | pending | — | needs WP-23; runs alongside WP-24 |
| WP-31 | Release | in-progress | `wp31-readme` (PR #14, **merged**) | README done and merged early. Remaining: onboarding polish, tag v1.0.0, owner's full-loop check. |

## Parked / blocked on owner

- **WP-10 live verification — PARTIALLY DONE (2026-08-20).**
  - ✅ **Sign-in verified against the real Google.** OAuth flow, `drive.file` scope,
    client ID, registered origin and consent screen all confirmed working by the owner.
  - ⚠️ First attempt failed with `Error 403: access_denied` — the consent screen was
    still in **Testing**, despite HANDOVER §7 recording it as Production. Owner
    published the app; no verification review was needed because `drive.file` is
    non-sensitive. HANDOVER §7 corrected.
  - ⏳ **Outstanding:** steps 2–4 of `verify-google.html` — create workbook (nine tabs),
    open Picker, and **read `Meta!A1:B1`**. Step 4 is the only one that proves
    `SheetsTransport` round-trips against the real Sheets API rather than msw.
    Not blocking; WP-10 is merged and its mocked contract suite passes.

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

## Proposed scope — awaiting owner decisions

- **M6 · Products, barcodes and prices** — specified by the owner 2026-08-20, captured
  in `DESIGN_PRODUCTS.md`. **Not buildable yet:** three decisions open, two of which
  reverse settled decisions.
  1. **Units** — the request asks for `kg`/`oz`/`lb`/`number`, but invariant 3 bans
     conversion and `Unit` is deliberately `g|ml|piece|portion`. Proposed: entry-time
     conversion only, canonical units in the workbook. Needs explicit approval.
  2. **Cost tracking** — `DESIGN.md` §6 lists it as a v1 non-goal. Price history
     reverses that; `DESIGN.md` must be amended, and currency named.
  3. **Photos** — cannot live in a cell (invariant 6). Proposed: Drive file id, using
     the `drive.file` scope we already hold. Or defer photos.
- **M7 · Shop detection** — explicitly deferred by the owner. `PriceObservations.source`
  is specified now so adding shops later needs no rewrite of price history.

## Integration log

_(merge order per HANDOVER §6: transport/auth → engines → sync → UI shell → features)_

| Date | WP | Result |
|------|----|--------|
| 2026-08-20 | WP-01 | Merged (PR #1, squash). Coordinator review found 3 issues, all fixed before merge: (1) E2E ran on port 5173 with `reuseExistingServer:true` and silently adopted an unrelated project's Vite server — moved to 5273, reuse disabled; (2) CI triggered on both `pull_request` and `push`, doubling every run — `pull_request` only; (3) msw worker (~400 kB) shipped to Pages as a dead chunk because the env check went through a getter and defeated static elimination — now read as a literal at the use site. main green: lint/typecheck/test/build/e2e. |
| 2026-08-20 | WP-02 | Merged (PR #3, squash) **after** a coordinator-approved contract change. Review confirmed: branded IDs, deep `readonly` events with no mutator, `SyncOutcome` union, `PlanSlotFilling` 3-way union, IDs taking an injected `Rng` (keeps event creation deterministic for WP-12/14), purity + dependency direction clean by grep. Two gaps sent back and fixed: (1) `SpoilEvent` had no `lotId` — invariant 4 scopes FIFO to "usage, shopping allocation", and WP-21's per-lot pantry view must record *which* lot spoiled; (2) no event could express DESIGN §2's manual expiry override on an existing lot, so `Lot.expiryOverridden` was unreachable after purchase and WP-12 could not implement its own scope — fixed on `AdjustEvent` (`delta` optional, `expiry?` added, `makeAdjustEvent` enforces at least one) rather than a 7th event type. 86 tests. |
| 2026-08-20 | WP-03 | Merged (PRs #2, #4, squash). Owner-requested path routing + custom domain, taken before the Stage 1 fan-out because it was a config change then and would have touched every UI package later. Found and fixed a passing-but-wrong E2E test: Playwright `goto()` with a leading slash resolves against the origin and dropped the base path. Site live at `https://feeder.torchetti.us`. |
| 2026-08-20 | Stage 1 | **All 7 packages merged**, plus WP-11. Integration required resolving one real conflict: five PRs had independently fixed the same latent `tsconfig.test.json` TS6307 gap two incompatible ways (three used a project reference needing `noEmit:false` + declaration emit; two added `"src"` to `include`). Took the include fix as canonical and reverted the other three. Also unioned three engine barrels in `src/domain/index.ts` and regenerated the lockfile via `npm install`. main green: 688 tests + 26 E2E. |
| 2026-08-20 | — | **Stage 1 fan-out dispatched:** WP-10, 12, 13, 14, 15, 16, 17 in seven worktrees, each with its own `E2E_PORT` to keep concurrent Playwright runs from colliding on 5273. |

## Unauthorized / unrouted proposals

- **Widening `RecipeStep` to `title`/`description`/`durationMinutes`, and adding a
  `RecipePhotos` sheet.** A read-only audit of the call sites was done against `main`
  and is sound work — **the audit is not the problem and nothing here reflects on it.**
  What is missing is the route: **no PR proposes the change and no coordinator-approved
  contract-change task exists.** The bar applies to *implementing* a frozen-contract
  change, not to investigating one.
  `types.ts`/`contracts.ts` are frozen; this would be the 13th `WorkbookSheetName`
  member and would rework `RecipeEditor`'s state shape plus
  `e2e/wp-20-recipe-management.spec.ts`. **Treat as unauthorized until it comes
  through a contract-change task.** If it is wanted, the audit found the exact
  enumeration sites: `bootstrap.ts`, `spreadsheet.ts` (`satisfies`-enforced),
  `codecs/index.ts` (`Record`, TS-enforced), `spreadsheet.test.ts`, and
  `features/wp-11-workbook-bootstrap.steps.ts`.

## Known debt

- **Stale sheet-count comments.** `WorkbookSheetName` has **twelve** members since
  M6-A, but comments in `src/sheets/mocks/handlers.ts` (~lines 17, 120) and
  `features/wp-11-workbook-bootstrap.steps.ts` (~86-88) still say "nine".
  `bootstrap.ts` was corrected in PR #19. Cosmetic, but it misleads: grep for
  "nine"/"twelve" when adding a sheet.

- **The app white-screens if `VITE_GOOGLE_*` is unset.** WP-20's shell constructs the
  Google wiring at first render and `src/env.ts` throws on first read of a missing
  value, so a build without them renders nothing rather than showing a sign-in screen
  that does not need them until clicked. Production always supplies them; a fork that
  forgets gets a blank page instead of a useful error. WP-31 polish item.
- **Bundle is 529 kB raw / 160 kB gzip**, past Vite's 500 kB warning. Wants route-level
  code-splitting before release — the recipe editor and catalog need not be in the
  initial chunk.

- **No `LICENSE` file**, but `package.json` declares `"license": "ISC"`. The repo is
  public, so it currently has no effective licence. Owner decision — ISC, MIT, or
  none — then add the file or drop the field.
- **No `.env.local.example`.** The README names the two variables directly instead,
  but a template would be friendlier for a fork.

- **TypeScript pinned to `^6.0.3`**, not current 7.x: `typescript-eslint@8.67` declares
  peer `<6.1.0`. Revisit as a dedicated dependency-bump task once the ecosystem
  catches up — must not drift in via a feature branch.
- **Picker API key referrer allowlist still contains `http://localhost:5173/*`.**
  Needed for development; worth dropping from the production key at WP-31.
