import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { EmptyState, EntityTable, ErrorState, ListRow, Skeleton } from "../../ui/components";
import { Tag } from "../../ui/icons.ts";
import { makeBarcode, makeIsoDate, formatQuantity } from "../../domain/index.ts";
import { usePriceHistoryData } from "./usePriceHistoryData.ts";
import { buildTrend, normalizedPointsFor, sparklineValues } from "./price-history-aggregate.ts";
import { basisLabel, formatMoney } from "./currency-format.ts";
import { trendChangeOnly, trendSummary } from "./trend-copy.ts";
import { PriceSparkline } from "./PriceSparkline.tsx";
import { formatShortDate } from "../date-format.ts";
import styles from "./price-history.module.css";
import forms from "../forms.module.css";

/** "8 Aug" from a full `IsoTimestamp` — see PriceHistoryIngredient.tsx's identical helper. */
function shortDate(timestamp: string): string {
  return formatShortDate(makeIsoDate(timestamp.slice(0, 10)));
}

/**
 * Product-level price history (M6 — DESIGN_PRODUCTS.md §1.4's finer-grained
 * level): every observation naming this exact barcode, not the ingredient's
 * blended series (`PriceHistoryIngredient.tsx` shows that one, and links
 * here per product).
 */
export function PriceHistoryProduct() {
  const params = useParams<{ barcode: string }>();
  const data = usePriceHistoryData();

  let barcode: ReturnType<typeof makeBarcode> | undefined;
  try {
    barcode = params.barcode !== undefined ? makeBarcode(params.barcode) : undefined;
  } catch {
    barcode = undefined;
  }
  const product = barcode !== undefined ? data.productsByBarcode.get(barcode) : undefined;
  const ingredient = product !== undefined ? data.ingredientsById.get(product.ingredientId) : undefined;

  const observations = useMemo(
    () => (barcode === undefined ? [] : data.observations.filter((o) => o.barcode === barcode)),
    [data.observations, barcode],
  );
  const points = useMemo(() => normalizedPointsFor(observations), [observations]);
  const trend = useMemo(() => buildTrend(points), [points]);
  const historyRows = points.slice().reverse();

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

      {!data.loading && !data.error && !product ? (
        <>
          <h1>Price history</h1>
          <ErrorState
            title="No such product"
            description={`No product with barcode "${params.barcode}".`}
          />
        </>
      ) : null}

      {!data.loading && !data.error && product ? (
        <>
          <div className={styles.headRow}>
            <div>
              <h1>{product.name}</h1>
              <p className={styles.dtSub}>
                {product.brand ? `${product.brand} · ` : ""}
                {ingredient ? (
                  <Link to={`/products/prices/ingredient/${ingredient.id}`} className={forms.itemLink}>
                    {ingredient.name}
                  </Link>
                ) : (
                  "Ingredient not found"
                )}
              </p>
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
              title="No prices recorded for this product yet"
              description="Record one the next time you scan this barcode at checkout."
            />
          ) : (
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
                    caption={`Price observations for ${product.name}`}
                    hideCaption
                    rows={historyRows}
                    getRowKey={(point) => point.observation.id}
                    columns={[
                      { key: "date", header: "Date", render: (point) => shortDate(point.observation.timestamp) },
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
                        primary={<span className={styles.obsDate}>{shortDate(point.observation.timestamp)}</span>}
                        secondary={
                          <span className={styles.obsMeta}>
                            {formatQuantity(point.observation.quantity)}
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
          )}
        </>
      ) : null}
    </section>
  );
}
