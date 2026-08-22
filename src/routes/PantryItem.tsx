import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useWorkbookContext } from "../workbook-context.ts";
import {
  ConfirmDialog,
  DateChips,
  ErrorState,
  FreshnessMeter,
  ListRow,
  QuantityInput,
  SegmentedControl,
  SelectSheet,
  Skeleton,
} from "../ui/components";
import {
  compareLotsForFifo,
  daysBetween,
  formatQuantity,
  makeIngredientId,
  makeIsoDate,
  makeQuantity,
} from "../domain/index.ts";
import type { InventoryEvent, IsoDate, Lot, LotId, StorageLocation } from "../domain/index.ts";
import { usePantryInventory } from "./pantry/usePantryInventory.ts";
import {
  LOCATION_OPTIONS,
  expiryOverrideOptions,
  locationLabel,
  purchaseDateOptions,
  unitFullName,
} from "./pantry/pantry-options.ts";
import { TextField } from "./fields.tsx";
import { formatMonthYear, formatShortDate } from "./date-format.ts";
import detailStyles from "./recipe-detail.module.css";
import styles from "./pantry/pantry.module.css";
import forms from "./forms.module.css";

type ActiveAction = "addLot" | "use" | "open" | "move" | "correct" | "spoil" | null;

function lotOptions(candidates: readonly Lot[]): readonly { value: LotId; label: string }[] {
  return candidates.map((lot) => ({
    value: lot.id,
    label: `${formatQuantity(lot.quantity)} — bought ${formatShortDate(lot.purchaseDate)}`,
  }));
}

/** "expires 28 Aug" / "expires Aug 2028" / "expired 2 Aug" — the LOTS card's own inline expiry text (design/mock-screens.html #lot: "Bought 2 Aug · pantry · expires Aug 2027"), separate from `expiryBadge`'s "N days" form, which is the aggregated LIST row's badge, not this page's. */
function lotExpiryText(daysLeft: number, expiry: IsoDate): string {
  if (daysLeft < 0) return `expired ${formatShortDate(expiry)}`;
  if (daysLeft <= 60) return `expires ${formatShortDate(expiry)}`;
  return `expires ${formatMonthYear(expiry)}`;
}

function describeEvent(event: InventoryEvent): string {
  switch (event.type) {
    case "purchase":
      return `purchased ${formatQuantity(event.quantity)}`;
    case "use":
      return `used ${formatQuantity(event.quantity)}`;
    case "spoil":
      return `marked spoiled ${formatQuantity(event.quantity)}`;
    case "move":
      return `moved to ${locationLabel(event.location)}`;
    case "open":
      return "opened";
    case "adjust": {
      const parts: string[] = [];
      if (event.delta)
        parts.push(`adjusted ${event.delta.amount > 0 ? "+" : ""}${formatQuantity(event.delta)}`);
      if (event.expiry) parts.push(`new expiry ${formatShortDate(event.expiry)}`);
      if (event.reason) parts.push(event.reason);
      return `corrected — ${parts.join(", ") || "no change recorded"}`;
    }
  }
}

/**
 * A pantry item (WP-VC4, design/mock-screens.html #lot: `/pantry/:id`,
 * which did not exist before this — `Pantry.tsx` used to render every lot
 * inline with its own action buttons, so there was nowhere for "one
 * ingredient's whole story" to live). Three cards: `LOTS · FIFO ORDER`
 * (display only — no per-lot buttons here any more, matching the mock),
 * `RECORD AN EVENT` (the five manual actions, each naming which lot it
 * applies to via a picker when there's more than one), and `HISTORY` (every
 * event ever recorded for this ingredient, oldest last — a read, never an
 * edit: invariant 1, "Correct" appends an `adjust` event rather than
 * editing anything).
 */
