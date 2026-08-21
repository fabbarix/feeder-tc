# Feeder — Build Status

Coordinator-maintained. One line per work package. Updated at every dispatch and merge.

**States:** `pending` · `in-progress` · `in-review` · `merged` · `blocked` · `parked`

Last updated: 2026-08-21 (second pass — see the 2026-08-21 integration-log entries)

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
| WP-21 | M2 Pantry UI | **merged** | `wp-21` (PR #22) | Merged 2026-08-20. Structurally reworked later by WP-VC4. |
| WP-22 | M3 Planner UI | **merged** | `wp-22` (PR #26) | Merged 2026-08-21. Week grid, reroll/pin/manual pick/scale, mark-cooked. |
| WP-23 | M4 Shopping UI | **merged** | `wp-23` (PR #24) | Merged 2026-08-20. |
| WP-24 | M5 PWA + offline | **merged** | `wp24-sw` (PR #16), `wp24-ui` (PR #20) | Both halves merged 2026-08-20. |

### Visual conformance (unplanned — added after the mock landed)

| WP | Title | State | Branch | Notes |
|----|-------|-------|--------|-------|
| WP-VC | Match the approved mock | **merged** | `wp-vc` (PR #23) | Merged 2026-08-20. |
| WP-VC2 | Home dashboard + read-only recipe view | **merged** | `wp-vc2` (PR #25) | Merged 2026-08-21. |
| WP-VC3 | Pill SegmentedControl, shopping categories, route code-splitting | **merged** | `wp-vc3` (PR #27) | Merged 2026-08-21. |
| WP-VC4 | Pantry aggregation, real tabs, recipe editor cards | **merged** | `wp-vc4` (PR #28) | Merged 2026-08-21. Fixed the Pantry IA that shipped structurally wrong. |

## Recently merged — 2026-08-21 delivery run

| PR | Package | Merge | Notes |
|----|---------|-------|-------|
| #29 | Responsive design system (mock) | `5ef96ba` | Owner-approved gate. |
| #30 | WP-PHOTO contract + pipeline | `950f922` | Contract + codecs + encoder. **No UI** — see #33. |
| #31 | Purchasability + Plan calendar (mock) | `e327e76` | Owner-approved. |
| #32 | M6 barcode scanner + product editor | `394e3e4` | WASM decoder lazily loaded, kept out of the initial chunk and out of precache. |
| #33 | WP-PHOTO **UI** | `cf82ed1` | Closed the gap the owner caught: `src/photos/` had **zero importers**; now ten. Also fixed a latent data-loss bug in `RecipeEditor`. |
| #34 | Outbox flush coalescing | `b81851a` | **Data-loss fix — see below.** |
| #35 | WP-PURCHASING core | `4435fae` | Kills `0.5 Store Bought Lasagna`. Contract change was genuinely **additive-only**, and it updated the contract changelog. |
| — | Auth session restore | `e6c1790`, `e7914c5` | Released straight to production at the owner's instruction; verified live in the production bundle. |

`main` after the run: **1087 tests / 190 E2E**, lint + typecheck + build green, verified locally after every merge.

### The outbox bug (#34) — the most important thing found in this run

Chasing a flaky barcode E2E test surfaced a genuine defect in
`src/sync/outbox-sync-controller.ts`: `flushNow()`'s in-flight guard **silently
dropped** a concurrent call. `flushOutbox()` snapshots `outbox.pending()` once,
so anything enqueued after that snapshot was invisible to the running flush —
and the dropped call was the only thing that would have come back for it. The
event stayed stranded in the outbox indefinitely, never reaching
`InventoryEvents`.

**This was never a barcode bug.** Invariant 9 routes *every* offline write
through the outbox, so marking a meal cooked, adjusting a lot, or checking off
a shopping item could all have silently vanished if two writes landed close
enough together. Verified by reverting only the controller and keeping the new
test: it fails with a stranded `use` event (pantry consumption, not a
purchase). Fixed by coalescing rather than dropping. Evidence: 20/20 and 70/70
serial passes post-fix, against 5/10 and 11/20 failures before; 8/8 re-verified
on merged `main`.

### Lessons this run added

- **CI green on a branch is not green on `main`.** CI only runs on
  `pull_request`; there is no check on `main`. PR #33 was green on its branch
  and **broke the merge** — it and #32 both appended a `Camera` export to
  `src/ui/icons.ts` on different lines, so git merged cleanly and TypeScript
  caught the duplicate. Route-ownership boundaries prevent nearly every
  collision *except* shared registry files. Always re-verify `main` locally
  after a merge.
- **A red result can be environmental too.** A `typecheck` failure on `main`
  after #32 was a stale local `node_modules` missing a newly-added dependency,
  not a real break. The "ask what answered" rule cuts both ways.

## Still to do

| Package | State | Notes |
|---------|-------|-------|
| Purchasability **editor UI** | pending | Unblocked now that #33 released those files. Ingredient editor's "How you buy it" / "How you measure it"; recipe editor's "Can't be split" + entry-unit picker. Contract, `units.ts` and `purchasing.ts` plumbing all already exist and are tested. **Fold in `Ingredient.packLabel?`** while there — the mock says "1 jar", the implementation currently renders "250 g" because no container-noun field exists. |
| WP-30 | pending | Cross-feature E2E: multi-client, generation-bump. |
| WP-31 | pending | Onboarding polish, white-screen-without-env fix, bundle work, tag `v1.0.0`. |
| M6 remainder | pending | Price-history view, deliberately out of #32. |

### Superseded in-flight entries

| Package | State | Branch / PR | Notes |
|---------|-------|-------------|-------|
| WP-RESPONSIVE (design only) | **merged** | `wp-responsive` (PR #29) | **Owner approved and merged 2026-08-21** (squash, `5ef96ba`). Mock only — no app code, no production behaviour change. Coordinator-verified by grep, not by agent summary: 11 `<h2>` sections (10 screens + the tiers explainer), 3 tiers, week nav, month view, Leftovers flows, `[img][info]` thumbnails. The two handover "loose ends" were **false alarms** — all 9 `hero` hits are prose explaining its removal plus an unrelated `.hero-stat` class, and the single `>Show<` is the changelog line documenting the rename. `design/mock-responsive.html` is now the target on `main` for every implementation package. |
| WP-PHOTO | **merged** | `wp-photos` (PR #30) | **Merged 2026-08-21** (squash, `950f922`). CI had passed on `b8fd55d` — both checks `SUCCESS`, re-verified after the coordinator's changelog commit. Agent correctly did **not** merge its own PR. The first merge attempt was refused by the environment's permission classifier (not a review finding); the owner re-authorised and it went through. Coordinator verification below. |

### PR #30 — coordinator verification (measured, not taken from the agent's summary)

**Confirmed good:**
- **Legacy `RecipeStep` rows decode with zero migration.** Verified by reading the codec, not the claim: `decodeRecipeStep` reads `description` at **column index 2**, exactly where the old required `text` cell sat, so an old 3-cell row `[recipe_id, step_number, text]` decodes unchanged. A missing `id` cell is minted deterministically as `legacy:${recipeId}:${stepNumber}`, so repeated reads and separate clients agree on which step a `Photo` belongs to.
- **`ProductPhotos` is gone from live code.** Grepped `src/`, `features/`, `e2e/`: every surviving mention is a comment or doc, no call sites.

**Resolved at review (owner decisions, 2026-08-21):**
- **Owner approved the non-additive deviation**, and chose to **keep** the
  `text` → `description` rename rather than carry two names for the same
  always-visible instruction line. Item 1 below stands as the record of *what*
  was bent and why, not as an open question.
- **Item 2 fixed by the coordinator** on `wp-photos` (`b8fd55d`) — the WP-PHOTO
  entry is now in `src/domain/README.md`, and the M6-A entry above it carries a
  "superseded in part" note so it no longer reads as current.

**Findings, kept as the permanent record of what this change did:**
1. **This is NOT additive-only — the invariant is genuinely bent, by design.** `WorkbookSheetName` loses `"ProductPhotos"`; `RecipeStep.text` is *renamed* to `description`; `RecipeStep.id` is added as **required**; `ProductPhoto`, `MAX_PRODUCT_PHOTO_DATA_URL_LENGTH` and `WorkbookStore.productPhotos` are removed. The *rows* still decode, but the *types* are reshaped. The one-`Photos`-sheet consolidation in `DESIGN_PHOTOS.md` makes some of this unavoidable, and the agent flagged it openly rather than hiding it — but the frozen-contract rule says additive-only, so this needs the owner to say the design intent overrides the letter of the invariant. **The `text` → `description` rename is the piece least forced by the design** and could be kept additive if preferred.
2. ~~**The contract changelog was not updated.**~~ **Fixed before merge** (`b8fd55d`). `src/domain/README.md` is where WP-02 and M6-A recorded their contract changes; WP-PHOTO shipped without an entry, and the M6-A entry still described the now-removed `ProductPhotos` member and `productPhotos` namespace as current. Both corrected — it is the one file whose job is to prevent exactly this drift.
3. **Orphaned tab.** A pre-existing workbook keeps its now-unreferenced `ProductPhotos` tab. Benign — no UI ever wrote to it (M6 barcode UI is unbuilt) — but it will sit there unread.

## Stage 3 — Hardening & release

| WP | Title | State | Branch | Notes |
|----|-------|-------|--------|-------|
| WP-30 | Cross-feature E2E suite | pending | — | needs WP-23; runs alongside WP-24 |
| WP-31 | Release | in-progress | `wp31-readme` (PR #14, **merged**) | README done and merged early. Remaining: onboarding polish, tag v1.0.0, owner's full-loop check. |

## Owner-dependent items — all now COMPLETE

_Nothing is parked or blocked on the owner. Both entries below are kept as the
record of how they were resolved, not as outstanding work._

- **WP-10 live verification — ✅ COMPLETE.** All four steps of `verify-google.html`
  confirmed working against the real Google by the owner, who reported on
  2026-08-21 that the remaining steps had been done "days ago". That closes the
  last untested seam: step 4 (**read `Meta!A1:B1`**) is what proves
  `SheetsTransport` round-trips against the real Sheets API rather than msw, so
  the transport is no longer msw-only evidence.
  - Historical note worth keeping: the first sign-in attempt failed with
    `Error 403: access_denied` because the consent screen was still in
    **Testing** despite HANDOVER §7 recording it as Production. The owner
    published the app; no verification review was needed because `drive.file`
    is non-sensitive. HANDOVER §7 was corrected then.
  - Nothing here is parked or owed by the owner any more.

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

- **Purchasability · pack sizes, whole units and bought meals** — raised by the owner
  2026-08-21 from a live defect (`0.5 Store Bought Lasagna`), designed in
  `DESIGN_PURCHASING.md`. **Proposed, not approved.**
  - **Wider than the reported symptom.** There is no rounding anywhere in the
    shopping engine (the only `Math.*` call is a `Math.min` for FIFO), and **26 of
    the 104 seeded ingredients are `unit: "piece"`** — so `0.5 Onion` is live today
    for a quarter of the catalogue, not just for bought meals.
  - Root cause: `computeNeeds` (`shopping-needs.ts:88`) scales by a raw float and
    nothing downstream converts a requirement into something purchasable.
  - Model: separate **need** (stays fractional — rounding it would corrupt pantry
    depletion) from **buy** (never fractional); surplus becomes stock on check-off,
    which `DESIGN.md` §5 already specifies. Round **once**, after aggregation *and*
    after FIFO stock subtraction.
  - Fixes the whole seeded catalogue with **zero data entry** by deriving defaults
    from the existing `unit` field; pack sizes are progressive enhancement.
  - Bought meals need *recipe-level* whole-unit scaling, not just a whole-unit
    ingredient — and that feeds the already-approved Leftovers flows from PR #29.
  - Contract change would be **additive-only**, unlike WP-PHOTO. No new sheet.
  - **Open: §9.1 (tomatoes — one canonical unit per ingredient forces a choice)**
    and whether to mock the screens before dispatching. Both still unanswered.

- **M6 · Products, barcodes and prices** — specified by the owner 2026-08-20, captured
  in `DESIGN_PRODUCTS.md`. **All three blocking decisions are now settled** (2026-08-21);
  M6 is buildable, scheduled after WP-31.
  1. **Units** — ✅ approved: entry-time conversion only, canonical units stored,
     display converted. `src/domain/units.ts` is the sole sanctioned module
     (lint-enforced). Invariant 3 amended accordingly.
  2. **Cost tracking** — ✅ approved and **in scope**, reversing the `DESIGN.md` §6
     non-goal. Single currency, set in Settings, default `$`.
  3. **Photos** — ✅ settled in `DESIGN_PHOTOS.md`: not Drive file ids but base64 in a
     cell, 512 px WebP within a 32 KB budget, **one** `Photos` sheet, lazy per-visible
     fetch, no heroes, `[img][info]` thumbnails. Being implemented now as WP-PHOTO.
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
| 2026-08-20/21 | Stage 2 | **All feature packages merged**: WP-21 (#22), WP-23 (#24), WP-22 (#26), WP-24 both halves (#16, #20). |
| 2026-08-20/21 | WP-VC…VC4 | **Four unplanned visual-conformance passes merged** (#23, #25, #27, #28). Root cause worth remembering: WP-21's Pantry was built *before* the mock existed in the repo and "matches the mock" was self-reported from a screenshot — it shipped structurally wrong (one row per lot, no detail route) and VC4 had to rework it. Lesson now standing policy: require DOM structural diffs, not screenshots, and design the screen before dispatching it. |
| 2026-08-21 | WP-RESPONSIVE, WP-PHOTO | **PR #29 (`5ef96ba`) and PR #30 (`950f922`) merged.** Integration verified **locally on merged `main`**, because CI runs on `pull_request` only (WP-01 fix) — there is no automatic check on `main`, and #30 had been tested against a base predating #29. Result: lint PASS, typecheck PASS, **940 tests**, build PASS, **162 E2E** PASS (`E2E_PORT=5960`). Before merging #30 the coordinator added `b8fd55d`, recording the contract change in `src/domain/README.md` — the changelog the agent had left unwritten. |
| 2026-08-21 | — | **Coordinator audit on handover.** Re-verified state by measurement rather than from the handover prose, and found four of its claims stale: (1) it reported two agents in flight — the design agent had already finished, leaving PR #29 as completed work awaiting the owner's gate; (2) both of PR #29's flagged "loose ends" were false alarms (see In flight); (3) the review Artifact was described as needing a republish but was **already current** — byte-parity confirmed against the live page, so nothing was published; (4) three known-debt items (LICENSE, `.env.local.example`, stale "nine" comments) were already resolved. Bundle figure corrected from 529/160 kB to a measured 634.56/194.66 kB. |

## Routed contract changes — owner-requested 2026-08-21, now in implementation

- **`Recipe` gains an image**, and **`RecipeStep` gains a short description, a markdown
  detail body, a duration, and an image.** Requested directly by the owner while
  reviewing the responsive mocks. Needs two new sheets (`RecipePhotos`,
  `RecipeStepPhotos` or one keyed photo sheet) plus additive fields on frozen types.
  **The earlier `RecipeStep` audit is now commissioned rather than unrouted** — its
  catalogue of call sites (`bootstrap.ts`, `spreadsheet.ts` `satisfies`-enforced,
  `codecs/index.ts` `Record`-enforced, `spreadsheet.test.ts`,
  `features/wp-11-workbook-bootstrap.steps.ts`) is directly reusable.
  Sequence: design approval → contract-change task → implementation. Photo storage
  reuses the settled rules in `DESIGN_PRODUCTS.md` §5 (50,000-char cell ≈ 36.6 KB,
  32 KB budget at 512 px WebP, own sheet, lazy per-item fetch).
  **Status 2026-08-21:** design settled in `DESIGN_PHOTOS.md` — resolved to **one**
  `Photos` sheet rather than the two speculated above — and dispatched as WP-PHOTO on
  `wp-photos`, in progress. See In flight for the legacy-decode review gate.

## Superseded — previously unrouted proposals

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

- ~~**Stale sheet-count comments.**~~ **Resolved — verified 2026-08-21.**
  `WorkbookSheetName` has twelve members. `features/wp-11-workbook-bootstrap.steps.ts`
  no longer mentions "nine" at all, and the one remaining hit in
  `src/sheets/mocks/handlers.ts:121` is a deliberate note explaining that the count is
  *not* hardcoded. Nothing to fix. (WP-PHOTO will make it thirteen.)

- ~~**No `LICENSE` file.**~~ **Resolved** — `LICENSE` present, `package.json` declares
  `"license": "MIT"`.
- ~~**No `.env.local.example`.**~~ **Resolved** — the file exists.

- **The app white-screens if `VITE_GOOGLE_*` is unset.** WP-20's shell constructs the
  Google wiring at first render and `src/env.ts` throws on first read of a missing
  value, so a build without them renders nothing rather than showing a sign-in screen
  that does not need them until clicked. Production always supplies them; a fork that
  forgets gets a blank page instead of a useful error. WP-31 polish item.
- **Bundle: code-splitting landed in WP-VC3 but bought ~13%, and is now drifting
  back up.** The shared kit chunk is `modulepreload`ed, so it is not actually
  deferred — the initial load is `index` + `components` together. Measured
  634.56 kB raw / 194.66 kB gzip before this run; the photos UI (#33) added
  ~13 kB raw / ~4 kB gzip because `PhotoMedia` is pulled in by the eager `Home`,
  which is justified but the wrong direction. Splitting routes was the easy half;
  the remaining win is inside `components`, not in more route boundaries. WP-31
  item, and worth doing before more features land on top.

- **TypeScript pinned to `^6.0.3`**, not current 7.x: `typescript-eslint@8.67` declares
  peer `<6.1.0`. Revisit as a dedicated dependency-bump task once the ecosystem
  catches up — must not drift in via a feature branch.
- **Picker API key referrer allowlist still contains `http://localhost:5173/*`.**
  Needed for development; worth dropping from the production key at WP-31.

- **WP-VC4 leftovers.** Three gaps carried out of PR #28: the pantry toolbar has two
  buttons where the mock has one; multi-lot Open/Move/Spoil has no E2E coverage; and
  the "Add a lot" dialog duplicates `AddLotForm` rather than reusing it. Fold into the
  Photos-UI or responsive implementation package that next owns those routes.

- **Stale worktree `/opt/mrwho/Projects/feeder-wt/wp-11`** (branch `wp-11`, merged as
  PR #13). Safe to `git worktree remove` — but not while any descendant agent might
  still be using it; the WP-PHOTO agent is live as of this writing.
