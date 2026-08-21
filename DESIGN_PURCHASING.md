# Feeder — Purchasability: pack sizes, whole units and bought meals

Status: **proposed**, awaiting owner decisions (§9). Raised by the owner 2026-08-21
from a live defect: a bought lasagna serving 4, in a 2-person household, appears on
the shopping list as **"0.5 Store Bought Lasagna"**.

Related settled design: `DESIGN.md` §2 (Recipes, Servings/scaling/leftovers), §5
(Shopping list), `DESIGN_PRODUCTS.md` §2 (`Product.canonicalQuantity`, `isBulk`).

---

## 1. The defect is three defects with one root cause

The pipeline has **no concept of purchasability**. `computeNeeds`
(`src/domain/shopping-needs.ts:88`) multiplies each recipe line by a raw float
`targetServings / baseServings`, and nothing downstream ever converts that
requirement into something you can actually put in a basket. Verified by grep:
the only `Math.*` call in the whole shopping engine is a `Math.min` for FIFO
allocation. **There is no rounding anywhere.**

Three symptoms:

1. **Bought meals are scaled like flour.** `DESIGN.md` §2 models a bought meal as
   "a single ingredient line pointing to a catalog entry for the product itself"
   and mandates "one code path for both kinds". That one code path is the bug: a
   lasagna is not a divisible quantity. → `0.5 Store Bought Lasagna`.
2. **Countable ingredients go fractional.** **26 of the 104 seeded ingredients are
   `unit: "piece"`** — onion, garlic, lettuce, cucumber, bell pepper, banana,
   apple… Any recipe scaled to a non-multiple household produces `0.5 Onion`,
   `1.3 Tomato`. This is live today for a quarter of the catalogue, not an edge case.
3. **Packaged goods ignore the pack.** A recipe needing 50 g of mayonnaise lists
   `50 g` when no shop sells 50 g. `DESIGN.md` §5 already anticipated this and
   parked it: *"v1.1 candidate: optional typical package size in the catalog so
   the list pre-rounds to whole packages."* This proposal pulls that in, because
   symptom 1 cannot be fixed properly without the same machinery.

---

## 2. The model: three quantities, not one

The single biggest clarification. Today the app conflates *what the food needs*
with *what you buy*. They are different numbers and both are correct.

| | Meaning | Fractional? |
|---|---|---|
| **Need** | What the recipes require over the range, after FIFO pantry subtraction | **Yes — and it must stay so** |
| **Buy** | What goes in the basket | **Never** — always a purchasable amount |
| **Surplus** | `Buy − Need`, becomes pantry stock on check-off | Whatever falls out |

**Need must stay fractional.** A recipe genuinely uses half an onion; rounding the
*need* would corrupt pantry depletion and make the inventory drift. We only ever
round the **buy**.

The app already has the right seam for this — `ShoppingItem` carries both
`neededQuantity` and `boughtQuantity`, and `DESIGN.md` §5 already specifies that
in-store check-off "corrects for package sizes (needed 400 g, bought 1 kg) and the
surplus becomes pantry stock". **What is missing is a *suggested* buy quantity**,
computed up front, instead of silently defaulting buy = need.

### 2.1 Round once, at the end

Non-negotiable ordering, and the easiest thing to get wrong:

```
per-meal needs → aggregate across range → subtract viable stock (FIFO) → THEN round to purchasable
```

Rounding per-meal would buy three jars of mayonnaise for three meals that need 50 g
each. Rounding before stock subtraction would buy a jar you already own. The
rounding stage therefore belongs at the **end** of `allocateShoppingList`, operating
on the already-aggregated shortfall.

---

## 3. Purchase modes, with defaults that need no data entry

Per ingredient:

- **`whole`** — sold as indivisible units. `buy = ceil(need / packSize) × packSize`.
  A jar of mayo, an onion, a lasagna.
- **`loose`** — sold by weight/volume, any amount. `buy = need`, optionally rounded
  up to a `roundTo` step. Mince, potatoes, flour.

**The defaults are the whole point of this section.** Derived from the existing
`Ingredient.unit`, so the fix works on day one across the entire seeded catalogue
with zero data entry and zero migration:

