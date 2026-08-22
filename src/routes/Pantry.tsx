import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useWorkbookContext } from "../workbook-context.ts";
import {
  EmptyState,
  ErrorState,
  FreshnessMeter,
  ListRow,
  ListSection,
  SegmentedControl,
  Skeleton,
  ToggleChips,
} from "../ui/components";
import { PhotoMedia } from "../ui/photo/index.ts";
import { CaretRight, Package, Plus, Snowflake } from "../ui/icons";
import { daysBetween, formatQuantity } from "../domain/index.ts";
import type { StorageLocation } from "../domain/index.ts";
import { getPhotoDataUrl } from "../photos/index.ts";
import { usePantryInventory } from "./pantry/usePantryInventory.ts";
import { AddLotForm, UseSomeForm } from "./pantry/PantryForms.tsx";
import { aggregateByIngredient, type PantryAggregate } from "./pantry/pantry-aggregate.ts";
import { expiryBadge, expiryTone } from "./pantry/pantry-format.ts";
import { EXPIRING_SOON_DAYS, locationLabel, LOCATION_OPTIONS } from "./pantry/pantry-options.ts";
import { weekdayLabel } from "./date-format.ts";
import styles from "./pantry/pantry.module.css";
import forms from "./forms.module.css";

type ActiveForm = "add" | "use" | null;
type LocationFilter = "all" | StorageLocation;
type ShowFilter = "expiring" | "opened" | "leftovers";
type PantrySection = "stock" | "leftovers";

const LOCATION_FILTER_OPTIONS: readonly { value: LocationFilter; label: string }[] = [
  { value: "all", label: "All" },
  ...LOCATION_OPTIONS,
];

const SHOW_FILTER_OPTIONS: readonly { value: ShowFilter; label: string }[] = [
  { value: "expiring", label: "Expiring" },
  { value: "opened", label: "Opened" },
  { value: "leftovers", label: "Leftovers" },
];

// Phone-only "Stock"/"Leftovers" tab (design/mock-responsive.html #pantry
// phone tier's `.seg`) and its matching "Show" subset — see the `.phoneFilters`
// block in Pantry() for why these exist as a second surface rather than a
// rename of the rail's own controls.
const SECTION_OPTIONS: readonly { value: PantrySection; label: string }[] = [
  { value: "stock", label: "Stock" },
  { value: "leftovers", label: "Leftovers" },
];

const PHONE_SHOW_FILTER_OPTIONS = SHOW_FILTER_OPTIONS.filter((option) => option.value !== "leftovers");

const TONE_CLASS: Record<"ok" | "warn" | "crit", string | undefined> = {
  ok: styles.expiryText,
  warn: styles.expiryWarn,
  crit: styles.expiryCrit,
};

/** "Pantry · 1000 g · 2 lots, FIFO" / "Fridge · 500 ml · opened Tuesday" / "Freezer · 750 g" — the aggregated row's one-line summary (design/mock-screens.html #pantry). */
function aggregateSubtitle(aggregate: PantryAggregate): string {
  const location = locationLabel(aggregate.soonestLot.location);
  const quantity = formatQuantity({
    amount: aggregate.totalAmount,
    unit: aggregate.ingredient.unit,
  });
  if (aggregate.lotCount > 1) return `${location} · ${quantity} · ${aggregate.lotCount} lots, FIFO`;
  const onlyLot = aggregate.lots[0];
  if (onlyLot?.openedAt)
    return `${location} · ${quantity} · opened ${weekdayLabel(onlyLot.openedAt)}`;
  return `${location} · ${quantity}`;
}

/**
 * Pantry view (WP-21, restructured WP-VC4). The mock shows ONE ROW PER
 * INGREDIENT — total quantity, lot count, soonest expiry — not one row per
 * lot: the old version did `group.lots.map(renderRow)`, so two lots of the
 * same product produced two near-identical rows, each carrying its own
 * four action buttons (Open/Move/Spoil/Correct) inline. Those buttons now
 * live on the pantry-item detail route (`PantryItem.tsx`,
 * `/pantry/:ingredientId`) this row links to; this page keeps only the
 * ingredient-level actions (add stock, record FIFO usage) and its own
 * "Expiring soon" grouping (real and useful — UI_DESIGN.md §13 "group by
 * urgency first").
 */
