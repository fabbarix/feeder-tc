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
- Ingredient editor also gains an optional **"How you measure it"** group —
  owner-requested 2026-08-21: **the household can set the conversions themselves.**
  Two fields, `gramsPerMl` (density) and `gramsPerPiece` (typical item weight),
  written in the household's own language rather than as jargon:
  - *"1 cup weighs ___ g"* → stored as `gramsPerMl = value / 240` (§10.2). Asking
    for a cup weight is answerable from a kitchen scale; asking for "density in
    g/ml" is not.
  - *"1 ___ weighs ___ g"* for countables ("1 onion weighs 150 g").
  - Each field shows the seeded default as its placeholder, so the household sees
    what the app already assumes and overrides only when it disagrees. **Every
    seeded ingredient ships with sane defaults** (§10.4 pass 2) — editing is for
    correction, never a prerequisite.
  - Leaving a field empty is valid and safe: that ingredient simply does not offer
    the units it cannot convert (§10.1), rather than guessing.
- Recipe editor gains an **"Can't be split"** toggle, pre-checked for bought meals,
  with helper text naming the consequence: *"Scales in whole units — extras become
  leftovers."*
- Both are additive to screens that already exist in the approved mock; neither
  needs a new route.

---

## 9. Open decisions — owner

**9.1 — tomatoes — ✅ DECIDED by the owner 2026-08-21: re-unit produce to grams.**
Ambiguous produce (tomato, and the other weighable `piece` seeds) becomes
`unit: "g"`. Recipes then read "400 g tomatoes", and those ingredients fall into
`loose` mode, where buying 200 g or 500 g are both valid.

**This does not delete the "2 onions" problem, it moves it.** A recipe author still
writes "2 onions", not "300 g onion". So re-uniting to grams *requires* the
entry-time conversion in §10 — specifically `gramsPerPiece` — or recipe entry gets
worse, not better. The two decisions are one change, not two.

Note the mode flips as a side effect: a `g` ingredient defaults to `loose`, so
re-united produce stops rounding to whole items. That is correct for tomatoes
bought by weight. It is **wrong for anything genuinely countable** — eggs, lemons,
a lettuce — so those must stay `piece`. §10.4 lists which seeds move and which
do not; that list needs an eye before it ships.

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

---

## 10. Recipe entry units: cups, pounds and spoons → grams

Owner-requested 2026-08-21, alongside §9.1. A recipe author writes "1 cup flour",
"2 lb mince", "1 tbsp oil", "2 onions". The workbook must store grams, because
grams are what pantry depletion and shopping arithmetic run on.

This is **entry-time conversion**, the exception already carved out for M6-A: store
canonical, keep what the human typed for display, and confine every conversion to
`src/domain/units.ts` — the sole sanctioned module, lint-enforced. Nothing new is
being invented here; the same pattern `Product` already uses is being applied to
`RecipeIngredient`.

### 10.1 Three conversion classes — only one is free

The critical distinction, and the thing to get wrong quietly:

| Class | Example | Needs per-ingredient data? |
|---|---|---|
| **Mass → mass** | `kg`, `lb`, `oz` → `g` | **No.** Exact universal constants (1 lb = 453.592 g). |
| **Volume → volume** | `l`, `fl oz`, `cup`, `tbsp`, `tsp` → `ml` | **No.** Exact (1 tbsp = 15 ml, 1 cup = 240 ml — see 10.2). |
| **Volume → mass** | `cup`, `tbsp`, `tsp`, `ml` → `g` | **Yes — density.** |
| **Count → mass** | `piece` → `g` | **Yes — per-item weight.** |

A cup of flour is ~130 g; a cup of honey is ~340 g; a cup of water is 237 g. **A
default density of 1.0 would overstate flour by ~80%.** So:

> **Never silently guess a density or an item weight.** If the constant is missing,
> the editor must either not offer that unit for that ingredient, or ask for the
> weight inline — never convert on an assumption. A wrong conversion here corrupts
> the pantry ledger and the shopping list at once, and does so invisibly.

### 10.2 Which cup?

A US legal cup is 240 ml, a US customary cup 236.6 ml, a metric cup 250 ml,
an Imperial cup 284 ml. Pick **one** and state it in the UI, rather than letting
the household guess which one the app means. Recommend **240 ml**, `tbsp` = 15 ml,
`tsp` = 5 ml — the US legal set, internally consistent (1 cup = 16 tbsp = 48 tsp).
This wants an explicit owner nod (§11.1) because it is a silent-1%-error class of
decision that is painful to change later.

### 10.3 Contract additions (still additive-only)

- `EntryUnit` gains `"cup" | "tbsp" | "tsp"`. Additive to a union; existing values
  untouched.
