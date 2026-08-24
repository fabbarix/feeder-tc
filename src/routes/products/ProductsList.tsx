import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { EmptyState, ErrorState, ListRow, ListSection, RouteTabs, Skeleton } from "../../ui/components";
import { PhotoMedia } from "../../ui/photo/index.ts";
import { Package } from "../../ui/icons.ts";
import { getPhotoDataUrl } from "../../photos/index.ts";
import { useWorkbookContext } from "../../workbook-context.ts";
import { useProductsData } from "./useProductsData.ts";
import { suggestProductMerges } from "../../domain/products.ts";
import { makeIngredientId } from "../../domain/index.ts";
import { PRODUCT_SECTION_TABS } from "./product-tabs.ts";
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
 */
export function ProductsList() {
  const { store } = useWorkbookContext();
  const data = useProductsData();
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
      <h1>Products</h1>
      <RouteTabs aria-label="Products section" items={PRODUCT_SECTION_TABS} />
      <section role="tabpanel" id="products-panel" aria-labelledby="products-panel-tab" tabIndex={-1}>
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

        <div className={styles.search}>
          <label htmlFor="product-search">Search</label>
          <input
            id="product-search"
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a product…"
          />
        </div>

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
          <EmptyState
            icon={Package}
            title="No products yet"
            description="Products are added automatically the first time you scan a new barcode — nothing to do here until then."
            action={
              <Link to="/scan" className={forms.addButton}>
                Scan a barcode
              </Link>
            }
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
