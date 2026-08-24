import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  EmptyState,
  ErrorState,
  ListRow,
  ListSection,
  RouteTabs,
  SearchField,
  SegmentedControl,
  Skeleton,
} from "../../ui/components";
import { PhotoMedia } from "../../ui/photo/index.ts";
import { Package } from "../../ui/icons.ts";
import { getPhotoDataUrl } from "../../photos/index.ts";
import { useWorkbookContext } from "../../workbook-context.ts";
import { useProductsData } from "./useProductsData.ts";
import { suggestProductMerges } from "../../domain/products.ts";
import { makeIngredientId } from "../../domain/index.ts";
import { SECTION_TABS } from "../section-tabs.ts";
import { PRODUCTS_VIEW_OPTIONS } from "./products-view.ts";
import styles from "./products.module.css";
import forms from "../forms.module.css";

/**
 * Browse every product (WP-products-screen — usability finding: a barcode
 * mapped to the wrong ingredient had no repair path at all; this is that
 * repair path's front door). `layout="grid"` + `AppShell`'s matching
 * `WIDE_ROUTES` entry: same flat, alphabetical, no-scan-order-to-protect
 * catalogue idiom as `Ingredients.tsx` (WP-VC4).
 *
 * `?ingredient=<id>` (set by `IngredientEditor.tsx`'s "View products for
 * this ingredient" link — the ingredient-to-product repair path the task
 * brief requires) filters to just that ingredient's products, with a
 * banner naming the filter and a way to clear it.
 *
 * WP-VC5 defect sweep: "Products" is now the third tab of the shared
 * Recipes/Ingredients/Products strip (`SECTION_TABS`), not a standalone
 * area with its own nav-less `/products` route nobody linked to. Price
 * history (the sibling `PriceHistory.tsx`/`/products/prices` route) folds
 * INSIDE this same "Products" tab as a `SegmentedControl` — "Catalog" /
 * "Price history" — rather than becoming a fourth top-level tab: the
 * 3-tab strip already sits close to what fits at 390px (see
 * `RouteTabs.module.css`), and a fourth tab risked wrapping there, while a
 * secondary in-tab toggle costs nothing at any width and keeps both the
 * per-product AND per-ingredient price views exactly where they were,
 * still their own deep-linkable routes.
 */
export function ProductsList() {
  const { store } = useWorkbookContext();
  const data = useProductsData();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState("");

  const ingredientFilterRaw = searchParams.get("ingredient");
  const ingredientFilter = ingredientFilterRaw ? makeIngredientId(ingredientFilterRaw) : undefined;
  const filterIngredient = ingredientFilter ? data.ingredientsById.get(ingredientFilter) : undefined;

  const filtered = useMemo(() => {
    let list = data.products;
    if (ingredientFilter) list = list.filter((p) => p.ingredientId === ingredientFilter);
    const q = query.trim().toLowerCase();
    if (q) list = list.filter((p) => p.name.toLowerCase().includes(q) || (p.brand ?? "").toLowerCase().includes(q));
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  }, [data.products, ingredientFilter, query]);

  const mergeSuggestionCount = useMemo(() => suggestProductMerges(data.products).length, [data.products]);

  return (
    <>
      {/* One h1 for the whole "Recipes" area (WP-VC5), same visually-hidden
          treatment as Recipes.tsx/Ingredients.tsx now that "Products" is a
          tab of that same area rather than its own top-level section. */}
      <h1 className="visually-hidden">Recipes</h1>
      {/* Primary action: this area's equivalent of "Add recipe"/"Add
          ingredient" is "Scan a barcode" — products are never typed in by
          hand (they're created automatically the first time a barcode is
          scanned), so the verb differs on purpose, but the placement
          (header row, above the tab strip) and weight (`forms.addButton`)
          match exactly. Unlike Recipes/Ingredients (which usually already
          have content), a brand-new workbook has ZERO products — so unlike
          those two, this action is always shown, not hidden until the list
          is non-empty; the empty state below carries no action of its own,
          so there is still only ever one "Scan a barcode" control on
          screen. */}
      <div className={forms.sectionHeaderRow}>
        <Link to="/scan" className={forms.addButton}>
          Scan a barcode
        </Link>
      </div>
      <RouteTabs aria-label="Recipes section" items={SECTION_TABS} />
      <section role="tabpanel" id="products-panel" aria-labelledby="products-panel-tab" tabIndex={-1}>
        <div className={styles.toolbar}>
          <SegmentedControl
            aria-label="Products view"
            options={PRODUCTS_VIEW_OPTIONS}
            value="catalog"
            onChange={(next) => navigate(next === "prices" ? "/products/prices" : "/products")}
          />
        </div>

        <p className={styles.dtSub}>
          Every product you&rsquo;ve scanned or added — brand, package size, barcodes and price history in one
          place. Open one to fix a barcode that ended up on the wrong item, or to combine two entries for the same
          product.
        </p>

        {filterIngredient ? (
          <p className={forms.hint}>
            Showing products for <strong>{filterIngredient.name}</strong> —{" "}
            <button type="button" className={forms.itemLink} onClick={() => setSearchParams({})}>
              show all products
            </button>
          </p>
        ) : null}

        {!data.loading && !data.error && mergeSuggestionCount > 0 && !ingredientFilter ? (
          <p className={forms.hint}>
            {mergeSuggestionCount} possible duplicate {mergeSuggestionCount === 1 ? "pair looks" : "pairs look"} like
            the same product under different barcodes — open either product to review and confirm.
          </p>
        ) : null}

        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="Find a product…"
          aria-label="Search products"
        />

        {data.loading ? (
          <div className={forms.form}>
            <Skeleton />
            <Skeleton />
            <Skeleton />
          </div>
        ) : null}

        {!data.loading && data.error ? (
          <ErrorState title="Couldn't load your products" description={data.error} onRetry={data.retry} />
        ) : null}

        {!data.loading && !data.error && data.products.length === 0 ? (
          // No `action` here (unlike Recipes.tsx/Ingredients.tsx's empty
          // states) — the header row above already carries the one "Scan a
          // barcode" control this page has, so a second copy in the empty
          // state would be a duplicate accessible name on screen at once.
          <EmptyState
            icon={Package}
            title="No products yet"
            description="Products are added automatically the first time you scan a new barcode — nothing to do here until then."
          />
        ) : null}

        {!data.loading && !data.error && data.products.length > 0 && filtered.length === 0 ? (
          <EmptyState icon={Package} title="No products match" description="Try a different search, or clear it." />
        ) : null}

        {!data.loading && !data.error && filtered.length > 0 ? (
          <ListSection heading={`${filtered.length} of ${data.products.length}`} layout="grid">
            {filtered.map((product) => {
              const barcodeCount = data.barcodesByProduct.get(product.id)?.length ?? 0;
              const ingredient = data.ingredientsById.get(product.ingredientId);
              return (
                <ListRow
                  key={product.id}
                  variant="card"
                  leading={
                    <PhotoMedia
                      kind="product"
                      hasPhoto={product.hasPhoto}
                      size="list"
                      fetchPhoto={() => getPhotoDataUrl(store, "product", product.id)}
                      alt={product.name}
                    />
                  }
                  primary={
                    <Link to={`/products/${product.id}`} className={forms.itemLink}>
                      {product.name}
                    </Link>
                  }
                  secondary={`${product.brand ? `${product.brand} · ` : ""}${ingredient?.name ?? "Unknown ingredient"} · ${barcodeCount} barcode${barcodeCount === 1 ? "" : "s"}`}
                />
              );
            })}
          </ListSection>
        ) : null}
      </section>
    </>
  );
}