| `unit` | Default mode | Default pack | Effect |
|---|---|---|---|
| `piece` | `whole` | `1 piece` | Fixes all 26 seeded piece-ingredients **and** the lasagna, immediately |
| `g` / `ml` | `loose` | — | Exactly today's behaviour; nothing regresses |
| `portion` | `whole` | `1 portion` | Leftovers are already whole portions |

Pack size is then **progressive enhancement**: the household adds "250 g jar" to
mayonnaise when they care, and that ingredient starts rounding to jars. Nobody is
forced to fill in a form for 104 ingredients before the app stops saying `0.5 Onion`.

Where a specific `Product` is known (M6, barcode-scanned), its
`canonicalQuantity` — which `DESIGN_PRODUCTS.md` already defines as "Package size
in the ingredient's canonical unit" — **overrides** the ingredient's typical pack.
The ingredient-level pack is the *typical* case; the product is the *actual* one.
This is why this design deliberately does not wait for M6: it degrades cleanly.

---

## 4. Bought meals: an indivisible recipe, not an indivisible ingredient

Fixing symptom 2 does *not* fix symptom 1, and this is the subtle part.

Making the "Store lasagna" ingredient `whole` would round `0.5 → 1`, which happens
to give the right basket. But it is right by accident and wrong in general: at
household 5 with `baseServings: 4` it yields `1.25 → 2` — correct — while at
household 9 it yields `2.25 → 3`, also correct, yet the app still has no idea it
just bought 12 servings for 9 people. The surplus is invisible.

The honest model: **scale the recipe in whole units, then account for the yield.**

```
units    = ceil(targetServings / baseServings)
produced = units × baseServings
surplus  = produced − targetServings        → leftover portions
```

Lasagna, `baseServings: 4`, household 2 → **1 lasagna, 4 servings produced, 2
portions left over.**

