# Design addendum — Products, barcodes and prices

**Status: SETTLED (2026-08-20); re-keyed 2026-08-23 (WP-PRODUCTS-MODEL, §8).**
Units, cost tracking and photo storage are all decided by the owner. M6 shipped;
the product re-key (§8) is a subsequent, owner-approved contract change on top of
it, not a new milestone.

Companion to `DESIGN.md` (authoritative product design) and `HANDOVER.md` §4
(invariants).

## 1. What the owner asked for

**Scan flow**

1. Scan a barcode.
2. **New barcode** → open the product editor:
   - name
   - brand
   - category / ingredient — pickable from the current shopping list for speed
   - optional photo
   - unit (`kg`, `oz`, `lb`, `number`)
   - package content, in those units
   - default expiration as a **duration** ("6 months", "10 days")
   - **Bulk** flag
   - price per unit / weight
3. **Known barcode** →
   - packaged: update the list for the known category / ingredient
   - bulk: ask for the unit / weight
   - optionally record a new price
4. **Price history** is kept at **two levels** — per category/ingredient and per
   specific product — so fluctuations are visible over time.

**Explicitly deferred by the owner:** shop detection. Shops would be entered in
settings with a photo, a description, and a "use current location" pick. Not now.

## 2. What this adds to the domain

A **Product** is a new first-class entity, distinct from an `Ingredient`. An
ingredient is *rice*; a product is *Riso Gallo Arborio 1 kg*. Many products map to
one ingredient. This is the missing layer that makes a barcode meaningful.

**Re-keyed 2026-08-23 (WP-PRODUCTS-MODEL, owner-approved).** A `Product` now owns
its own identity (`ProductId`), independent of any one barcode — see §8 below for
why and what changed. What follows is the CURRENT schema; the original
barcode-as-identity design that shipped as M6-A is kept in git history, not here.

Sheets, following the existing one-row-one-fact rule (invariant 6):

| Sheet | Contents |
|---|---|
| `Products` | `id, name, brand, ingredient_id, canonical_quantity, canonical_unit, display_quantity, display_unit, shelf_life_days, is_bulk, has_photo` |
| `ProductBarcodes` | `product_id, barcode` — one row per barcode a product is sold under |
| `Photos` | one shared sheet for every photo-owning entity, keyed `(owner_kind, owner_id)` — a product's `owner_id` is its `ProductId` (see DESIGN_PHOTOS.md) |
| `PriceObservations` | append-only: `timestamp, barcode?, ingredient_id, quantity, unit, price, source` |

`canonical_*` drives every calculation; `display_*` is shown to the human ("1 lb
bag") and never used in arithmetic. `PriceObservations` carries no currency column —
the household has one currency, held in Settings. `PriceObservations.barcode` is
unchanged by the re-key: an observation genuinely happened at a specific barcode,
and resolving which product that barcode currently belongs to is a lookup over
`ProductBarcodes`, never a rewrite of price history.

`PriceObservations` is append-only for the same reason `InventoryEvents` is: it is
a time series, corrections are new rows, and two clients appending never collide.

**Photos live in their own sheet, not as a `Products` column.**
`WorkbookStore.readAll()` reads whole sheets, so a photo column would drag every
photo down the wire on every product listing — 100 products × 30 KB ≈ 3 MB on a
shop connection. Split, the products list stays light and photos load only when
displayed.

## 3. Units — ✅ SETTLED: entry-time conversion, store both

**This is the architectural one.**

`HANDOVER.md` §4.3: *"One canonical unit per ingredient. No conversion logic
anywhere. Reject mixed-unit writes at the codec layer."*
`DESIGN.md` §6 non-goals: *"No unit conversion (one canonical unit per ingredient;
piece-weight conversion is a possible v2)."*

The `Unit` union is deliberately `g | ml | piece | portion` — **no `kg`, no `l`** —
and WP-02's review recorded that as intentional. WP-11 enforces it: a recipe line
whose unit disagrees with its ingredient's canonical unit is quarantined as a data
warning on read and throws on write.

The request asks for `kg`, `oz`, `lb`, `number`. If a 1 lb bag of rice is stocked
against ingredient `rice` (canonical `g`), something must turn 1 lb into 454 g.
That is conversion, and it is currently banned everywhere.

**Recommended resolution — entry-time conversion only:**

- The editor lets the user enter *any* supported unit (`kg`, `g`, `lb`, `oz`,
  `number`/`piece`, `l`, `ml`, `fl oz`).
- It converts **once, at entry**, and stores `package_quantity` in the
  **ingredient's canonical unit**. The workbook only ever holds canonical units.
- `entered_unit` / `entered_quantity` are stored **for display and provenance
  only** ("1 lb bag"), never used in arithmetic.
- The conversion table lives in exactly one module, used only by the product
  editor. **No engine, codec or sheet ever converts.** Invariant 3 continues to
  hold for the domain; what changes is that the *input* layer is allowed to
  translate before it writes.

