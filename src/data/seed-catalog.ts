/**
 * Seed ingredient catalog — WP-16.
 *
 * ~100 common household ingredients with a canonical unit, default storage
 * location, and shelf-life defaults (DESIGN.md §2 "Ingredients"). Loaded into
 * the `Ingredients` sheet at bootstrap (WP-11) so day one isn't data entry.
 *
 * Pure data + pure validation only — no I/O, no React, no `Date.now()`/
 * `Math.random()`, no imports outside `src/domain` (see the module-boundary
 * rule in this WP's brief and `src/domain/README.md`'s dependency-direction
 * rule).
 *
 * --- Id strategy (read this before touching bootstrap, WP-11) ---
 *
 * Every id below is a hand-written, human-readable slug (`tomato`,
 * `olive-oil`), never a randomly generated one. Two things depend on that:
 *
 * 1. Invariant 6 (HANDOVER §4): the workbook stays human-readable. A random
 *    id in the `Ingredients` sheet — the sheet a household member is most
 *    likely to open and read directly — would defeat that on sight.
 * 2. Idempotent re-seeding. `WorkbookStore.ingredients.upsert` (contracts.ts)
 *    is documented as "insert-or-replace by id". As long as WP-11's bootstrap
 *    calls `upsert` once per entry in `seedCatalog` using the entry's `id`
 *    as-is (never re-minting one), re-running bootstrap on a workbook that
 *    already has the catalog replaces each row in place instead of
 *    duplicating it — no separate "already seeded" check needed. Bootstrap
 *    must NOT use `WorkbookStore`'s lower-level append path for this sheet,
 *    and must not generate a fresh id per run.
 *
 * --- Units (invariant 3) ---
 *
 * Exactly one canonical unit per ingredient, drawn from `Unit` (`g` | `ml` |
 * `piece` | `portion`; deliberately no `kg`/`l` — see types.ts). Tinned/jarred
 * goods are modelled as `piece` (a tin, a jar) rather than the weight printed
 * on the label: that is how a household actually buys and uses them ("a tin
 * of chickpeas"), and the catalog has no typical-package-size field (that's
 * an explicit v1.1 candidate in DESIGN.md) to convert from grams anyway.
 *
 * --- Shelf life ---
 *
 * `openedShelfLifeDays` is strictly shorter than `shelfLifeDays` wherever
 * opening/cutting a lot genuinely accelerates spoilage (milk, cut onion,
 * a jar of pickles once breached, wine once uncorked). It is equal wherever
 * that isn't true — a bag of rice or a bag of sugar does not spoil faster
 * once opened, matching this WP's brief verbatim.
 */
import {
  makeIngredientId,
  makeQuantity,
  type Ingredient,
  type IngredientCategory,
  type StorageLocation,
  type Unit,
} from "../domain/index.ts";

// ---------------------------------------------------------------------------
// Leftover pseudo-ingredient defaults (DESIGN.md §2 "Servings, scaling &
// leftovers" / glossary "Leftover lot").
//
// Cooking surplus creates a lot named `Leftover: <recipe>` (the name is
// minted per-recipe at cook time by WP-12's leftover-lot helper — it is not
// a static catalog row, so it cannot live in `seedCatalog` below). What IS
// static, and what WP-12 needs from this package, are the defaults that
// apply to every leftover lot regardless of which recipe produced it: named
// constants here so they are defined in exactly one place, not scattered as
// magic numbers across the inventory engine and the mark-cooked UI.
// ---------------------------------------------------------------------------

/** Every leftover lot uses this unit (DESIGN.md: "unit = portion"). */
export const LEFTOVER_UNIT: Unit = "portion";

/** Leftovers default to the fridge; freezing is a manual `move` after creation. */
export const LEFTOVER_DEFAULT_LOCATION: StorageLocation = "fridge";

/** Short fridge shelf life for a freshly cooked leftover lot. */
export const LEFTOVER_FRIDGE_SHELF_LIFE_DAYS = 4;

/** Shelf life to apply if a leftover lot is frozen instead (DESIGN.md: "or frozen"). */
export const LEFTOVER_FREEZER_SHELF_LIFE_DAYS = 90;