- `Ingredient` gains `gramsPerMl?: number` (density — enables volume → mass) and
  `gramsPerPiece?: number` (typical item weight — enables "2 onions" → 300 g).
- `RecipeIngredient` gains `displayQuantity?: number` and `displayUnit?: EntryUnit`,
  exactly mirroring `Product`'s settled pattern: `quantity` stays canonical and is
  the **only** field arithmetic touches; the display pair is provenance, never read
  by any engine or fold.
- Sheets: two optional columns on `Ingredients`, two on `RecipeIngredients`.
  No new sheet.

### 10.4 Seed catalogue work

Two data passes, no logic:

1. **Re-unit weighable produce** `piece` → `g` per §9.1. Moves: tomato, potato-like
   produce, and similar. **Stays `piece`:** egg, lemon, lettuce, banana, apple —
   things a person genuinely counts and a shop genuinely sells as items. This list
   is a judgement call per item and should be reviewed, not bulk-applied.
2. **Populate conversion constants** for the common cases — `gramsPerMl` for flour,
   sugar, oil, honey, milk, water-like liquids; `gramsPerPiece` for anything
   re-united in pass 1, plus countables a recipe might weigh. Missing constants are
   fine and safe — they simply mean that ingredient does not offer volume or count
   entry (§10.1), so this can land incrementally.

### 10.5 Display

Recipes show what was typed, with the canonical value alongside — *"1 cup flour
(130 g)"* — so the household sees both the instruction they wrote and the number
the app is actually reasoning about. The owner asked for the gram value to be
visible; showing it next to the typed value, rather than replacing it, keeps the
recipe readable while making the arithmetic auditable.

Pantry check-off and consumption already run on canonical grams, so no change is
needed there — the fix is upstream: a recipe entered in cups now *stores* grams,
so depletion stops being wrong in the first place.

---

## 11. Decisions — round two (all resolved)

**11.1 — Which cup? — ✅ DECIDED by the owner 2026-08-21: the US set.**
`cup` = 240 ml, `tbsp` = 15 ml, `tsp` = 5 ml. Internally consistent
(1 cup = 16 tbsp = 48 tsp). The UI must **state which cup it means** rather
than leave the household guessing between US legal (240), US customary
(236.6), metric (250) and Imperial (284).

**11.2 — Which seeds move to grams — coordinator's call, taken 2026-08-21**
(owner asked for sane defaults rather than a per-item interview).

Of the 26 `piece` seeds, the interesting group turned out **not** to be the
produce — it is the jars and tins. A recipe says "1 tbsp honey" or "400 g
chopped tomatoes", never "0.05 jars", so these are exactly the §3 whole-pack
case, and re-uniting them is what makes the mayonnaise scenario (§5 rows 5–8)
work at all:

- **→ `g`/`ml`, with a `packSize`** (packaged, but measured by weight in
  recipes): Tinned tomatoes, Tinned chickpeas, Tinned black beans, Tinned
  tuna, Tinned corn, Tomato passata, Pasta sauce, Peanut butter, Jam, Honey,
  Olives, Pickles.
- **→ `g`, `loose`** (produce genuinely bought and cooked by weight):
  **Tomato only.** This is the owner's original example ("200 gr of Tomatoes")
  and the one case where recipes really do say "400 g".
- **Stay `piece`** (genuinely counted, and sold as items): **Onion**,
  **Bell pepper**, Eggs, Bread, Lettuce, Cucumber, Lemon, Avocado, Banana,
  Apple, Garlic, Frozen pizza, Tea bags. Garlic especially — recipes say
  "2 cloves", and grams there would be worse, not better.

> **Corrected 2026-08-21, after the design agent caught the contradiction
> while mocking it.** An earlier version of this list moved Onion and Bell
> pepper to grams too, which directly contradicted §5's own scenarios — rows 3
> and 4 use "½ onion → buy 1 Onion" as *the* worked example of whole-unit
> rounding, and that example evaporates if an onion is 75 g of a loose weight.
> The test is not "does a shop ever weigh this" but **"does a recipe author
> write it as a count"**, and for onions and peppers they plainly do. Only
> tomato passes that test. Worth recording because the mistake was mine and
> the general rule is easy to over-apply: re-uniting a countable item silently
> turns off its whole-unit rounding, which is the entire feature.

Re-uniting a genuinely countable item silently turns off its whole-unit
rounding, which is why the third list is deliberately the longest. Revisable
per item until recipes exist.

**11.3 — Round-one items — taken as recommended** (owner declined to
re-litigate): §9.2 ingredient-level pack sizes now, with `Product` overriding
later; §9.3 leftover forecast shown in the plan but created at mark-cooked;
§9.4 `roundTo` deferred.

**Nothing in this document is now blocked on the owner.** It is ready to
implement once the mock is approved.
