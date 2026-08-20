# Design addendum — Products, barcodes and prices

**Status: mostly SETTLED (2026-08-20).** Units and cost tracking are decided by
the owner; the photo *storage format* has one open sub-decision (§5). Scheduled as
M6, after the M1–M5 pipeline.

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
ingredient is *rice*; a product is *Riso Gallo Arborio 1 kg, barcode 8001120000123*.
Many products map to one ingredient. This is the missing layer that makes a barcode
meaningful.

Provisional sheets, following the existing one-row-one-fact rule (invariant 6):

| Sheet | Contents |
|---|---|
| `Products` | `barcode, name, brand, ingredient_id, canonical_quantity, canonical_unit, display_quantity, display_unit, shelf_life_days, is_bulk, photo_data_url` |
| `PriceObservations` | append-only: `timestamp, barcode?, ingredient_id, quantity, unit, price, source` |

`canonical_*` drives every calculation; `display_*` is shown to the human ("1 lb
bag") and never used in arithmetic. `PriceObservations` carries no currency column —
the household has one currency, held in Settings.

`PriceObservations` is append-only for the same reason `InventoryEvents` is: it is
a time series, corrections are new rows, and two clients appending never collide.

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

**Therefore:** **320 px longest side, WebP, quality ~0.6 (~12–18 KB).** Fits the
cell limit with headroom and stays cheap to sync. PNG is explicitly rejected: it is
lossless, built for flat graphics, and runs 5–10× larger than WebP on photographs.

Photos are **loaded lazily and excluded from the cached snapshot** — they are the
one field that must never enter the localStorage fold.

This is a bounded, documented exception to invariant 6 rather than a silent one:
one column, one entity, and it is why the limit and the format are recorded here.

## 6. Remaining decisions

**Open (owner):** confirm 320px WebP for photos, given 1024px PNG cannot fit a cell
(§5). If full-resolution photos matter more than automatic sharing, the Drive-file-id
route is the alternative.

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