export function Pantry() {
  const { store, clock } = useWorkbookContext();
  const pantry = usePantryInventory();
  const [activeForm, setActiveForm] = useState<ActiveForm>(null);
  const [locationFilter, setLocationFilter] = useState<LocationFilter>("all");
  const [showFilters, setShowFilters] = useState<readonly ShowFilter[]>([]);

  const today = clock.today();

  const aggregates = useMemo(
    () => aggregateByIngredient(pantry.ingredientsById, pantry.lots),
    [pantry.ingredientsById, pantry.lots],
  );

  const ingredientsWithStock = useMemo(() => aggregates.map((a) => a.ingredient), [aggregates]);

  // Phone's "Stock"/"Leftovers" tab (see `.phoneFilters` below) is a second
  // control surface over the SAME `showFilters` state the rail's "Show"
  // ToggleChips already write to — not a new filter dimension. Selecting
  // "Leftovers" here is exactly selecting the rail's "Leftovers" chip;
  // there is one source of truth either way.
  const pantrySection: PantrySection = showFilters.includes("leftovers") ? "leftovers" : "stock";

  function handleSectionChange(next: PantrySection): void {
    setShowFilters((current) =>
      next === "leftovers"
        ? current.includes("leftovers")
          ? current
          : [...current, "leftovers"]
        : current.filter((filter) => filter !== "leftovers"),
    );
  }

  // The phone "Show" row omits "Leftovers" (that's the tab above now), so its
  // onChange must preserve whatever the "leftovers" flag currently is rather
  // than overwrite it with a value that can never include it.
  function handlePhoneShowFilterChange(next: readonly ShowFilter[]): void {
    setShowFilters((current) => (current.includes("leftovers") ? [...next, "leftovers"] : next));
  }

  // FILTERS rail (design/mock-screens.html #pantry desktop card: "Location"
  // segmented control + "Show" chips) — replaces the old "At a glance"
  // count-only rail, which the mock never showed at all.
  const filtered = useMemo(
    () =>
      aggregates.filter((aggregate) => {
        if (locationFilter !== "all" && aggregate.soonestLot.location !== locationFilter)
          return false;
        if (
          showFilters.includes("expiring") &&
          daysBetween(today, aggregate.soonestLot.expiry) > EXPIRING_SOON_DAYS
        )
          return false;
        if (showFilters.includes("opened") && aggregate.soonestLot.openedAt === undefined)
          return false;
        if (showFilters.includes("leftovers") && aggregate.ingredient.unit !== "portion")
          return false;
        return true;
      }),
    [aggregates, locationFilter, showFilters, today],
  );

  const expiring = useMemo(
    () =>
      filtered
        .filter(
          (aggregate) =>
            aggregate.soonestLot.location !== "freezer" &&
            daysBetween(today, aggregate.soonestLot.expiry) <= EXPIRING_SOON_DAYS,
        )
        .sort(
          (a, b) =>
            daysBetween(today, a.soonestLot.expiry) - daysBetween(today, b.soonestLot.expiry),
        ),
    [filtered, today],
  );
  const expiringIds = useMemo(() => new Set(expiring.map((a) => a.ingredient.id)), [expiring]);

  const fresh = useMemo(
    () =>
      filtered
        .filter((aggregate) => !expiringIds.has(aggregate.ingredient.id))
        .sort((a, b) => a.ingredient.name.localeCompare(b.ingredient.name)),
    [filtered, expiringIds],
  );

  function renderRow(aggregate: PantryAggregate) {
    const { ingredient, soonestLot } = aggregate;
    const frozen = soonestLot.location === "freezer";
    const daysLeft = daysBetween(today, soonestLot.expiry);
    const badge = expiryBadge(daysLeft, soonestLot.expiry);

    const reference = soonestLot.openedAt ?? soonestLot.purchaseDate;
    const totalDays = Math.max(1, daysBetween(reference, soonestLot.expiry));
    const fraction = daysLeft / totalDays;

    return (
      <Link key={ingredient.id} to={`/pantry/${ingredient.id}`} className={styles.aggregateLink}>
        <ListRow
          leading={
            <PhotoMedia
              kind="ingredient"
              hasPhoto={ingredient.hasPhoto}
              size="list"
              fetchPhoto={() => getPhotoDataUrl(store, "ingredient", ingredient.id)}
              alt={ingredient.name}
            />
          }
          primary={ingredient.name}
          secondary={
            <div className={styles.lotDetail}>
              <span>{aggregateSubtitle(aggregate)}</span>
              {frozen ? (
                <span className={styles.frozenBadge}>
                  <Snowflake size={14} aria-hidden="true" />
                  Frozen — expiry paused
                </span>
              ) : (
                <>
                  <span className={TONE_CLASS[expiryTone(daysLeft)]}>{badge.label}</span>
                  <div className={styles.meter}>
                    <FreshnessMeter
                      fractionRemaining={fraction}
                      label={
                        daysLeft >= 0 ? `${daysLeft} of ${totalDays} days remaining` : "Expired"
                      }
                    />
                  </div>
                </>
              )}
            </div>
          }
          trailing={<CaretRight size={18} aria-hidden="true" />}
        />
      </Link>
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
        <ErrorState
          title="Couldn't load your pantry"
          description={pantry.error}
          onRetry={pantry.retry}
        />
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
            {aggregates.length > 0 && activeForm === null ? (
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

            {aggregates.length === 0 && activeForm === null ? (
              <EmptyState
                icon={Package}
                title="Your pantry is empty"
                description="Add what's already in your kitchen to start tracking quantities and expiry."
                action={
                  <button
                    type="button"
                    className={forms.addButton}
                    onClick={() => setActiveForm("add")}
                  >
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
                {fresh.length > 0 ? (
                  <ListSection heading="Fresh">{fresh.map(renderRow)}</ListSection>
                ) : null}
                {filtered.length === 0 && aggregates.length > 0 ? (
                  <EmptyState
                    icon={Package}
                    title="Nothing matches these filters"
                    description="Try a different location or clear the show filters."
                  />
                ) : null}
              </>
            )}
          </div>

          {/* Phone's replacement for the rail below, which is `display:
              none` below 768px with nothing else taking its place — the
              reachability bug this block fixes (owner-reported: on a phone
              there was no way to filter by location, filter by
              Expiring/Opened, or reach Leftovers at all).
              design/mock-responsive.html #pantry's phone tier: a "Stock" /
              "Leftovers" segmented tab above a horizontal filter row, no
              rail. Kept AFTER `.main` in DOM (same position `.rail` already
              occupies) purely so the add-lot form's own "Location"
              radiogroup — rendered inside `.main` — still resolves first for
              `.first()` queries (wp-21-pantry-management.spec.ts); `order:
              -1` in pantry.module.css puts it above `.main` visually. Same
              "exactly one surface reachable" invariant as
              shopping.module.css's `.fab`/`.scanAction`: this and `.rail`
              are exact mirror-image media queries. */}
          <div className={styles.phoneFilters}>
            <div className={forms.fullWidthControl}>
              <SegmentedControl<PantrySection>
                aria-label="Pantry section"
                options={SECTION_OPTIONS}
                value={pantrySection}
                onChange={handleSectionChange}
              />
            </div>
            <div className={forms.fullWidthControl}>
              <SegmentedControl<LocationFilter>
                aria-label="Location"
                options={LOCATION_FILTER_OPTIONS}
                value={locationFilter}
                onChange={setLocationFilter}
              />
            </div>
            <ToggleChips<ShowFilter>
              aria-label="Show"
              options={PHONE_SHOW_FILTER_OPTIONS}
              value={showFilters.filter((filter) => filter !== "leftovers")}
              onChange={handlePhoneShowFilterChange}
            />
          </div>

          {/* FILTERS rail (design/mock-screens.html #pantry desktop card) —
              replaces the old "At a glance" count-only rail, which the mock
              never showed. */}
          <aside className={styles.rail}>
            <div className={styles.railCard}>
              <p className={styles.railTitle}>Filters</p>
              <div className={forms.field}>
                <span className={forms.fieldLabel}>Location</span>
                <div className={forms.fullWidthControl}>
                  {/* `wraps`: this is the 250px desktop rail (pantry.module.css
                      `.rail`) — the exact control that motivated the `auto-fit`
                      grid fix in the first place. 4 segments at ≥72px each need
                      ≥298px including gaps/padding, more than the rail leaves
                      after `.railCard`'s own padding, so this one measurably
                      wraps onto two rows and drops the pill accordingly
                      (SegmentedControl.module.css's `.group.wrap`). */}
                  <SegmentedControl<LocationFilter>
                    aria-label="Location"
                    options={LOCATION_FILTER_OPTIONS}
                    value={locationFilter}
                    onChange={setLocationFilter}
                    wraps
                  />
                </div>
              </div>
              <div className={forms.field}>
                <span className={forms.fieldLabel}>Show</span>
                <ToggleChips<ShowFilter>
                  aria-label="Show"
                  options={SHOW_FILTER_OPTIONS}
                  value={showFilters}
                  onChange={setShowFilters}
                />
              </div>
            </div>
          </aside>
        </div>
      ) : null}
    </section>
  );
}
