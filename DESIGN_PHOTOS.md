# Design addendum — one Photos sheet, one pipeline

**Status: SETTLED (2026-08-21).** Decided by the product owner: *"make a single photos
sheet, build a consistent pipeline to get the photos in and out of the sheet."*

Supersedes the per-entity `ProductPhotos` sheet introduced by M6-A. Companion to
`DESIGN_PRODUCTS.md` §5, whose encoder limits are reused verbatim rather than
re-litigated.

## 1. Why one sheet

Four entities now want photos: **recipes**, **recipe steps**, **ingredients**, and
**products**. Three parallel sheets would mean three codecs, three lazy-fetch paths,
three places to enforce the byte budget, and a fourth copy the next time an entity
wants an image. One sheet means one of each.

## 2. Schema

| Sheet | Columns |
|---|---|
| `Photos` | `owner_kind, owner_id, data_url, updated_at` |

- `owner_kind` — `recipe` \| `recipe-step` \| `ingredient` \| `product`
- `owner_id` — the owner's branded id (`RecipeId`, `StepId`, `IngredientId`, `Barcode`)
- `data_url` — the encoded image (see §4)
- `updated_at` — `IsoTimestamp`; lets a client cache and revalidate without diffing blobs

`(owner_kind, owner_id)` is the key. Insert-or-replace by that pair, exactly like
`ingredients.upsert` by id.

**Never add a `readAll()` on this sheet.** Reading it whole would pull every image in
the workbook — the entire reason photos are not a column on their owner. Access is
**by key, on demand**, for the items currently visible.

## 3. ⚠️ `RecipeStep` needs a stable id — photos cannot key on position

`RecipeStep` is currently `{ recipeId, stepNumber, text }`. There is **no stable
identity**: a step is addressed by its position.

Key a photo on `stepNumber` and **reordering steps silently reassigns every photo to
the wrong step**. Delete step 2 of five and photos 3, 4, 5 all shift onto the wrong
instructions. Nothing errors; the data is quietly wrong, and a user would blame
themselves.

**So the `RecipeStep` widening must add a branded `StepId`**, generated client-side
from the injected `Rng` like every other id, and photos key on that. `stepNumber`
stays as the *ordering* field it already is — position and identity become separate
concerns, which is what they always were.

## 4. Encoding — unchanged from `DESIGN_PRODUCTS.md` §5

- A Google Sheets cell holds **50,000 characters**; base64 inflates by 4/3, so the
  ceiling is **~36.6 KB of image**.
- The encoder targets a **32 KB budget** at **512 px** longest side, WebP: try
  `q85 → q75 → q65 → q55 → q45 → q35`, then downscale `448 → 384 → 320` at q60.
  Quality alone is not enough — a noisy photo barely shrinks with quality, so the
  budget must be enforced by measurement, not by a quality setting.
- **PNG is rejected**: lossless, built for flat graphics, 5–10× larger on photographs.
- The codec is the backstop: a `data_url` over the cell limit is **refused and
  reported**, never silently truncated.

## 5. 512 px is a layout limit as well as a storage limit

The two are the same decision seen from different ends, and missing that connection
already produced one bad design (a full-width hero fed by a 512 px source).

- **Never display wider than 512 CSS px.**
- **Prefer ≤ 320 CSS px** — on a 2× display, 512 physical px shown at 320 CSS px is a
  modest 1.6× upscale and still reads clean.
- **True crispness on a 2× display needs ≤ 256 CSS px.**

Hence: leading thumbnails on cards, a contained image on a detail page, ~48–64 px in
a list row, **no heroes anywhere**.

## 6. The pipeline

One module in, one module out — not four implementations.

**In (write):** file or camera → crop → resize to 512 px → encode WebP under the 32 KB
budget → `data_url` → `photos.upsert(ownerKind, ownerId, dataUrl)`.

**Out (read):** `photos.get(ownerKind, ownerId)` for **visible items only**, with the
kit's `Skeleton` while in flight and a calm neutral placeholder when absent.

**The no-photo state is the default, not an edge case.** A fresh workbook has 104
seeded ingredients and zero photos. Placeholders must look deliberate.

**Text never waits on an image.** Names, quantities and counts render immediately
whether or not a photo ever arrives.

## 7. The one non-additive change, and why it is safe now

Folding `ProductPhotos` into `Photos` **removes** a `WorkbookSheetName` member — the
only non-additive contract change here. It is safe **only because that sheet has never
held data**: M6's barcode UI is unbuilt and nothing in `src/` writes to it. Verified
before deciding.

Doing this later, once a household has scanned its first product, would mean a real
data migration. It is free exactly once, and this is that moment.

## 8. Sequencing

Contract change and pipeline **first** — they are independent of the visual design and
can proceed while the mock is still under review. Feature UI follows.