This is the intuitive answer a person would give, and it lands exactly on the
**Leftovers** feature already designed in the approved mock (PR #29): the Leftovers
tab, mark-cooked reconciliation ("8 servings cooked → 4 portions leftover,
editable"), and leftovers filling future plan slots. A bought meal is the single
clearest generator of leftovers in the whole app, and today it silently pretends to
be half a lasagna instead.

Applies to any recipe whose yield cannot be subdivided — `kind: "bought"` is the
obvious case, but a cooked recipe can be indivisible too (one 9-inch quiche). So
the flag belongs on the recipe, defaulting to `kind === "bought"`.

---

## 5. Scenario table

Every row verified against current code behaviour.

| # | Scenario | Today | Proposed |
|---|---|---|---|
| 1 | Bought meal serves 4, household 2 | `0.5 Store Bought Lasagna` | `1 lasagna` · serves 4 · **2 portions leftover** |
| 2 | Bought meal serves 2, household 5 | `2.5` | `3 lasagnas` · 1 portion leftover |
| 3 | Recipe needs ½ onion | `0.5 Onion` | `1 Onion` · ½ surplus to pantry |
| 4 | Three meals × ½ onion | `1.5 Onion` | `2 Onions` — rounded **once**, after aggregation |
| 5 | Needs 50 g mayo, jar is 250 g | `50 g Mayonnaise` | `1 jar (250 g)` · need 50 g |
| 6 | Three meals × 50 g mayo | `150 g` | `1 jar` — **not** 3 |
| 7 | Needs 300 g mayo, jar is 250 g | `300 g` | `2 jars (500 g)` |
| 8 | Needs 300 g mayo, 200 g already in pantry | `100 g` | `1 jar` — rounded **after** stock subtraction |
| 9 | Needs 200 g tomatoes, household wants 500 g | no affordance at all | override to `500 g`, 300 g surplus |
| 10 | Loose goods, no pack size set | `237 g` | `237 g` unchanged, or `250 g` if `roundTo` set |
| 11 | Pantry fully covers the need | no line | no line — unchanged |
| 12 | Ingredient is `piece` but shopper thinks in grams (tomatoes) | mismatch | **open — see §9.1** |

---

## 6. The shopping experience

The list is used one-handed, in a shop, at speed (`UI_DESIGN.md` §5). So:

- **The buy amount is the primary number.** It is what you reach for. The need is
  secondary context, not the headline.
  - `Mayonnaise` — **1 jar** · *needs 130 g*
  - `Store lasagna` — **1** · *serves 4, you need 2*
  - `Onion` — **2** · *needs 1.5*
- **The existing "Why?" disclosure is where the arithmetic goes.** `Shopping.tsx:179`
  already renders *"Why 130 g mayonnaise?"* with per-meal provenance. Extend it with
  one line explaining the rounding — *"3 meals need 130 g; sold in 250 g jars"* —
  rather than cluttering the row. The row states the decision; the disclosure
  defends it.
- **Adjusting the amount is a first-class tap, not a hidden edit** (scenario 9).
  Tapping the quantity opens a stepper: `whole` items step by one pack, `loose`
  items by the `roundTo` step or a sensible increment. This is the owner's "I want
  500 g of tomatoes" case, and it must persist across a plan recompute — otherwise
  the next reroll silently discards it.
- **No new alarm colours.** Surplus is normal and expected, not a warning. A rounded
  line is not an error state and must not read as one.
- **Leftover forecast on the plan, not just the list.** If a slot will produce
  leftovers (§4), the plan slot should say so — it makes the existing
  leftover-slot suggestion smarter and explains the basket before the shop, not after.

---

## 7. Contract changes — additive-only, unlike WP-PHOTO

All new fields are optional, all legacy rows decode, nothing is renamed or removed.
This one genuinely fits inside the frozen-contract rule.

- `Ingredient` gains `purchaseMode?: "whole" | "loose"` (absent ⇒ derived per §3),
  `packSize?: Quantity`, `roundTo?: number`.
- `Recipe` gains `indivisible?: boolean` (absent ⇒ `kind === "bought"`).
- `ShoppingItem` / `ShoppingListLine` gain `suggestedPurchase?: Quantity` (computed)
  and `purchaseOverride?: Quantity` (the household's explicit choice, persisted).
- New pure module `src/domain/purchasing.ts`: `suggestPurchase(need, ingredient,
  product?)` and `scaleIndivisible(recipe, targetServings)`. Pure, unit-testable,
  no I/O — same shape as the other engines.

Sheets: three optional columns on `Ingredients`, one on `Recipes`, two on
`ShoppingItems`. No new sheet, so `WorkbookSheetName` is untouched.

---

## 8. Ingredient & recipe editing

- Ingredient editor gains an optional **"How you buy it"** group: a two-option
  segmented control (Whole / Loose) plus a pack-size field shown only for Whole.
  Collapsed and optional — the defaults in §3 mean most ingredients never need it.
- Recipe editor gains an **"Can't be split"** toggle, pre-checked for bought meals,
  with helper text naming the consequence: *"Scales in whole units — extras become
  leftovers."*
- Both are additive to screens that already exist in the approved mock; neither
  needs a new route.

---

## 9. Open decisions — owner

**9.1 — the one that actually needs you: tomatoes.** The seed catalogue has
`Tomato` as `unit: "piece"`, but the owner's own example says *"200 gr of
Tomatoes"*. Both are legitimate: a salad wants "2 tomatoes", a sauce wants "400 g".
Invariant 3 gives each ingredient exactly **one** canonical unit, so:

- **(a) Re-unit the ambiguous seeds to `g`** (tomato, potato-like produce). Cheap,
  no new machinery, recipes then read "400 g tomatoes". Loses "2 tomatoes" phrasing.
- **(b) Let an ingredient declare a purchase unit different from its canonical unit**,
  with a conversion (1 tomato ≈ 120 g). Models reality honestly, but adds a
  conversion surface — and invariant 3 confines conversion to `src/domain/units.ts`
  at entry time only, so this needs a deliberate amendment.
- **Recommendation: (a) now, (b) only if it still hurts.** (b) is a real feature,
  not a tweak, and it would delay the fix for the three symptoms that bite today.

**9.2 — Pack sizes: ingredient-level now, or wait for M6 barcodes?**
Recommend ingredient-level now, with `Product` overriding later (§3). Waiting for
M6 blocks a live defect behind an unbuilt milestone.

**9.3 — Does a bought-meal surplus pre-create the leftover, or wait for mark-cooked?**
Recommend **forecast in the plan, create at mark-cooked** — it matches the existing
reconciliation flow (which already lets the household correct the portion count,
because reality disagrees with arithmetic) rather than inventing a second path.

**9.4 — Should `roundTo` ship in v1, or is `whole` + `loose` enough?**
Recommend deferring `roundTo`. Scenario 10 is the weakest of the twelve, and
`packSize` on a `whole` ingredient already covers most real rounding.