This keeps every existing guarantee — FIFO, shopping maths and the fold still see
one unit per ingredient — while not forcing a human to type 454.

**Owner decision (2026-08-20): approved.** Store **both** values — the canonical
quantity for all arithmetic, and the entered quantity purely for display. A 1 lb
bag of rice records `454 g` as canonical and shows "1 lb bag" in the UI.

Invariant 3 is amended in scope, not abandoned: *no engine, codec, fold or sheet
converts*. Conversion happens once, in the product editor, before anything is
written. `HANDOVER.md` §4.3 must be updated to say so explicitly, or WP-11's codec
guard will read as contradicting this.

## 4. Cost tracking — ✅ SETTLED: in scope, single currency

`DESIGN.md` §6: *"No nutrition, **cost tracking**, or recipe import/scraping."*

Price capture and price history are cost tracking. The owner may reverse their own
decision, but `DESIGN.md` must be amended to say so rather than left contradicting
the build.

**Owner decision (2026-08-20): cost tracking is in scope.** `DESIGN.md` §6 must
drop it from the non-goals list.

- **Currency: a single value in Settings, defaulting to `$`.** Not per-row — the
  household has one currency. Rows therefore need no currency column; the setting
  is applied at display time.
- Price per *weight* implies normalising to a comparable base (price per 100 g,
  say) for fluctuation to mean anything across a 500 g and a 1 kg pack. That
  normalisation is arithmetic on units — see §3.

## 5. Photos — data URL, but the size needs deciding

`HANDOVER.md` §4.6: *"The workbook stays human-readable. No JSON blobs in cells."*
An image cannot go in a cell.

**Owner decision (2026-08-20): store the image inline as a data URL**, user-cropped
and compressed, rather than as a Drive file. Rationale: a Drive file is not shared
when the workbook is shared, so household members would see broken thumbnails until
each photo was individually permissioned.

**Two hard constraints bound the format:**

1. **A Google Sheets cell holds at most 50,000 characters.** Base64 inflates binary
   by 4/3, so the ceiling is **~36.6 KB of image per cell**. A 1024px PNG is
   400 KB–1.5 MB — between 11× and 40× over. Even 1024px WebP at q60 (~50 KB) does
   not fit.
2. **The snapshot cache lives in localStorage, ~5 MB total.** 100 products at 25 KB
   of base64 each consumes half the entire quota, competing with the inventory
   snapshot that actually needs it.

**Owner decision (2026-08-20): 512 px.** Measured and confirmed viable — but
**specified as a byte budget, not a quality number**, because measurement showed a
fixed quality cannot guarantee a size:

| 512 px test image | q70 | q60 |
|---|---|---|
| Complex / detailed | 13.0 KB ✅ | 10.8 KB ✅ |
| Typical product shot | 4.8 KB ✅ | 2.7 KB ✅ |
| **Noisy packaging shot** | **71 KB ❌** | **70.9 KB ❌** |

Dropping q80 → q50 on the noisy image saved **1%** — sensor noise is incompressible
detail, and pre-denoising only reached 52 KB, still over. That is exactly the photo
a phone takes under supermarket fluorescents.

**The encoder therefore targets bytes:**

```
budget 32 KB (headroom under the 36.6 KB ceiling)
try q85 → q75 → q65 → q55 → q45 → q35 at 512 px
still over? downscale 448 → 384 → 320 px at q60
```

Verified: normal photos land at **q85** — better quality than a fixed 0.6 — and the
pathological case degrades to 320 px / 22.8 KB rather than silently breaching the
cell limit. A breach is not a warning, it is data loss.

PNG is rejected outright: lossless, built for flat graphics, 5–10× larger than WebP
on photographs.

Photos are **loaded lazily and excluded from the cached snapshot** — they are the
one field that must never enter the localStorage fold.

This is a bounded, documented exception to invariant 6 rather than a silent one:
one column, one entity, and it is why the limit and the format are recorded here.

## 6. Remaining decisions

**All owner decisions are now settled.** M6 is ready to plan once the M1–M5
pipeline lands.

**Coordinator will decide unless told otherwise:** the product-lookup
source for unknown barcodes (Open Food Facts vs. manual-entry-only), and the iOS
barcode decoder (`BarcodeDetector` is absent in Safari, so iPhone needs a WASM
fallback with real bundle cost for an offline PWA).

## 7. Sequencing

This is a milestone, not a work package — it adds two sheets, one entity, a
contract change, a scanner, a lookup path and a price history view. It slots after
the M1–M5 pipeline currently in flight, as **M6**, and should not disturb it.

Shop detection (owner-deferred) would be M7: a `Shops` sheet, a geolocation pick,
and `PriceObservations.source` pointing at a shop id — which is why that column
exists in §2 now, so adding shops later does not require rewriting price history.

## 8. The product re-key (WP-PRODUCTS-MODEL, 2026-08-23, owner-approved)

