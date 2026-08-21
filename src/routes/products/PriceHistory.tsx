import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  EmptyState,
  ErrorState,
  ListRow,
  ListSection,
  SegmentedControl,
  Skeleton,
} from "../../ui/components";
import { PhotoMedia } from "../../ui/photo/index.ts";
import { Tag } from "../../ui/icons.ts";
import { getPhotoDataUrl } from "../../photos/index.ts";
import { useWorkbookContext } from "../../workbook-context.ts";
import { usePriceHistoryData } from "./usePriceHistoryData.ts";
import {
  aggregateByIngredient,
  aggregateByProduct,
  sparklineValues,
  type IngredientPriceSummary,
  type ProductPriceSummary,
} from "./price-history-aggregate.ts";
import { basisLabel, formatMoney } from "./currency-format.ts";
import { trendBadge } from "./trend-copy.ts";
import { PriceSparkline } from "./PriceSparkline.tsx";
import styles from "./price-history.module.css";
import forms from "../forms.module.css";

type Level = "ingredient" | "product";

const LEVEL_OPTIONS: readonly { value: Level; label: string }[] = [
  { value: "ingredient", label: "By ingredient" },
  { value: "product", label: "By product" },
];

function latestLine(summary: IngredientPriceSummary | ProductPriceSummary, currencySymbol: string): string {
  const { trend } = summary;
  if (trend.kind === "none") return "No prices recorded yet";
  const price = `${formatMoney(trend.latest.amount, currencySymbol)} ${basisLabel(trend.latest.basis)}`;
  const count = summary.points.length;
  return `${price} · ${count} observation${count === 1 ? "" : "s"}`;
}

/**
 * Price-history list (M6 — DESIGN_PRODUCTS.md §1.4). No approved mock exists
 * for this screen (task brief) — this reuses the Pantry/Ingredients idiom
 * throughout: a `SegmentedControl` level toggle (mirrors Pantry's location
 * filter), `ListSection`/`ListRow` rows linking into a detail route (mirrors
 * Pantry's ingredient-aggregate rows linking to `/pantry/:id`), and the
 * kit's own `EmptyState`/`ErrorState`/`Skeleton` — nothing here invents a
 * new visual idiom.
 *
 * "By ingredient" / "By product" is §1.4's own two levels, made explicit as
 * a toggle rather than two separate pages a user has to already know exist.
 */
export function PriceHistory() {
  const { store } = useWorkbookContext();
  const data = usePriceHistoryData();
  const [level, setLevel] = useState<Level>("ingredient");

  const ingredientSummaries = useMemo(
    () => aggregateByIngredient(data.observations, data.ingredientsById),
    [data.observations, data.ingredientsById],
  );
  const productSummaries = useMemo(
    () => aggregateByProduct(data.observations, data.productsByBarcode, data.ingredientsById),
    [data.observations, data.productsByBarcode, data.ingredientsById],
  );

  // Any product-level observation also carries an ingredientId, so it is
  // always counted in `ingredientSummaries` too (price-history-aggregate.ts)
  // — an empty ingredient list is therefore the true "zero observations at
  // all" case, not just "zero at this one level".
  const hasAnyData = ingredientSummaries.length > 0;

  return (
    <section>
      <h1>Price history</h1>
      <p className={styles.dtSub}>
        Tracked automatically from the prices you record while scanning — per ingredient and per
        specific product (DESIGN_PRODUCTS.md §1.4).
      </p>

      {data.loading ? (
        <div className={forms.form}>
          <Skeleton />
          <Skeleton />
          <Skeleton />
        </div>
      ) : null}

      {!data.loading && data.error ? (
        <ErrorState title="Couldn't load price history" description={data.error} onRetry={data.retry} />
      ) : null}

      {!data.loading && !data.error && !hasAnyData ? (
        <EmptyState
          icon={Tag}
          title="No prices recorded yet"
          description="Prices are captured automatically the next time you record one while scanning a barcode at checkout."
          action={
            <Link to="/scan" className={forms.addButton}>
              Scan a barcode
            </Link>
          }
        />
      ) : null}

      {!data.loading && !data.error && hasAnyData ? (
        <>
          <div className={styles.toolbar}>
            <SegmentedControl<Level>
              aria-label="Group by"
              options={LEVEL_OPTIONS}
              value={level}
              onChange={setLevel}
            />
          </div>

          {level === "ingredient" ? (
            <ListSection heading={`${ingredientSummaries.length} tracked ingredient${ingredientSummaries.length === 1 ? "" : "s"}`}>
              {ingredientSummaries.map((summary) => (
                <Link
                  key={summary.ingredient.id}
                  to={`/products/prices/ingredient/${summary.ingredient.id}`}
                  className={forms.itemLink}
                >
                  <ListRow
                    leading={
                      <PhotoMedia
                        kind="ingredient"
                        hasPhoto={summary.ingredient.hasPhoto}
                        size="list"
                        fetchPhoto={() => getPhotoDataUrl(store, "ingredient", summary.ingredient.id)}
                        alt={summary.ingredient.name}
                      />
                    }
                    primary={summary.ingredient.name}
                    secondary={latestLine(summary, data.currencySymbol)}
                    trailing={
                      <div className={styles.summary}>
                        <div className={styles.sparklineWrap}>
                          <PriceSparkline
                            values={sparklineValues(summary.points)}
                            label={`Price shape for ${summary.ingredient.name} over ${summary.points.length} observations`}
                          />
                        </div>
                        <span className={styles.badge}>{trendBadge(summary.trend)}</span>
                      </div>
                    }
                  />
                </Link>
              ))}
            </ListSection>
          ) : null}

          {level === "product" && productSummaries.length === 0 ? (
            <EmptyState
              icon={Tag}
              title="No product-level prices yet"
              description="Prices tied to one specific scanned product (rather than the ingredient in general) show up here once you record one."
            />
          ) : null}

          {level === "product" && productSummaries.length > 0 ? (
            <ListSection heading={`${productSummaries.length} tracked product${productSummaries.length === 1 ? "" : "s"}`}>
              {productSummaries.map((summary) => (
                <Link
                  key={summary.product.barcode}
                  to={`/products/prices/product/${summary.product.barcode}`}
                  className={forms.itemLink}
                >
                  <ListRow
                    leading={
                      <PhotoMedia
                        kind="product"
                        hasPhoto={summary.product.hasPhoto}
                        size="list"
                        fetchPhoto={() => getPhotoDataUrl(store, "product", summary.product.barcode)}
                        alt={summary.product.name}
                      />
                    }
                    primary={summary.product.name}
                    secondary={
                      <div className={styles.secondaryLine}>
                        <span>{latestLine(summary, data.currencySymbol)}</span>
                        {summary.ingredient ? (
                          <span className={styles.subtext}>{summary.ingredient.name}</span>
                        ) : null}
                      </div>
                    }
                    trailing={
                      <div className={styles.summary}>
                        <div className={styles.sparklineWrap}>
                          <PriceSparkline
                            values={sparklineValues(summary.points)}
                            label={`Price shape for ${summary.product.name} over ${summary.points.length} observations`}
                          />
                        </div>
                        <span className={styles.badge}>{trendBadge(summary.trend)}</span>
                      </div>
                    }
                  />
                </Link>
              ))}
            </ListSection>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
