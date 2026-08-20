import { useMemo, useState } from "react";
import { useWorkbookContext } from "../workbook-context.ts";
import { EmptyState, ErrorState, ListSection, Skeleton } from "../ui/components";
import { Package, Plus } from "../ui/icons";
import { compareLotsForFifo, daysBetween } from "../domain/index.ts";
import type { Ingredient, Lot } from "../domain/index.ts";
import { usePantryInventory } from "./pantry/usePantryInventory.ts";
import { AddLotForm, UseSomeForm } from "./pantry/PantryForms.tsx";
import { PantryLotRow } from "./pantry/PantryLotRow.tsx";
import { EXPIRING_SOON_DAYS, locationLabel, LOCATION_OPTIONS } from "./pantry/pantry-options.ts";
import styles from "./pantry/pantry.module.css";
import forms from "./forms.module.css";

type ActiveForm = "add" | "use" | null;

interface LotWithIngredient {
  readonly lot: Lot;
  readonly ingredient: Ingredient;
}

/**
 * Pantry view (WP-21): grouped by ingredient with lots/quantities/
 * locations/expiry, an "Expiring soon" section surfaced ahead of everything
 * else (UI_DESIGN.md §13 "group by urgency first, location second" — the
 * question a user opens the pantry with is "what must I use"), manual
 * add-lot, and the four lot-scoped actions (open/move/spoil/correct) plus
 * ingredient-level "use some" (FIFO, invariant 4). Every write goes through
 * `usePantryInventory`'s outbox (invariant 9) — this component never talks
 * to `WorkbookStore.inventoryEvents` directly.
 */
