import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import {
  EmptyState,
  EntityTable,
  ErrorState,
  ListRow,
  ListSection,
  Skeleton,
} from "../../ui/components";
import { Tag } from "../../ui/icons.ts";
import { makeIngredientId, makeIsoDate, formatQuantity, type PriceObservation } from "../../domain/index.ts";
import { usePriceHistoryData } from "./usePriceHistoryData.ts";
import {
  aggregateByProduct,
  buildTrend,
  normalizedPointsFor,
  productSummariesForIngredient,
  sparklineValues,
} from "./price-history-aggregate.ts";
import { basisLabel, formatMoney } from "./currency-format.ts";
import { trendBadge, trendChangeOnly, trendSummary } from "./trend-copy.ts";
import { PriceSparkline } from "./PriceSparkline.tsx";
import { formatShortDate } from "../date-format.ts";
import styles from "./price-history.module.css";
import forms from "../forms.module.css";

/** "8 Aug" from a full `IsoTimestamp` — reuses `formatShortDate` (date-format.ts), same pattern as `PantryItem.tsx`'s own event-history rows. */
function shortDate(timestamp: string): string {
  return formatShortDate(makeIsoDate(timestamp.slice(0, 10)));
}

/**
 * Ingredient-level price history (M6 — DESIGN_PRODUCTS.md §1.4). Shows every
 * observation for this ingredient — whether recorded against a specific
 * scanned product or entered directly against the ingredient — as the
 * "coarse, blended" series, plus a "By product" breakdown of the finer
 * per-product level right alongside it (both levels §1.4 asks for, visible
 * on one page rather than requiring a second navigation to find the other
 * level exists at all).
 */
