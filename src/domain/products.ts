/**
 * Product identity, barcode resolution, legacy migration, and duplicate
 * -merge detection — WP-PRODUCTS-MODEL (owner-approved re-key, exceeding the
 * usual additive-only exception; see src/domain/README.md and
 * DESIGN_PRODUCTS.md).
 *
 * Pure module: no I/O, no React, no Clock/Rng reached for directly (the two
 * functions that mint something take an injected `Rng`, per the domain
 * purity rule). Every function here is a plain fold over arrays already in
 * memory; callers (routes, a future contract-change task's UI, tests) do the
 * actual `WorkbookStore` reads/writes.
 */
import { makeBarcode, type Barcode, type IngredientId, type PriceObservation, type Product, type ProductBarcode, type ProductId } from "./types.ts";

// ---------------------------------------------------------------------------
// Barcode <-> product resolution
//
// `PriceObservation.barcode` is never rewritten (it genuinely happened at a
// specific barcode); resolving it to "which product does this belong to
// right now" is always a lookup over `ProductBarcodes`, done here.
// ---------------------------------------------------------------------------

/** Builds a `barcode -> productId` index from every `ProductBarcode` row. Last row wins on a duplicate barcode (shouldn't happen — a barcode belongs to exactly one product — but a fold must still be total). */
export function buildBarcodeIndex(barcodeRows: readonly ProductBarcode[]): ReadonlyMap<Barcode, ProductId> {
  const index = new Map<Barcode, ProductId>();
  for (const row of barcodeRows) {
    index.set(row.barcode, row.productId);
  }
  return index;
}

/** Which `ProductId` a barcode currently belongs to, or `undefined` if it names no known product. */
export function resolveProductId(barcode: Barcode, barcodeRows: readonly ProductBarcode[]): ProductId | undefined {
  return buildBarcodeIndex(barcodeRows).get(barcode);
}

/** Every barcode currently owned by one product, in the order they appear in `barcodeRows`. */
export function barcodesForProduct(productId: ProductId, barcodeRows: readonly ProductBarcode[]): readonly Barcode[] {
  return barcodeRows.filter((row) => row.productId === productId).map((row) => row.barcode);
}

/**
 * Every `PriceObservation` that rolls up to one product, whether it named
 * one of that product's barcodes directly or (rare, but the contract allows
 * it — `PriceObservation.barcode` is optional) carries no barcode at all and
 * must be matched by ingredient instead. Scoped to observations naming a
 * barcode this product owns — this is the "price history must survive a
 * merge" guarantee: reassign the barcode in `ProductBarcodes` (see
 * `planProductMerge` below) and every past observation against it rolls up
 * here with no rewrite of `PriceObservations` itself.
 */
export function observationsForProduct(
  observations: readonly PriceObservation[],
  productId: ProductId,
  barcodeRows: readonly ProductBarcode[],
): readonly PriceObservation[] {
  const owned = new Set(barcodesForProduct(productId, barcodeRows));
  return observations.filter((observation) => observation.barcode !== undefined && owned.has(observation.barcode));
}

// ---------------------------------------------------------------------------
// Legacy migration
//
// A pre-re-key `Products` row's first cell held a `Barcode` (its only
// identity at the time). `decodeProduct` already reads that same cell as a
// `ProductId` with zero row-shape change (see products.ts's codec header
// comment) — a legacy row decodes fine on its own. What is MISSING is the
// `ProductBarcode` row that makes that legacy identity resolvable as a
// barcode lookup too. This function computes exactly the rows needed to fix
// that, and nothing else.
// ---------------------------------------------------------------------------

export interface ProductBarcodeMigrationResult {
  /** New `ProductBarcode` rows to write (append or upsert — either is safe, since each is keyed by a barcode no existing row already claims). Empty when the workbook has already been migrated (idempotent) or has no legacy rows to fix. */
  readonly rowsToWrite: readonly ProductBarcode[];
  /**
   * Legacy products whose id does not parse as a `Barcode` (6-14 digits) —
   * so a barcode row cannot be inferred for them. This should not happen in
   * practice (every legacy `Products` row's identity WAS a validated
   * barcode), but the migration must never throw on the owner's real data;
   * it skips these and reports them instead of guessing.
   */
  readonly unresolvable: readonly ProductId[];
}