export function Pantry() {
  const { clock } = useWorkbookContext();
  const pantry = usePantryInventory();
  const [activeForm, setActiveForm] = useState<ActiveForm>(null);

  const today = clock.today();

  const lotsWithIngredient = useMemo<readonly LotWithIngredient[]>(() => {
    const result: LotWithIngredient[] = [];
    for (const lot of pantry.lots) {
      const ingredient = pantry.ingredientsById.get(lot.ingredientId);
      if (ingredient) result.push({ lot, ingredient });
    }
    return result;
  }, [pantry.lots, pantry.ingredientsById]);

  const expiring = useMemo(
    () =>
      lotsWithIngredient
        .filter(({ lot }) => lot.location !== "freezer" && daysBetween(today, lot.expiry) <= EXPIRING_SOON_DAYS)
        .sort((a, b) => daysBetween(today, a.lot.expiry) - daysBetween(today, b.lot.expiry)),
    [lotsWithIngredient, today],
  );

  const groupedByIngredient = useMemo(() => {
    const groups = new Map<string, { ingredient: Ingredient; lots: LotWithIngredient[] }>();
    for (const entry of lotsWithIngredient) {
      const existing = groups.get(entry.ingredient.id);
      if (existing) {
        existing.lots.push(entry);
      } else {
        groups.set(entry.ingredient.id, { ingredient: entry.ingredient, lots: [entry] });
      }
    }
    return [...groups.values()]
      .sort((a, b) => a.ingredient.name.localeCompare(b.ingredient.name))
      .map((group) => ({
        ingredient: group.ingredient,
        lots: group.lots.slice().sort((a, b) => compareLotsForFifo(a.lot, b.lot)),
      }));
  }, [lotsWithIngredient]);

  const ingredientsWithStock = useMemo(
    () => groupedByIngredient.map((group) => group.ingredient),
    [groupedByIngredient],
  );

  const locationCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const { lot } of lotsWithIngredient) {
      counts.set(lot.location, (counts.get(lot.location) ?? 0) + 1);
    }
    return counts;
  }, [lotsWithIngredient]);

  function renderRow(entry: LotWithIngredient) {
    const { lot, ingredient } = entry;
    return (
      <PantryLotRow
        key={lot.id}
        lot={lot}
        ingredient={ingredient}
        today={today}
        failed={pantry.failedLot?.lotId === lot.id}
        onRetryFailed={pantry.retryFlush}
        onOpen={() => void pantry.open({ ingredientId: lot.ingredientId, lotId: lot.id })}
        onMove={(location) => void pantry.move({ ingredientId: lot.ingredientId, lotId: lot.id, location })}
        onSpoil={(quantity) => void pantry.markSpoiled({ ingredientId: lot.ingredientId, lotId: lot.id, quantity })}
        onCorrect={(input) => void pantry.correct({ ingredientId: lot.ingredientId, lotId: lot.id, ...input })}
      />
    );
  }

  return (
    <section>
      <h1>Pantry</h1>

      {pantry.loading ? (
        <div className={forms.form}>
          <Skeleton />
          <Skeleton />
          <Skeleton />
        </div>
      ) : null}

      {!pantry.loading && pantry.error ? (
        <ErrorState title="Couldn't load your pantry" description={pantry.error} onRetry={pantry.retry} />
      ) : null}

      {!pantry.loading && !pantry.error ? (
        <div className={styles.layout}>
          <div className={styles.main}>
            {/* Only one control with a given accessible name at a time (same
                rule as Recipes.tsx's "Add recipe"): the toolbar toggle while
                no form is open, the open form's own submit button while one
                is, or EmptyState's action while there's nothing yet — never
                two at once, since a duplicate accessible name is confusing
                for a screen-reader user most of all. */}
            {lotsWithIngredient.length > 0 && activeForm === null ? (
              <div className={styles.toolbar}>
                <button
                  type="button"
                  className={`${styles.toolbarButton} ${activeForm === "add" ? styles.toolbarButtonActive : ""}`}
                  onClick={() => setActiveForm((current) => (current === "add" ? null : "add"))}
                >
                  <Plus size={18} aria-hidden="true" />
                  Add to pantry
                </button>
                <button
                  type="button"
                  className={`${styles.toolbarButton} ${activeForm === "use" ? styles.toolbarButtonActive : ""}`}
                  onClick={() => setActiveForm((current) => (current === "use" ? null : "use"))}
                  disabled={ingredientsWithStock.length === 0}
                >
                  Record usage
                </button>
              </div>
            ) : null}

            {activeForm === "add" ? (
              <AddLotForm
                ingredients={pantry.ingredients}
                today={today}
                onSubmit={(input) => {
                  void pantry.addLot(input);
                  setActiveForm(null);
                }}
                onCancel={() => setActiveForm(null)}
              />
            ) : null}

            {activeForm === "use" ? (
              <UseSomeForm
                ingredients={ingredientsWithStock}
                onSubmit={(input) => {
                  void pantry.useSome(input);
                  setActiveForm(null);
                }}
                onCancel={() => setActiveForm(null)}
              />
            ) : null}

            {lotsWithIngredient.length === 0 && activeForm === null ? (
              <EmptyState
                icon={Package}
                title="Your pantry is empty"
                description="Add what's already in your kitchen to start tracking quantities and expiry."
                action={
                  <button type="button" className={forms.addButton} onClick={() => setActiveForm("add")}>
                    <Plus size={18} aria-hidden="true" />
                    Add to pantry
                  </button>
                }
              />
            ) : (
              <>
                {expiring.length > 0 ? (
                  <ListSection heading="Expiring soon">{expiring.map(renderRow)}</ListSection>
                ) : null}
                {groupedByIngredient.map((group) => (
                  <ListSection key={group.ingredient.id} heading={group.ingredient.name}>
                    {group.lots.map(renderRow)}
                  </ListSection>
                ))}
              </>
            )}
          </div>

          <aside className={styles.rail}>
            <div className={styles.railCard}>
              <p className={styles.railTitle}>At a glance</p>
              <div className={styles.railStat}>
                <span>Expiring soon</span>
                <strong>{expiring.length}</strong>
              </div>
              {LOCATION_OPTIONS.map((option) => (
                <div className={styles.railStat} key={option.value}>
                  <span>{locationLabel(option.value)}</span>
                  <strong>{locationCounts.get(option.value) ?? 0}</strong>
                </div>
              ))}
            </div>
          </aside>
        </div>
      ) : null}
    </section>
  );
}