export function PriceHistoryIngredient() {
  const params = useParams<{ ingredientId: string }>();
  const data = usePriceHistoryData();

  const ingredientId =
    params.ingredientId !== undefined ? makeIngredientId(params.ingredientId) : undefined;
  const ingredient = ingredientId !== undefined ? data.ingredientsById.get(ingredientId) : undefined;

  const observations: readonly PriceObservation[] = useMemo(
    () => (ingredientId === undefined ? [] : data.observations.filter((o) => o.ingredientId === ingredientId)),
    [data.observations, ingredientId],
  );
  const points = useMemo(() => normalizedPointsFor(observations), [observations]);
  const trend = useMemo(() => buildTrend(points), [points]);

  const productSummaries = useMemo(() => {
    const all = aggregateByProduct(data.observations, data.productsByBarcode, data.ingredientsById);
    return ingredientId === undefined ? [] : productSummariesForIngredient(all, ingredientId);
  }, [data.observations, data.productsByBarcode, data.ingredientsById, ingredientId]);

  // History, most recent first (a ledger reads newest-on-top, same
  // convention as PantryItem.tsx's own event history).
  const historyRows = points.slice().reverse();

  function productNameFor(observation: PriceObservation): string {
    if (observation.barcode === undefined) return "General";
    return data.productsByBarcode.get(observation.barcode)?.name ?? "General";
  }

  return (
    <section>
      <p>
        <Link to="/products/prices" className={styles.backLink}>
          &larr; Price history
        </Link>
      </p>

      {data.loading ? (
        <>
          <h1>Price history</h1>
          <Skeleton />
        </>
      ) : null}

      {!data.loading && data.error ? (
        <>
          <h1>Price history</h1>
          <ErrorState title="Couldn't load price history" description={data.error} onRetry={data.retry} />
        </>
      ) : null}

      {!data.loading && !data.error && !ingredient ? (
        <>
          <h1>Price history</h1>
          <ErrorState
            title="No such ingredient"
            description={`No ingredient with id "${params.ingredientId}".`}
          />
        </>
      ) : null}

      {!data.loading && !data.error && ingredient ? (
        <>
          <div className={styles.headRow}>
            <div>
              <h1>{ingredient.name}</h1>
              <p className={styles.dtSub}>Price history · every observation for this ingredient</p>
            </div>
            {trend.kind !== "none" ? (
              <div className={styles.headLatest}>
                <span className={styles.headPrice}>{formatMoney(trend.latest.amount, data.currencySymbol)}</span>
                <span className={styles.headBasis}>{basisLabel(trend.latest.basis)}</span>
                <span className={styles.headTrend}>{trendChangeOnly(trend)}</span>
              </div>
            ) : null}
          </div>

          {points.length === 0 ? (
            <EmptyState
              icon={Tag}
              title="No prices recorded for this ingredient yet"
              description="Record one the next time you scan a barcode for it, or enter a price directly against it during checkout."
            />
          ) : (
            <div className={styles.cols}>
              <div className={styles.main}>
                {points.length >= 2 ? (
                  <div className={styles.sparklineWrap}>
                    <PriceSparkline
                      values={sparklineValues(points, 24)}
                      width={220}
                      height={56}
                      label={trendSummary(trend, data.currencySymbol)}
                    />
                  </div>
                ) : null}

                <div className={forms.sectionCard}>
                  <div className={forms.sectionCardHead}>Observations</div>
                  <div className={forms.sectionCardBody}>
                    <EntityTable
                      caption={`Price observations for ${ingredient.name}`}
                      hideCaption
                      rows={historyRows}
                      getRowKey={(point) => point.observation.id}
                      columns={[
                        { key: "date", header: "Date", render: (point) => shortDate(point.observation.timestamp) },
                        { key: "product", header: "Product", render: (point) => productNameFor(point.observation) },
                        {
                          key: "qty",
                          header: "Quantity",
                          render: (point) => formatQuantity(point.observation.quantity),
                        },
                        {
                          key: "price",
                          header: "Price paid",
                          align: "end",
                          render: (point) => formatMoney(point.observation.price, data.currencySymbol),
                        },
                        {
                          key: "normalized",
                          header: "Normalised",
                          align: "end",
                          render: (point) => `${formatMoney(point.amount, data.currencySymbol)} ${basisLabel(point.basis)}`,
                        },
                        {
                          key: "source",
                          header: "Source",
                          render: (point) => point.observation.source ?? "—",
                        },
                      ]}
                    />
                    <div className={styles.mobileHistory}>
                      {historyRows.map((point) => (
                        <ListRow
                          key={point.observation.id}
                          primary={
                            <span className={styles.obsDate}>{shortDate(point.observation.timestamp)}</span>
                          }
                          secondary={
                            <span className={styles.obsMeta}>
                              {productNameFor(point.observation)} · {formatQuantity(point.observation.quantity)}
                              {point.observation.source ? ` · ${point.observation.source}` : ""}
                            </span>
                          }
                          trailing={
                            <div className={styles.summary}>
                              <span className={styles.badge}>
                                {formatMoney(point.observation.price, data.currencySymbol)}
                              </span>
                              <span className={styles.count}>
                                {formatMoney(point.amount, data.currencySymbol)} {basisLabel(point.basis)}
                              </span>
                            </div>
                          }
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className={styles.rail}>
                <div className={forms.sectionCard}>
                  <div className={forms.sectionCardHead}>By product</div>
                  <div className={forms.sectionCardBody}>
                    {productSummaries.length === 0 ? (
                      <p className={forms.hint}>
                        Every observation so far was entered directly against this ingredient, none tied
                        to a specific scanned product yet.
                      </p>
                    ) : (
                      <ListSection heading={`${productSummaries.length} product${productSummaries.length === 1 ? "" : "s"}`}>
                        {productSummaries.map((summary) => (
                          <Link
                            key={summary.product.barcode}
                            to={`/products/prices/product/${summary.product.barcode}`}
                            className={forms.itemLink}
                          >
                            <ListRow
                              primary={summary.product.name}
                              secondary={
                                summary.trend.kind === "none"
                                  ? "No prices recorded yet"
                                  : `${formatMoney(summary.trend.latest.amount, data.currencySymbol)} ${basisLabel(summary.trend.latest.basis)}`
                              }
                              trailing={<span className={styles.badge}>{trendBadge(summary.trend)}</span>}
                            />
                          </Link>
                        ))}
                      </ListSection>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}
