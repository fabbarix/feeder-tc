# Design addendum — Products, barcodes and prices

**Status: PROPOSED, not settled.** Specified by the product owner on 2026-08-20.
Three decisions are still open (§6) and two of them change decisions recorded as
settled in `DESIGN.md`. Nothing here is buildable until those are resolved.

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
| `Products` | `barcode, name, brand, ingredient_id, package_quantity, package_unit, entered_unit, entered_quantity, shelf_life_days, is_bulk, photo_file_id` |
| `PriceObservations` | append-only: `timestamp, barcode?, ingredient_id, quantity, unit, price, currency, source` |

`PriceObservations` is append-only for the same reason `InventoryEvents` is: it is
a time series, corrections are new rows, and two clients appending never collide.

## 3. ⚠️ Conflict 1 — units (invariant 3)

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

**This still weakens invariant 3's letter and needs the owner's explicit approval.**
The alternative is to reject non-canonical entry outright, which is architecturally
purer and materially worse to use in a shop.

## 4. ⚠️ Conflict 2 — cost tracking was a stated non-goal

`DESIGN.md` §6: *"No nutrition, **cost tracking**, or recipe import/scraping."*

Price capture and price history are cost tracking. The owner may reverse their own
decision, but `DESIGN.md` must be amended to say so rather than left contradicting
the build.

Consequences once accepted:
- **Currency** becomes a settings field. Prices without a currency are unusable,
  and a household that shops abroad will produce mixed rows.
- Price per *weight* implies normalising to a comparable base (price per 100 g,
  say) for fluctuation to mean anything across a 500 g and a 1 kg pack. That
  normalisation is arithmetic on units — see §3.

## 5. ⚠️ Conflict 3 — photos vs. a human-readable workbook

`HANDOVER.md` §4.6: *"The workbook stays human-readable. No JSON blobs in cells."*
An image cannot go in a cell.

**Recommended resolution:** the app already holds the `drive.file` scope and can
create files it owns. Store the photo as a Drive file and keep only its **file id**
in the `Products` row. The cell stays a short readable string, the invariant holds,
and no new scope is needed.

Costs to accept: photos are extra Drive round-trips, need their own offline story
in the PWA (an image is far larger than an outbox event), and sharing a workbook
does **not** automatically share the photos — each photo needs its own permission,
or household members see broken thumbnails.

**Alternative:** drop photos from v1. They are the least load-bearing part of the
request and by far the most machinery.

## 6. Open decisions — blocking

1. **Units.** Approve entry-time conversion (§3), or require canonical-unit entry?
2. **Cost tracking.** Confirm the `DESIGN.md` §6 non-goal is reversed, and name the
   currency handling.
3. **Photos.** Drive-file-id in v1, or defer photos?

Non-blocking, coordinator will decide unless told otherwise: the product-lookup
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