const LEGACY_BARCODE_RE = /^\d{6,14}$/;

/**
 * Computes the `ProductBarcode` rows a workbook needs so every existing
 * `Products` row is reachable by barcode lookup, without ever touching a
 * product or barcode row that already has one.
 *
 * **Idempotent and non-destructive by construction**: a product already
 * present in `existingBarcodeRows` (by its `productId`) is left alone —
 * running this twice against the same `existingBarcodeRows` ∪ its own
 * output produces an empty `rowsToWrite` the second time. Nothing is ever
 * deleted; a product this function cannot resolve is reported in
 * `unresolvable` rather than silently dropped.
 */
export function migrateLegacyProductBarcodes(
  products: readonly Product[],
  existingBarcodeRows: readonly ProductBarcode[],
): ProductBarcodeMigrationResult {
  const productIdsWithBarcodes = new Set(existingBarcodeRows.map((row) => row.productId));
  const rowsToWrite: ProductBarcode[] = [];
  const unresolvable: ProductId[] = [];

  for (const product of products) {
    if (productIdsWithBarcodes.has(product.id)) continue;
    if (!LEGACY_BARCODE_RE.test(product.id)) {
      unresolvable.push(product.id);
      continue;
    }
    rowsToWrite.push({ productId: product.id, barcode: makeBarcode(product.id) });
  }

  return { rowsToWrite, unresolvable };
}

// ---------------------------------------------------------------------------
// Duplicate-merge detection
//
// Pure functions producing SUGGESTIONS ONLY — never applying them (the task
// brief: "getting it wrong in the confident direction is much worse than
// missing a pair, because the owner sees a prompt about their real data").
// ---------------------------------------------------------------------------

export type ProductMergeConfidence = "high" | "medium";