// ---------------------------------------------------------------------------
// Catalog data
// ---------------------------------------------------------------------------

interface SeedIngredient {
  readonly id: string;
  readonly name: string;
  readonly unit: Unit;
  readonly shelfLifeDays: number;
  readonly openedShelfLifeDays: number;
  readonly defaultLocation: StorageLocation;
  /**
   * WP-PURCHASING (DESIGN_PURCHASING.md §10.4 pass 2 / §11.2) — optional
   * purchasability data, populated incrementally per the design's own
   * "missing constants are fine and safe" rule. `purchaseMode`/`packSize`
   * are needed for the twelve re-united jar/tin items (§11.2); `gramsPerMl`/
   * `gramsPerPiece` are seeded for the common baking staples and countables
   * a recipe might weigh named explicitly in §10.4, not the whole catalog.
   */
  readonly purchaseMode?: "whole" | "loose";
  /** Typical pack size, in `unit` — turned into a `Quantity` below. */
  readonly packSizeAmount?: number;
  readonly gramsPerMl?: number;
  readonly gramsPerPiece?: number;
}

interface SeedCategorySection {
  readonly category: IngredientCategory;
  readonly entries: readonly SeedIngredient[];
}

/**
 * Grouped by category (WP-VC3 — this grouping used to be comment-only; the
 * data was already correct, it just wasn't machine-readable). Each section's
 * `category` is stamped onto every entry it contains by `RAW_CATALOG` below,
 * which is what `seedCatalog`'s `Ingredient.category` field — and in turn
 * the Shopping route's "Produce"/"Dry goods"/etc. subheadings
 * (`src/routes/Shopping.tsx`) — are built from.
 */