**The problem, in the owner's own words:** tomatoes carry a different barcode in
each shop, but they are one product and one ingredient. Under M6-A's original
design, `Product.barcode` WAS the product's identity — so the same physical
product sold under a different barcode became a different `Product`: duplicated
name/brand/photo/shelf-life, and price history that could never be recombined
across shops.

**Decision: a `Product` is its own entity, owning a *set* of barcodes.** This is
the correct normalisation, chosen knowingly over a lower-risk alias scheme. See
§2 above for the resulting schema (`ProductId`, `ProductBarcodes`) and
`src/domain/README.md`'s changelog entry for the exact contract diff.

**Existing duplicates are merged only with the owner's confirmation** — never
automatically. `src/domain/products.ts` exports pure, unit-tested detection
(`suggestProductMerges`) and planning (`planProductMerge`) functions; nothing
calls them yet. The detection rule requires ALL of: same `ingredientId` (exact),
same canonical package size (same unit, amount within 2% — tolerating
unit-conversion rounding), and overlapping names (token-Jaccard similarity
≥ 0.5) — deliberately biased toward under-suggesting, because a wrong confident
merge prompt shown against the owner's real data is worse than a missed one.
`confidence: "high"` when names are near-identical or the brand also matches,
`"medium"` otherwise; a UI may use this to word the prompt, never to skip
confirmation.

**Migration.** A legacy (pre-re-key) `Products` row's identity WAS a validated
barcode string — which is always a non-empty string, so it decodes unchanged as
a `ProductId` with zero row-shape change. What a legacy workbook is missing is
the `ProductBarcode` row linking that same string back to itself; this is
backfilled idempotently and non-destructively every time a workbook opens (see
`src/sheets/product-barcode-migration.ts`), never as a one-time irreversible
script against the owner's only live workbook.

**Price charts** (owner decision 3: one line per product, split by shop) are the
next, still-undispatched UI task. This package makes that buildable — `Product`
has a stable identity to group by, and price/shop data now exists to plot,
thanks to §"Source capture" below — but builds no screen. The existing
price-history views (`src/routes/products/**`) still group by barcode, not by
`ProductId`; a merged product's several barcodes render as separate rows there
until that follow-up lands. Nothing is lost in the meantime — every observation
still shows, under whichever barcode named it.

**Source capture.** `PriceObservation.source` was specified in §2 from the start
but, until now, written in exactly one place: a test. The scan flow's product
editor, the known-product confirm dialog, and the shopping route's check-off
sheet all now offer an optional free-text "Where did you buy this?" field,
suggesting previously-used values (most-recent first) via a `<datalist>` — never
a picklist, since §7 defers a structured `Shops` sheet to M7.

## 9. The price chart's three views (owner decision, 2026-08-23)

Owner decision 3 in §8 said "one line per product, split by shop". The owner has
since widened it: the products screen offers **three views of the same
observations**, chosen by the reader, not by us.

| View | What it plots | Answers |
|---|---|---|
| **Overall** | Every observation for the product as one series, shop ignored | "What am I typically paying for this?" |
| **By shop** | One series per shop, each independently toggleable | "Where is this actually cheaper?" |
| **Average across shops** | One series: the mean of the per-shop values at each point | "What does this cost in general, without my shopping habits skewing it?" |

**Overall and Average are not the same chart, and the difference is the point.**
Overall is *observation-weighted*: eight cheap trips to one shop and one dear
trip elsewhere pull it toward the cheap shop, because that is genuinely what the
household pays. Average is *shop-weighted*: every shop counts once regardless of
how often it was visited, which is the honest number for "is this product dear
or cheap", independent of where this household happens to shop. Implement both
literally; do not let one silently become the other, and do not "simplify" them
into a single series.

**Observations with no shop recorded.** Every observation written before §8's
source capture has no `source`, and the field stays optional forever — a person
in a hurry will skip it. So the unrecorded ones are a real, permanent bucket, not
a migration artefact:

- **Overall** includes them, unremarkably — the price was still paid.
- **By shop** groups them under one clearly-labelled series and lets it be
  toggled like any other. It must not be silently dropped, and it must not be
  called "Unknown" in a way that reads as an error — nothing went wrong, the
  shop simply was not noted.
- **Average across shops** excludes them, because they cannot be attributed to a
  shop and including them would quietly re-weight the average toward wherever
  the unlabelled purchases happened. Say so on the chart when any are excluded,
  rather than letting the two averages disagree unexplained.

Until enough shops are recorded, **By shop** and **Average** will be thin or
empty. That is a legitimate empty state with a real next action ("note where you
shop when you check items off"), not a broken chart.

**Comparability.** A merged product's barcodes all share a pack size within 2%
(§8's merge rule), so plotting price per pack is sound within one product.
Across products it is not — a 400 g jar and a 700 g jar are not comparable by
pack price — so any cross-product or per-ingredient view must normalise to the
ingredient's canonical unit via `src/domain/units.ts`, which remains the only
sanctioned conversion module (invariant 3).