export function PantryItem() {
  const params = useParams<{ ingredientId: string }>();
  const { store, clock } = useWorkbookContext();
  const pantry = usePantryInventory();
  const today = clock.today();

  const ingredientId =
    params.ingredientId !== undefined ? makeIngredientId(params.ingredientId) : undefined;
  const ingredient =
    ingredientId !== undefined ? pantry.ingredientsById.get(ingredientId) : undefined;

  // Plain derived consts, not `useMemo` — this project's React Compiler
  // (eslint-plugin-react-hooks' `preserve-manual-memoization` rule) auto-
  // memoizes the whole component; a manual `useMemo` wrapping a callback
  // with its own early-return branch is exactly the shape the compiler
  // sometimes can't rebuild identically, which then fails the build as
  // "could not preserve existing memoization" rather than silently no-op.
  const lots: readonly Lot[] =
    ingredientId === undefined
      ? []
      : pantry.lots
          .filter((lot) => lot.ingredientId === ingredientId)
          .slice()
          .sort(compareLotsForFifo);
  const openableLots = lots.filter((lot) => lot.openedAt === undefined);

  const [events, setEvents] = useState<readonly InventoryEvent[]>([]);
  useEffect(() => {
    let cancelled = false;
    store.inventoryEvents
      .readFrom(0)
      .then((page) => {
        if (!cancelled) setEvents(page.rows);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [store]);

  const history = events
    .filter((event) => event.ingredientId === ingredientId)
    .slice()
    .sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0));

  const [activeAction, setActiveAction] = useState<ActiveAction>(null);
  const [selectedLotId, setSelectedLotId] = useState<LotId | null>(null);

  const [addAmount, setAddAmount] = useState<number | null>(null);
  const [addLocation, setAddLocation] = useState<StorageLocation>("pantry");
  const [addPurchaseDate, setAddPurchaseDate] = useState<IsoDate>(today);
  const [addExpiryOverride, setAddExpiryOverride] = useState<IsoDate | null>(null);

  const [useAmount, setUseAmount] = useState<number | null>(null);
  const [moveTarget, setMoveTarget] = useState<StorageLocation>("pantry");
  const [spoilAmount, setSpoilAmount] = useState<number | null>(null);
  const [correctDelta, setCorrectDelta] = useState<number | null>(null);
  const [correctExpiry, setCorrectExpiry] = useState<IsoDate | null>(null);
  const [correctReason, setCorrectReason] = useState("");

  function closeDialog(): void {
    setActiveAction(null);
  }

  function openAddLotDialog(): void {
    setAddAmount(null);
    setAddLocation(ingredient?.defaultLocation ?? "pantry");
    setAddPurchaseDate(today);
    setAddExpiryOverride(null);
    setActiveAction("addLot");
  }

  function openUseDialog(): void {
    setUseAmount(null);
    setActiveAction("use");
  }

  function openOpenDialog(): void {
    setSelectedLotId(openableLots[0]?.id ?? null);
    setActiveAction("open");
  }

  function openMoveDialog(): void {
    const first = lots[0];
    setSelectedLotId(first?.id ?? null);
    setMoveTarget(first?.location ?? "pantry");
    setActiveAction("move");
  }

  function openSpoilDialog(): void {
    const first = lots[0];
    setSelectedLotId(first?.id ?? null);
    setSpoilAmount(first?.quantity.amount ?? null);
    setActiveAction("spoil");
  }

  function openCorrectDialog(): void {
    setSelectedLotId(lots[0]?.id ?? null);
    setCorrectDelta(null);
    setCorrectExpiry(null);
    setCorrectReason("");
    setActiveAction("correct");
  }

  const selectedMoveLot = lots.find((lot) => lot.id === selectedLotId);

  return (
    <section>
      {pantry.loading ? (
        <>
          <h1>Pantry item</h1>
          <Skeleton />
        </>
      ) : null}
      {!pantry.loading && pantry.error ? (
        <>
          <h1>Pantry item</h1>
          <ErrorState
            title="Couldn't load the pantry"
            description={pantry.error}
            onRetry={pantry.retry}
          />
        </>
      ) : null}
      {!pantry.loading && !pantry.error && !ingredient ? (
        <>
          <h1>Pantry item</h1>
          <ErrorState
            title="No such pantry item"
            description={`No ingredient with id "${params.ingredientId}".`}
          />
        </>
      ) : null}

      {!pantry.loading && !pantry.error && ingredient ? (
        <>
          <div className={detailStyles.headRow}>
            <div>
              <h1>{ingredient.name}</h1>
              <p className={detailStyles.dtSub}>
                Canonical unit: {unitFullName(ingredient.unit)} ·{" "}
                {locationLabel(ingredient.defaultLocation)} default · shelf life{" "}
                {ingredient.shelfLifeDays} days
              </p>
            </div>
            <div className={detailStyles.headActions}>
              {/* M6 (DESIGN_PRODUCTS.md §1.4) — the price-history view has no
                  nav entry of its own (it isn't a primary-nav section), so
                  it's reached from the ingredient's own page, same as the
                  scan route's known-product flow links to the product-level
                  page (Scan.tsx). */}
              <Link to={`/products/prices/ingredient/${ingredient.id}`} className={detailStyles.editLink}>
                Price history
              </Link>
              <button type="button" className={styles.actionButton} onClick={openAddLotDialog}>
                Add a lot
              </button>
            </div>
          </div>

          <div className={styles.pantryItemCols}>
            <div className={forms.sectionCard}>
              <div className={forms.sectionCardHead}>Lots · FIFO order</div>
              <div className={forms.sectionCardBody}>
                {lots.length === 0 ? (
                  <p className={forms.hint}>No lots yet — add one above.</p>
                ) : (
                  lots.map((lot, index) => {
                    const frozen = lot.location === "freezer";
                    const daysLeft = daysBetween(today, lot.expiry);
                    const reference = lot.openedAt ?? lot.purchaseDate;
                    const totalDays = Math.max(1, daysBetween(reference, lot.expiry));
                    const fraction = daysLeft / totalDays;
                    return (
                      <ListRow
                        key={lot.id}
                        primary={formatQuantity(lot.quantity)}
                        secondary={
                          <div className={styles.lotDetail}>
                            <span>
                              Bought {formatShortDate(lot.purchaseDate)} ·{" "}
                              {locationLabel(lot.location)}
                              {lot.openedAt ? ` · opened ${formatShortDate(lot.openedAt)}` : ""}
                              {frozen ? "" : ` · ${lotExpiryText(daysLeft, lot.expiry)}`}
                            </span>
                            {!frozen ? (
                              <div className={styles.meter}>
                                <FreshnessMeter
                                  fractionRemaining={fraction}
                                  label={
                                    daysLeft >= 0
                                      ? `${daysLeft} of ${totalDays} days remaining`
                                      : "Expired"
                                  }
                                />
                              </div>
                            ) : null}
                          </div>
                        }
                        trailing={
                          <span className={index === 0 ? styles.nextOutBadge : styles.queuedBadge}>
                            {index === 0 ? "Next out" : "Queued"}
                          </span>
                        }
                      />
                    );
                  })
                )}
              </div>
            </div>

            <div className={styles.pantryItemRail}>
              <div className={forms.sectionCard}>
                <div className={forms.sectionCardHead}>Record an event</div>
                <div className={styles.eventRail}>
                  <button
                    type="button"
                    className={styles.actionButton}
                    onClick={openUseDialog}
                    disabled={lots.length === 0}
                  >
                    Use some
                  </button>
                  <button
                    type="button"
                    className={styles.actionButton}
                    onClick={openOpenDialog}
                    disabled={openableLots.length === 0}
                  >
                    Open a lot
                  </button>
                  <button
                    type="button"
                    className={styles.actionButton}
                    onClick={openMoveDialog}
                    disabled={lots.length === 0}
                  >
                    Move location
                  </button>
                  <button
                    type="button"
                    className={styles.actionButton}
                    onClick={openCorrectDialog}
                    disabled={lots.length === 0}
                  >
                    Correct quantity or expiry
                  </button>
                  <button
                    type="button"
                    className={`${styles.actionButton} ${styles.actionButtonDestructive}`}
                    onClick={openSpoilDialog}
                    disabled={lots.length === 0}
                  >
                    Mark spoiled
                  </button>
                </div>
              </div>

              <div className={forms.sectionCard}>
                <div className={forms.sectionCardHead}>History</div>
                <div className={styles.historyList}>
                  {history.length === 0 ? (
                    <p className={forms.hint}>No events recorded yet.</p>
                  ) : (
                    history.map((event) => (
                      <div key={event.id}>
                        {formatShortDate(makeIsoDate(event.timestamp.slice(0, 10)))} ·{" "}
                        {describeEvent(event)}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* History is a read, never an edit (invariant 1, design/mock-screens.html
              #lot's own note) — every action below appends a new event; corrections
              are new `adjust` events, which is why "Correct" exists and "Edit" never
              will. */}

          <ConfirmDialog
            open={activeAction === "addLot"}
            title={`Add a lot of ${ingredient.name}`}
            description={
              <div className={styles.dialogForm}>
                <QuantityInput
                  label="Amount"
                  unit={ingredient.unit}
                  value={addAmount}
                  onChange={(q) => setAddAmount(q?.amount ?? null)}
                  required
                />
                <div className={forms.field}>
                  <span className={forms.fieldLabel}>Location</span>
                  <SegmentedControl<StorageLocation>
                    aria-label="Location"
                    options={LOCATION_OPTIONS}
                    value={addLocation}
                    onChange={setAddLocation}
                  />
                </div>
                <DateChips
                  label="Purchase date"
                  options={purchaseDateOptions(today)}
                  value={addPurchaseDate}
                  onChange={setAddPurchaseDate}
                  allowPick
                />
                <DateChips
                  label="Expiry override (optional — otherwise uses the catalog default)"
                  options={expiryOverrideOptions(today)}
                  value={addExpiryOverride}
                  onChange={setAddExpiryOverride}
                  allowPick
                />
              </div>
            }
            confirmLabel="Add to pantry"
            onConfirm={() => {
              if (addAmount === null || addAmount <= 0) return;
              void pantry.addLot({
                ingredientId: ingredient.id,
                quantity: { amount: addAmount, unit: ingredient.unit },
                location: addLocation,
                purchaseDate: addPurchaseDate,
                ...(addExpiryOverride !== null ? { expiryOverride: addExpiryOverride } : {}),
              });
              closeDialog();
            }}
            onCancel={closeDialog}
          />

          <ConfirmDialog
            open={activeAction === "use"}
            title={`Use some ${ingredient.name}`}
            description={
              <div className={styles.dialogForm}>
                <p className={styles.dialogHint}>
                  Uses your oldest stock first, so you can't pick which batch this comes from.
                </p>
                <QuantityInput
                  label="Amount used"
                  unit={ingredient.unit}
                  value={useAmount}
                  onChange={(q) => setUseAmount(q?.amount ?? null)}
                  required
                />
              </div>
            }
            confirmLabel="Record usage"
            onConfirm={() => {
              if (useAmount === null || useAmount <= 0) return;
              void pantry.useSome({
                ingredientId: ingredient.id,
                quantity: makeQuantity(useAmount, ingredient.unit),
              });
              closeDialog();
            }}
            onCancel={closeDialog}
          />

          <ConfirmDialog
            open={activeAction === "open"}
            title={`Open a lot of ${ingredient.name}`}
            description={
              <div className={styles.dialogForm}>
                {openableLots.length > 1 ? (
                  <SelectSheet<LotId>
                    label="Which lot?"
                    options={lotOptions(openableLots)}
                    value={selectedLotId}
                    onChange={setSelectedLotId}
                  />
                ) : null}
                <p className={styles.dialogHint}>
                  Shelf life shortens to the opened default ({ingredient.openedShelfLifeDays} days)
                  from today.
                </p>
              </div>
            }
            confirmLabel="Mark opened"
            onConfirm={() => {
              if (selectedLotId === null) return;
              void pantry.open({ ingredientId: ingredient.id, lotId: selectedLotId });
              closeDialog();
            }}
            onCancel={closeDialog}
          />

          <ConfirmDialog
            open={activeAction === "move"}
            title={`Move ${ingredient.name}`}
            description={
              <div className={styles.dialogForm}>
                {lots.length > 1 ? (
                  <SelectSheet<LotId>
                    label="Which lot?"
                    options={lotOptions(lots)}
                    value={selectedLotId}
                    onChange={(id) => {
                      setSelectedLotId(id);
                      const lot = lots.find((l) => l.id === id);
                      if (lot) setMoveTarget(lot.location);
                    }}
                  />
                ) : null}
                <SegmentedControl<StorageLocation>
                  aria-label="New location"
                  options={LOCATION_OPTIONS}
                  value={moveTarget}
                  onChange={setMoveTarget}
                />
              </div>
            }
            confirmLabel="Confirm move"
            onConfirm={() => {
              if (selectedLotId === null) return;
              if (!selectedMoveLot || moveTarget !== selectedMoveLot.location) {
                void pantry.move({
                  ingredientId: ingredient.id,
                  lotId: selectedLotId,
                  location: moveTarget,
                });
              }
              closeDialog();
            }}
            onCancel={closeDialog}
          />

          <ConfirmDialog
            open={activeAction === "spoil"}
            title={`Mark ${ingredient.name} spoiled`}
            destructive
            description={
              <div className={styles.dialogForm}>
                {lots.length > 1 ? (
                  <SelectSheet<LotId>
                    label="Which lot?"
                    options={lotOptions(lots)}
                    value={selectedLotId}
                    onChange={(id) => {
                      setSelectedLotId(id);
                      const lot = lots.find((l) => l.id === id);
                      setSpoilAmount(lot?.quantity.amount ?? null);
                    }}
                  />
                ) : null}
                <p className={styles.dialogHint}>
                  How much of this lot spoiled? Defaults to the full remaining amount.
                </p>
                <QuantityInput
                  label="Amount"
                  unit={ingredient.unit}
                  value={spoilAmount}
                  onChange={(q) => setSpoilAmount(q?.amount ?? null)}
                  required
                />
              </div>
            }
            confirmLabel="Confirm spoilage"
            onConfirm={() => {
              if (selectedLotId === null || spoilAmount === null || spoilAmount <= 0) return;
              void pantry.markSpoiled({
                ingredientId: ingredient.id,
                lotId: selectedLotId,
                quantity: makeQuantity(spoilAmount, ingredient.unit),
              });
              closeDialog();
            }}
            onCancel={closeDialog}
          />

          <ConfirmDialog
            open={activeAction === "correct"}
            title={`Correct ${ingredient.name}`}
            description={
              <div className={styles.dialogForm}>
                {lots.length > 1 ? (
                  <SelectSheet<LotId>
                    label="Which lot?"
                    options={lotOptions(lots)}
                    value={selectedLotId}
                    onChange={setSelectedLotId}
                  />
                ) : null}
                <p className={styles.dialogHint}>
                  This adds a correction on top of the history rather than changing what was
                  already recorded. Enter an amount, a new expiry, or both.
                </p>
                <QuantityInput
                  label="Adjust amount by"
                  unit={ingredient.unit}
                  value={correctDelta}
                  onChange={(q) => setCorrectDelta(q?.amount ?? null)}
                  allowNegative
                  placeholder="e.g. -50 or 20"
                />
                <DateChips
                  label="New expiry"
                  options={expiryOverrideOptions(today)}
                  value={correctExpiry}
                  onChange={setCorrectExpiry}
                  allowPick
                />
                <TextField
                  label="Reason (optional)"
                  value={correctReason}
                  onChange={setCorrectReason}
                />
              </div>
            }
            confirmLabel="Save correction"
            onConfirm={() => {
              if (selectedLotId === null || (correctDelta === null && correctExpiry === null))
                return;
              void pantry.correct({
                ingredientId: ingredient.id,
                lotId: selectedLotId,
                ...(correctDelta !== null
                  ? { delta: makeQuantity(correctDelta, ingredient.unit) }
                  : {}),
                ...(correctExpiry !== null ? { expiry: correctExpiry } : {}),
                ...(correctReason.trim() !== "" ? { reason: correctReason.trim() } : {}),
              });
              closeDialog();
            }}
            onCancel={closeDialog}
          />
        </>
      ) : null}
    </section>
  );
}