const CATALOG_SECTIONS: readonly SeedCategorySection[] = [
  {
    category: "produce",
    entries: [
  // WP-PURCHASING §9.1/§11.2 (owner-decided 2026-08-21, corrected 2026-08-21):
  // Tomato is the ONE produce item that re-units to grams — recipes really
  // do write "400 g tomatoes" and a shop really does sell it loose by
  // weight. `gramsPerPiece` lets a recipe still say "2 tomatoes" and convert
  // to grams at entry time (src/domain/units.ts). Onion and Bell pepper
  // deliberately STAY `piece` — a recipe author writes "2 onions", not
  // "300 g onion", and §5's own worked example depends on Onion rounding to
  // a whole unit; `gramsPerPiece` is still populated for both so a recipe
  // that DOES want to weigh one can.
  { id: "tomato", name: "Tomato", unit: "g", shelfLifeDays: 7, openedShelfLifeDays: 2, defaultLocation: "pantry", purchaseMode: "loose", gramsPerPiece: 120 },
  { id: "onion", name: "Onion", unit: "piece", shelfLifeDays: 30, openedShelfLifeDays: 5, defaultLocation: "pantry", gramsPerPiece: 150 },
  { id: "garlic", name: "Garlic", unit: "piece", shelfLifeDays: 90, openedShelfLifeDays: 90, defaultLocation: "pantry", gramsPerPiece: 5 },
  { id: "potato", name: "Potato", unit: "g", shelfLifeDays: 60, openedShelfLifeDays: 60, defaultLocation: "pantry" },
  { id: "carrot", name: "Carrot", unit: "g", shelfLifeDays: 21, openedShelfLifeDays: 10, defaultLocation: "fridge" },
  { id: "lettuce", name: "Lettuce", unit: "piece", shelfLifeDays: 10, openedShelfLifeDays: 4, defaultLocation: "fridge", gramsPerPiece: 500 },
  { id: "spinach", name: "Spinach", unit: "g", shelfLifeDays: 5, openedShelfLifeDays: 3, defaultLocation: "fridge" },
  { id: "cucumber", name: "Cucumber", unit: "piece", shelfLifeDays: 7, openedShelfLifeDays: 3, defaultLocation: "fridge", gramsPerPiece: 300 },
  { id: "bell-pepper", name: "Bell pepper", unit: "piece", shelfLifeDays: 10, openedShelfLifeDays: 4, defaultLocation: "fridge", gramsPerPiece: 120 },
  { id: "mushroom", name: "Mushroom", unit: "g", shelfLifeDays: 7, openedShelfLifeDays: 3, defaultLocation: "fridge" },
  { id: "banana", name: "Banana", unit: "piece", shelfLifeDays: 5, openedShelfLifeDays: 5, defaultLocation: "pantry", gramsPerPiece: 120 },
  { id: "apple", name: "Apple", unit: "piece", shelfLifeDays: 21, openedShelfLifeDays: 3, defaultLocation: "fridge", gramsPerPiece: 180 },
  { id: "lemon", name: "Lemon", unit: "piece", shelfLifeDays: 21, openedShelfLifeDays: 21, defaultLocation: "pantry", gramsPerPiece: 100 },
  { id: "avocado", name: "Avocado", unit: "piece", shelfLifeDays: 5, openedShelfLifeDays: 1, defaultLocation: "pantry", gramsPerPiece: 200 },

    ],
  },
  {
    category: "dairy-eggs",
    entries: [
  { id: "milk", name: "Milk", unit: "ml", shelfLifeDays: 10, openedShelfLifeDays: 7, defaultLocation: "fridge" },
  // WP-PURCHASING §10.1a/§10.4: density (grams per ml) for the common
  // "1 cup X" baking staples the design names by example, so cup/tbsp/tsp
  // entry (src/domain/units.ts) is offered for these without guessing.
  { id: "butter", name: "Butter", unit: "g", shelfLifeDays: 60, openedShelfLifeDays: 21, defaultLocation: "fridge", gramsPerMl: 0.9458 },
  { id: "cheddar-cheese", name: "Cheddar cheese", unit: "g", shelfLifeDays: 30, openedShelfLifeDays: 10, defaultLocation: "fridge" },
  { id: "parmesan-cheese", name: "Parmesan cheese", unit: "g", shelfLifeDays: 90, openedShelfLifeDays: 30, defaultLocation: "fridge" },
  { id: "plain-yogurt", name: "Plain yogurt", unit: "g", shelfLifeDays: 14, openedShelfLifeDays: 7, defaultLocation: "fridge" },
  { id: "eggs", name: "Eggs", unit: "piece", shelfLifeDays: 28, openedShelfLifeDays: 28, defaultLocation: "fridge", gramsPerPiece: 50 },
  { id: "cream", name: "Cream", unit: "ml", shelfLifeDays: 10, openedShelfLifeDays: 4, defaultLocation: "fridge" },
  { id: "sour-cream", name: "Sour cream", unit: "g", shelfLifeDays: 21, openedShelfLifeDays: 7, defaultLocation: "fridge" },
  { id: "mozzarella", name: "Mozzarella", unit: "g", shelfLifeDays: 14, openedShelfLifeDays: 4, defaultLocation: "fridge" },
  { id: "cream-cheese", name: "Cream cheese", unit: "g", shelfLifeDays: 30, openedShelfLifeDays: 10, defaultLocation: "fridge" },

    ],
  },
  {
    category: "meat-fish",
    entries: [
  { id: "chicken-breast", name: "Chicken breast", unit: "g", shelfLifeDays: 4, openedShelfLifeDays: 2, defaultLocation: "fridge" },
  { id: "ground-beef", name: "Ground beef", unit: "g", shelfLifeDays: 3, openedShelfLifeDays: 2, defaultLocation: "fridge" },
  { id: "beef-steak", name: "Beef steak", unit: "g", shelfLifeDays: 4, openedShelfLifeDays: 3, defaultLocation: "fridge" },
  { id: "pork-chops", name: "Pork chops", unit: "g", shelfLifeDays: 4, openedShelfLifeDays: 3, defaultLocation: "fridge" },
  { id: "bacon", name: "Bacon", unit: "g", shelfLifeDays: 14, openedShelfLifeDays: 7, defaultLocation: "fridge" },
  { id: "salmon-fillet", name: "Salmon fillet", unit: "g", shelfLifeDays: 2, openedShelfLifeDays: 2, defaultLocation: "fridge" },
  { id: "white-fish-fillet", name: "White fish fillet", unit: "g", shelfLifeDays: 2, openedShelfLifeDays: 2, defaultLocation: "fridge" },
  { id: "shrimp", name: "Shrimp", unit: "g", shelfLifeDays: 2, openedShelfLifeDays: 2, defaultLocation: "fridge" },
  { id: "sausages", name: "Sausages", unit: "g", shelfLifeDays: 7, openedShelfLifeDays: 3, defaultLocation: "fridge" },
  { id: "deli-ham", name: "Deli ham", unit: "g", shelfLifeDays: 14, openedShelfLifeDays: 5, defaultLocation: "fridge" },
  { id: "smoked-salmon", name: "Smoked salmon", unit: "g", shelfLifeDays: 14, openedShelfLifeDays: 3, defaultLocation: "fridge" },

    ],
  },
  {
    category: "dry-goods",
    entries: [
  { id: "rice", name: "Rice", unit: "g", shelfLifeDays: 730, openedShelfLifeDays: 730, defaultLocation: "pantry" },
  { id: "pasta", name: "Pasta", unit: "g", shelfLifeDays: 730, openedShelfLifeDays: 730, defaultLocation: "pantry" },
  { id: "couscous", name: "Couscous", unit: "g", shelfLifeDays: 365, openedShelfLifeDays: 365, defaultLocation: "pantry" },
  { id: "quinoa", name: "Quinoa", unit: "g", shelfLifeDays: 365, openedShelfLifeDays: 365, defaultLocation: "pantry" },
  { id: "lentils", name: "Lentils", unit: "g", shelfLifeDays: 365, openedShelfLifeDays: 365, defaultLocation: "pantry" },
  { id: "dried-chickpeas", name: "Dried chickpeas", unit: "g", shelfLifeDays: 365, openedShelfLifeDays: 365, defaultLocation: "pantry" },
  { id: "dried-black-beans", name: "Dried black beans", unit: "g", shelfLifeDays: 365, openedShelfLifeDays: 365, defaultLocation: "pantry" },
  { id: "oats", name: "Oats", unit: "g", shelfLifeDays: 365, openedShelfLifeDays: 365, defaultLocation: "pantry" },
  { id: "breadcrumbs", name: "Breadcrumbs", unit: "g", shelfLifeDays: 180, openedShelfLifeDays: 90, defaultLocation: "pantry" },
  { id: "bread", name: "Bread", unit: "piece", shelfLifeDays: 5, openedShelfLifeDays: 5, defaultLocation: "pantry" },

    ],
  },
  {
    // WP-PURCHASING §3/§5/§11.2: these twelve are exactly the "sold as a
    // whole pack, but a recipe measures them by weight" case §3 exists for
    // — "1 tbsp honey" or "400 g chopped tomatoes", never "0.05 jars". Every
    // entry gets `purchaseMode: "whole"` and a typical `packSizeAmount` in
    // its own (now g/ml) `unit`, so `suggestPurchase` rounds the aggregated
    // shortfall up to whole tins/jars (§5 scenarios 5-8) instead of the
    // pre-WP-PURCHASING `unit: "piece"` modelling ("a tin of chickpeas")
    // that made every recipe quantity here impossible to express in grams.
    category: "tinned-jarred",
    entries: [
  { id: "tinned-tomatoes", name: "Tinned tomatoes", unit: "g", shelfLifeDays: 730, openedShelfLifeDays: 5, defaultLocation: "pantry", purchaseMode: "whole", packSizeAmount: 400 },
  { id: "tinned-chickpeas", name: "Tinned chickpeas", unit: "g", shelfLifeDays: 730, openedShelfLifeDays: 4, defaultLocation: "pantry", purchaseMode: "whole", packSizeAmount: 400 },
  { id: "tinned-black-beans", name: "Tinned black beans", unit: "g", shelfLifeDays: 730, openedShelfLifeDays: 4, defaultLocation: "pantry", purchaseMode: "whole", packSizeAmount: 400 },
  { id: "tinned-tuna", name: "Tinned tuna", unit: "g", shelfLifeDays: 1095, openedShelfLifeDays: 3, defaultLocation: "pantry", purchaseMode: "whole", packSizeAmount: 150 },
  { id: "tinned-corn", name: "Tinned corn", unit: "g", shelfLifeDays: 730, openedShelfLifeDays: 5, defaultLocation: "pantry", purchaseMode: "whole", packSizeAmount: 340 },
  { id: "tomato-passata", name: "Tomato passata", unit: "g", shelfLifeDays: 365, openedShelfLifeDays: 5, defaultLocation: "pantry", purchaseMode: "whole", packSizeAmount: 700 },
  { id: "pasta-sauce", name: "Pasta sauce", unit: "g", shelfLifeDays: 540, openedShelfLifeDays: 7, defaultLocation: "pantry", purchaseMode: "whole", packSizeAmount: 400 },
  { id: "pickles", name: "Pickles", unit: "g", shelfLifeDays: 365, openedShelfLifeDays: 30, defaultLocation: "pantry", purchaseMode: "whole", packSizeAmount: 350 },
  { id: "olives", name: "Olives", unit: "g", shelfLifeDays: 365, openedShelfLifeDays: 14, defaultLocation: "pantry", purchaseMode: "whole", packSizeAmount: 200 },
  { id: "peanut-butter", name: "Peanut butter", unit: "g", shelfLifeDays: 365, openedShelfLifeDays: 60, defaultLocation: "pantry", purchaseMode: "whole", packSizeAmount: 350 },
  { id: "jam", name: "Jam", unit: "g", shelfLifeDays: 365, openedShelfLifeDays: 30, defaultLocation: "pantry", purchaseMode: "whole", packSizeAmount: 340 },
  { id: "honey", name: "Honey", unit: "g", shelfLifeDays: 730, openedShelfLifeDays: 730, defaultLocation: "pantry", purchaseMode: "whole", packSizeAmount: 340, gramsPerMl: 1.4167 },

    ],
  },
  {
    category: "frozen",
    entries: [
  { id: "frozen-peas", name: "Frozen peas", unit: "g", shelfLifeDays: 270, openedShelfLifeDays: 120, defaultLocation: "freezer" },
  { id: "frozen-corn", name: "Frozen corn", unit: "g", shelfLifeDays: 270, openedShelfLifeDays: 120, defaultLocation: "freezer" },
  { id: "frozen-mixed-vegetables", name: "Frozen mixed vegetables", unit: "g", shelfLifeDays: 270, openedShelfLifeDays: 120, defaultLocation: "freezer" },
  { id: "frozen-spinach", name: "Frozen spinach", unit: "g", shelfLifeDays: 270, openedShelfLifeDays: 120, defaultLocation: "freezer" },
  { id: "frozen-berries", name: "Frozen berries", unit: "g", shelfLifeDays: 270, openedShelfLifeDays: 120, defaultLocation: "freezer" },
  { id: "frozen-pizza", name: "Frozen pizza", unit: "piece", shelfLifeDays: 180, openedShelfLifeDays: 180, defaultLocation: "freezer" },
  { id: "frozen-chicken-breast", name: "Frozen chicken breast", unit: "g", shelfLifeDays: 270, openedShelfLifeDays: 90, defaultLocation: "freezer" },
  { id: "frozen-fish-fillets", name: "Frozen fish fillets", unit: "g", shelfLifeDays: 180, openedShelfLifeDays: 60, defaultLocation: "freezer" },
  { id: "ice-cream", name: "Ice cream", unit: "g", shelfLifeDays: 180, openedShelfLifeDays: 30, defaultLocation: "freezer" },

    ],
  },
  {
    category: "condiments",
    entries: [
  { id: "ketchup", name: "Ketchup", unit: "ml", shelfLifeDays: 365, openedShelfLifeDays: 30, defaultLocation: "pantry" },
  { id: "mustard", name: "Mustard", unit: "ml", shelfLifeDays: 365, openedShelfLifeDays: 60, defaultLocation: "pantry" },
  // WP-PURCHASING §5/§6's own worked example ("needs 130 ml; sold in 250 ml jars").
  { id: "mayonnaise", name: "Mayonnaise", unit: "ml", shelfLifeDays: 90, openedShelfLifeDays: 30, defaultLocation: "fridge", purchaseMode: "whole", packSizeAmount: 250 },
  { id: "soy-sauce", name: "Soy sauce", unit: "ml", shelfLifeDays: 730, openedShelfLifeDays: 180, defaultLocation: "pantry" },
  { id: "hot-sauce", name: "Hot sauce", unit: "ml", shelfLifeDays: 730, openedShelfLifeDays: 180, defaultLocation: "pantry" },
  { id: "vinegar", name: "Vinegar", unit: "ml", shelfLifeDays: 1095, openedShelfLifeDays: 365, defaultLocation: "pantry" },
  { id: "olive-oil", name: "Olive oil", unit: "ml", shelfLifeDays: 540, openedShelfLifeDays: 180, defaultLocation: "pantry" },
  { id: "vegetable-oil", name: "Vegetable oil", unit: "ml", shelfLifeDays: 365, openedShelfLifeDays: 180, defaultLocation: "pantry" },
  { id: "bbq-sauce", name: "BBQ sauce", unit: "ml", shelfLifeDays: 365, openedShelfLifeDays: 60, defaultLocation: "pantry" },
  { id: "salad-dressing", name: "Salad dressing", unit: "ml", shelfLifeDays: 180, openedShelfLifeDays: 30, defaultLocation: "fridge" },
  { id: "tahini", name: "Tahini", unit: "ml", shelfLifeDays: 365, openedShelfLifeDays: 90, defaultLocation: "pantry" },
  { id: "worcestershire-sauce", name: "Worcestershire sauce", unit: "ml", shelfLifeDays: 1095, openedShelfLifeDays: 365, defaultLocation: "pantry" },

    ],
  },
  {
    category: "baking",
    entries: [
  // Flour is DESIGN_PURCHASING.md §10/§10.1a's own worked example: "1 cup
  // flour" -> 130 g, i.e. gramsPerMl = 130/240.
  { id: "flour", name: "Flour", unit: "g", shelfLifeDays: 365, openedShelfLifeDays: 365, defaultLocation: "pantry", gramsPerMl: 0.5417 },
  { id: "sugar", name: "Sugar", unit: "g", shelfLifeDays: 730, openedShelfLifeDays: 730, defaultLocation: "pantry", gramsPerMl: 0.8333 },
  { id: "brown-sugar", name: "Brown sugar", unit: "g", shelfLifeDays: 730, openedShelfLifeDays: 730, defaultLocation: "pantry", gramsPerMl: 0.9167 },
  { id: "baking-powder", name: "Baking powder", unit: "g", shelfLifeDays: 540, openedShelfLifeDays: 365, defaultLocation: "pantry" },
  { id: "baking-soda", name: "Baking soda", unit: "g", shelfLifeDays: 730, openedShelfLifeDays: 365, defaultLocation: "pantry" },
  { id: "yeast", name: "Yeast", unit: "g", shelfLifeDays: 730, openedShelfLifeDays: 90, defaultLocation: "pantry" },
  { id: "cocoa-powder", name: "Cocoa powder", unit: "g", shelfLifeDays: 730, openedShelfLifeDays: 365, defaultLocation: "pantry", gramsPerMl: 0.5 },
  { id: "chocolate-chips", name: "Chocolate chips", unit: "g", shelfLifeDays: 365, openedShelfLifeDays: 180, defaultLocation: "pantry" },
  { id: "vanilla-extract", name: "Vanilla extract", unit: "ml", shelfLifeDays: 1095, openedShelfLifeDays: 1095, defaultLocation: "pantry" },

    ],
  },
  {
    category: "herbs-spices",
    entries: [
  { id: "black-pepper", name: "Black pepper", unit: "g", shelfLifeDays: 1095, openedShelfLifeDays: 730, defaultLocation: "pantry" },
  { id: "salt", name: "Salt", unit: "g", shelfLifeDays: 3650, openedShelfLifeDays: 3650, defaultLocation: "pantry" },
  { id: "cumin", name: "Cumin", unit: "g", shelfLifeDays: 1095, openedShelfLifeDays: 365, defaultLocation: "pantry" },
  { id: "paprika", name: "Paprika", unit: "g", shelfLifeDays: 1095, openedShelfLifeDays: 365, defaultLocation: "pantry" },
  { id: "dried-oregano", name: "Dried oregano", unit: "g", shelfLifeDays: 1095, openedShelfLifeDays: 365, defaultLocation: "pantry" },
  { id: "cinnamon", name: "Cinnamon", unit: "g", shelfLifeDays: 1095, openedShelfLifeDays: 365, defaultLocation: "pantry" },
  { id: "chili-flakes", name: "Chili flakes", unit: "g", shelfLifeDays: 1095, openedShelfLifeDays: 365, defaultLocation: "pantry" },
  { id: "fresh-basil", name: "Fresh basil", unit: "g", shelfLifeDays: 7, openedShelfLifeDays: 3, defaultLocation: "fridge" },
  { id: "fresh-parsley", name: "Fresh parsley", unit: "g", shelfLifeDays: 10, openedShelfLifeDays: 5, defaultLocation: "fridge" },
  { id: "fresh-cilantro", name: "Fresh cilantro", unit: "g", shelfLifeDays: 7, openedShelfLifeDays: 3, defaultLocation: "fridge" },
  { id: "fresh-ginger", name: "Fresh ginger", unit: "g", shelfLifeDays: 21, openedShelfLifeDays: 10, defaultLocation: "fridge" },

    ],
  },
  {
    category: "drinks",
    entries: [
  { id: "orange-juice", name: "Orange juice", unit: "ml", shelfLifeDays: 14, openedShelfLifeDays: 7, defaultLocation: "fridge" },
  { id: "coffee", name: "Coffee (ground)", unit: "g", shelfLifeDays: 270, openedShelfLifeDays: 60, defaultLocation: "pantry" },
  { id: "tea-bags", name: "Tea bags", unit: "piece", shelfLifeDays: 730, openedShelfLifeDays: 730, defaultLocation: "pantry" },
  { id: "sparkling-water", name: "Sparkling water", unit: "ml", shelfLifeDays: 270, openedShelfLifeDays: 3, defaultLocation: "pantry" },
  { id: "beer", name: "Beer", unit: "ml", shelfLifeDays: 180, openedShelfLifeDays: 1, defaultLocation: "fridge" },
  { id: "wine", name: "Wine", unit: "ml", shelfLifeDays: 1095, openedShelfLifeDays: 5, defaultLocation: "pantry" },
    ],
  },
];

