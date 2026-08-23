import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useWorkbookContext } from "../workbook-context.ts";
import { EmptyState, ErrorState, ListSection, Skeleton } from "../ui/components";
import { Barcode, ShoppingCart } from "../ui/icons";
import type { DateRange, Ingredient, ShoppingListLine } from "../domain/index.ts";
import { groupByCategory } from "./shopping/categories.ts";
import { RangeChips } from "./shopping/RangeChips.tsx";
import { ShoppingRow } from "./shopping/ShoppingRow.tsx";
import { useShoppingList } from "./shopping/useShoppingList.ts";
import { formatRangeLabel, rangeForPreset, type ShoppingRangePreset } from "./shopping/range.ts";
import type { ProvenanceContext } from "./shopping/provenance.ts";
import styles from "./shopping/shopping.module.css";
import forms from "./forms.module.css";

interface LineWithIngredient {
  readonly line: ShoppingListLine;
  readonly ingredient: Ingredient;
}

/**
 * Shopping route (WP-23 · M4): a range-scoped generated list (WP-14's
 * `computeShoppingList`, needs minus viable stock), grouped `CheckRow`s with
 * per-meal provenance, live-recomputed as the plan/pantry changes, and
 * in-store check-off (whole-row tap target, quantity override, writes via
 * the outbox — see `useShoppingList.ts`).
 *
 * fix-ua-integrity: this route used to also carry a desktop/tablet rail
 * answering "why is this on my list?" for exactly ONE line —
 * `uncheckedLines[0]`, alphabetically first, not whatever the user was
 * actually looking at — while `ShoppingRow.tsx` gave every row its OWN
 * "Why?" disclosure. Two affordances claiming to answer the same question,
 * one of them about an arbitrary item whose identity silently changed as
 * rows got checked off: a usability review read the rail's fixed answer as
 * if it explained whichever row's disclosure they'd just opened, which is
 * exactly how "the tinned tomatoes explanation said Tuesday" happened even
 * though the underlying day/source computation was (and is) correct — see
 * that investigation's own notes. The rail's stat block ("N items still to
 * buy") stays; the single-item "why" text is gone, and `ShoppingRow`'s own
 * disclosure now answers the FULL question for whichever line it's
 * attached to (day/source provenance, not just the rounding arithmetic it
 * used to carry alone) — one honest affordance per row instead of two
 * competing ones.
 *
 * The mock's phone screen carries a barcode-scan FAB. The scan flow itself
 * (camera, decoder, product editor) now lives at `/scan` (M6 —
 * `src/routes/scan/Scan.tsx`, DESIGN_PRODUCTS.md §1) — this button now
 * navigates there for real, replacing the earlier WP-23-era "coming soon"
 * toast placeholder.
 */