export interface ProductMergeSuggestion {
  readonly a: Product;
  readonly b: Product;
  readonly confidence: ProductMergeConfidence;
  /** Human-readable, plain-language reasons a UI can show so the owner understands WHY these two were suggested (not just "76% match"). */
  readonly reasons: readonly string[];
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function nameTokens(name: string): ReadonlySet<string> {
  const normalized = normalizeName(name);
  return new Set(normalized.length === 0 ? [] : normalized.split(" "));
}

/** Jaccard similarity of two token sets, in [0, 1]. Two empty sets are defined as dissimilar (0), not a divide-by-zero 1 — an unnamed product should never look confidently identical to another. */
function jaccardSimilarity(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Relative difference between two package-size amounts, tolerant of small float/rounding noise (e.g. a unit conversion landing at 453.59 vs 454 g for "1 lb"). */
function relativeDifference(a: number, b: number): number {
  const denom = Math.max(Math.abs(a), Math.abs(b));
  return denom === 0 ? 0 : Math.abs(a - b) / denom;
}

/** Same canonical package size — same unit, and amounts within 2% of each other (covers unit-conversion rounding, not genuinely different pack sizes). */
function samePackageSize(x: Product, y: Product): boolean {
  return x.canonicalQuantity.unit === y.canonicalQuantity.unit && relativeDifference(x.canonicalQuantity.amount, y.canonicalQuantity.amount) <= 0.02;
}

const NAME_SIMILARITY_THRESHOLD = 0.5;
const NAME_SIMILARITY_HIGH_CONFIDENCE = 0.85;

/**
 * Suggests pairs of products likely to be the same physical item sold under
 * different barcodes — the owner's own example: tomatoes carrying a
 * different barcode in each shop.
 *
 * **The rule, and why it's trusted:** a pair is suggested only when it
 * shares BOTH of the two facts that are true regardless of which shop's
 * barcode was scanned — the same `ingredientId` (an exact match, not a
 * guess: two different ingredients are never the same product) and the same
 * canonical package size (same unit, amount within 2%, tolerating
 * unit-conversion rounding) — AND the names overlap enough
 * (token-Jaccard ≥ 0.5) to plausibly be the same product line rather than
 * two different products of the same ingredient and size (e.g. "Riso Gallo
 * Arborio 1kg" vs. "Store Brand Arborio 1kg" are the same ingredient and
 * size but clearly different products, and share zero name tokens once
 * "arborio"/"1kg" wording differs — this rule would correctly NOT suggest
 * them unless their names actually overlap).
 *
 * Requiring all three signals — never just name similarity alone — is the
 * deliberate bias toward under-suggesting: a name-only match ("Tomatoes"
 * ~ "Cherry Tomatoes") without a matching ingredient+size is exactly the
 * false-positive this function refuses to produce, because the brief
 * treats a wrong confident merge prompt as strictly worse than a missed
 * one.
 *
 * `confidence: "high"` when the names are near-identical (≥ 0.85) or the
 * brand also matches; `"medium"` otherwise — a UI can use this to sort or
 * word the confirmation prompt, never to skip confirmation altogether
 * (owner's decision 2: merges are never applied without confirmation).
 */
export function suggestProductMerges(products: readonly Product[]): readonly ProductMergeSuggestion[] {
  const suggestions: ProductMergeSuggestion[] = [];
  const byIngredient = new Map<IngredientId, Product[]>();
  for (const product of products) {
    const bucket = byIngredient.get(product.ingredientId);
    if (bucket) bucket.push(product);
    else byIngredient.set(product.ingredientId, [product]);
  }

  for (const bucket of byIngredient.values()) {
    for (let i = 0; i < bucket.length; i += 1) {
      for (let j = i + 1; j < bucket.length; j += 1) {
        const a = bucket[i]!;
        const b = bucket[j]!;
        if (!samePackageSize(a, b)) continue;

        const similarity = jaccardSimilarity(nameTokens(a.name), nameTokens(b.name));
        if (similarity < NAME_SIMILARITY_THRESHOLD) continue;

        const sameBrand = a.brand !== undefined && b.brand !== undefined && normalizeName(a.brand) === normalizeName(b.brand);
        const confidence: ProductMergeConfidence = similarity >= NAME_SIMILARITY_HIGH_CONFIDENCE || sameBrand ? "high" : "medium";

        const reasons: string[] = ["same ingredient", `same package size (${a.canonicalQuantity.amount} ${a.canonicalQuantity.unit})`];
        reasons.push(similarity >= NAME_SIMILARITY_HIGH_CONFIDENCE ? "names are nearly identical" : "names overlap");
        if (sameBrand) reasons.push("same brand");

        suggestions.push({ a, b, confidence, reasons });
      }
    }
  }

  return suggestions;
}

// ---------------------------------------------------------------------------
// Applying a confirmed merge
//
// Still pure — computes what to write, never writes it. A caller (a future
// contract-change task's "combine two products" screen) applies the result
// via `WorkbookStore.productBarcodes.upsert` for each row here, then may
// choose to stop writing to `keep`'s superseded sibling (the domain does not
// delete rows — SheetsTransport has no delete; see workbook-store.ts's own
// header comment on why photos are blanked, not removed).
// ---------------------------------------------------------------------------

export interface ProductMergePlan {
  /** Every barcode either product owned, now reassigned to `keepId` — write each via `productBarcodes.upsert`. Idempotent: re-running the same merge computes the identical set. */
  readonly barcodeRows: readonly ProductBarcode[];
  /** Every `PriceObservation` that will now roll up under `keepId` once `barcodeRows` is written — nothing here is rewritten; this is purely informative (e.g. for a confirmation screen showing "12 price observations will move"). */
  readonly observationsToRollUp: readonly PriceObservation[];
}

/**
 * Plans merging `dropId` into `keepId`: every barcode either product owns is
 * reassigned to `keepId`. Nothing about `PriceObservation` rows changes —
 * they still name the literal barcode a price was seen at; only the
 * `ProductBarcodes` lookup that resolves a barcode to a product changes,
 * which is exactly why past observations "survive" the merge automatically
 * once these rows are written (see `observationsForProduct` above).
 */
export function planProductMerge(
  keepId: ProductId,
  dropId: ProductId,
  barcodeRows: readonly ProductBarcode[],
  observations: readonly PriceObservation[],
): ProductMergePlan {
  const affectedBarcodes = [...barcodesForProduct(keepId, barcodeRows), ...barcodesForProduct(dropId, barcodeRows)];
  const reassigned = affectedBarcodes.map((barcode) => ({ productId: keepId, barcode }));
  const owned = new Set(affectedBarcodes);
  const observationsToRollUp = observations.filter((observation) => observation.barcode !== undefined && owned.has(observation.barcode));
  return { barcodeRows: reassigned, observationsToRollUp };
}