/** `CATALOG_SECTIONS`, flattened, with each entry stamped with its section's category. */
const RAW_CATALOG: readonly (SeedIngredient & { readonly category: IngredientCategory })[] =
  CATALOG_SECTIONS.flatMap((section) => section.entries.map((entry) => ({ ...entry, category: section.category })));

/**
 * The seeded catalog, as constructed `Ingredient`s (branded ids via
 * `makeIngredientId`, so a malformed slug throws at module load rather than
 * silently reaching the workbook). WP-11's bootstrap loads this array
 * directly; see the id-strategy note above for the idempotency contract.
 */
export const seedCatalog: readonly Ingredient[] = RAW_CATALOG.map((entry) => ({
  id: makeIngredientId(entry.id),
  name: entry.name,
  unit: entry.unit,
  shelfLifeDays: entry.shelfLifeDays,
  openedShelfLifeDays: entry.openedShelfLifeDays,
  defaultLocation: entry.defaultLocation,
  category: entry.category,
  ...(entry.purchaseMode !== undefined ? { purchaseMode: entry.purchaseMode } : {}),
  ...(entry.packSizeAmount !== undefined ? { packSize: makeQuantity(entry.packSizeAmount, entry.unit) } : {}),
  ...(entry.gramsPerMl !== undefined ? { gramsPerMl: entry.gramsPerMl } : {}),
  ...(entry.gramsPerPiece !== undefined ? { gramsPerPiece: entry.gramsPerPiece } : {}),
}));