export function Shopping() {
  const { clock } = useWorkbookContext();
  const navigate = useNavigate();
  const today = clock.today();

  const [preset, setPreset] = useState<ShoppingRangePreset>("this-week");
  const [range, setRange] = useState<DateRange>(() => rangeForPreset("this-week", today));

  const shopping = useShoppingList(range);

  function handleRangeChange(nextPreset: ShoppingRangePreset, nextRange: DateRange): void {
    setPreset(nextPreset);
    setRange(nextRange);
  }

  function handleScan(): void {
    navigate("/scan");
  }

  const linesWithIngredient = useMemo<readonly LineWithIngredient[]>(() => {
    const result: LineWithIngredient[] = [];
    for (const line of shopping.lines) {
      const ingredient = shopping.ingredientsById.get(line.ingredientId);
      if (ingredient) result.push({ line, ingredient });
    }
    return result.slice().sort((a, b) => a.ingredient.name.localeCompare(b.ingredient.name));
  }, [shopping.lines, shopping.ingredientsById]);

  const uncheckedLines = useMemo(
    () => linesWithIngredient.filter((entry) => !shopping.checkedByIngredient.get(entry.ingredient.id)?.checked),
    [linesWithIngredient, shopping.checkedByIngredient],
  );

  // WP-VC3 (approved contract change — Ingredient.category): the mock
  // groups "To buy" under category subheadings ("Produce", "Dry goods", …)
  // rather than one flat list — design/mock-screens.html #shopping's
  // `.rowgroup`s. Sections stay in category order; anything with no
  // category (a hand-added ingredient, or a legacy workbook row from before
  // this column existed) lands in a trailing "Other" section — never
  // omitted, and a category with zero matching lines produces no section at
  // all (never an empty group).
  const groupedSections = useMemo(
    () => groupByCategory(linesWithIngredient, (entry) => entry.ingredient.category),
    [linesWithIngredient],
  );

  // "Left"/"still to buy" counts what's actually still to buy — a checked,
  // fully-covered line stays visible this session (see useShoppingList.ts's
  // "stickyLines" doc comment) but shouldn't inflate this count.
  const coveredCount = Math.max(0, shopping.totalNeededIngredientCount - uncheckedLines.length);
  const itemsLeft = uncheckedLines.length;

  const provenanceContext: ProvenanceContext = {
    planSlots: shopping.planSlots,
    recipes: shopping.recipes,
    recipeIngredients: shopping.recipeIngredients,
    settings: shopping.settings ?? { householdSize: 1, slotLayout: [], repeatExclusionWeeks: 3 },
  };

  return (
    <section>
      <h1>Shopping</h1>

      <p className={styles.mobileMeta} aria-live="polite">
        {itemsLeft} left
      </p>
      <p className={styles.desktopSummary} aria-live="polite">
        {formatRangeLabel(range)} · {itemsLeft} item{itemsLeft === 1 ? "" : "s"} left · {coveredCount} covered by the
        pantry
      </p>

      <div className={styles.filters}>
        <RangeChips today={today} preset={preset} range={range} onChange={handleRangeChange} />
      </div>

      {/*
        The tablet/desktop half of the scan affordance. `.fab` below is hidden
        from 768px up and this takes over there — the mock's Shopping tier
        note: "Top nav means 'Scan a barcode' becomes a page action, not a
        thumb-reach FAB — but only here." Same `handleScan`, same accessible
        name, so exactly one scan control is reachable at any width.
      */}
      <p>
        <button
          type="button"
          className={`${forms.addButton} ${styles.scanAction}`}
          onClick={handleScan}
        >
          <Barcode size={18} aria-hidden="true" />
          Scan a barcode
        </button>
      </p>

      {shopping.loading ? (
        <div className={forms.form}>
          <Skeleton />
          <Skeleton />
          <Skeleton />
        </div>
      ) : null}

      {!shopping.loading && shopping.error ? (
        <ErrorState title="Couldn't load your shopping list" description={shopping.error} onRetry={shopping.retry} />
      ) : null}

      {!shopping.loading && !shopping.error ? (
        <div className={styles.layout}>
          <div className={styles.main}>
            {linesWithIngredient.length === 0 ? (
              shopping.totalNeededIngredientCount === 0 ? (
                <EmptyState
                  icon={ShoppingCart}
                  title="Nothing planned for this range"
                  description="Plan some meals first — your list is generated from what they need, minus what's already in the pantry."
                />
              ) : (
                <EmptyState
                  icon={ShoppingCart}
                  title="Nothing left to buy"
                  description="Everything this range needs is already covered by the pantry."
                />
              )
            ) : (
              groupedSections.map((section) => (
                <ListSection key={section.heading} heading={section.heading}>
                  {section.entries.map(({ line, ingredient }) => (
                    <ShoppingRow
                      key={ingredient.id}
                      line={line}
                      ingredient={ingredient}
                      checkedItem={shopping.checkedByIngredient.get(ingredient.id)}
                      today={today}
                      failed={shopping.failedCheckoff?.ingredientId === ingredient.id}
                      provenanceContext={provenanceContext}
                      onRetryFailed={shopping.retryFlush}
                      onCheckOff={(input) => void shopping.checkOff(line, input)}
                      onUncheck={() => void shopping.uncheck(line)}
                      onAdjust={(override) => void shopping.setPurchaseOverride(line, override)}
                    />
                  ))}
                </ListSection>
              ))
            )}
          </div>

          {/* fix-ua-integrity: this rail used to also carry a single "Why
              N ingredient?" block answering for exactly one arbitrary line
              (`uncheckedLines[0]`) — see this component's own doc comment
              for why that was a real defect, not just a cosmetic one. Each
              row's own "Why?" disclosure (ShoppingRow.tsx) now answers that
              question completely for whichever line it's attached to, so
              this rail is just the at-a-glance count. */}
          <aside className={styles.rail}>
            <div className={styles.railCard}>
              <div className={styles.railStatBlock}>
                <div className={styles.railStatNumber}>{itemsLeft}</div>
                <div className={styles.railStatLabel}>items still to buy</div>
              </div>
            </div>
          </aside>
        </div>
      ) : null}

      <button type="button" className={styles.fab} aria-label="Scan a barcode" onClick={handleScan}>
        <Barcode size={22} aria-hidden="true" />
      </button>
    </section>
  );
}
