import { useRef } from "react";
import { useButton } from "react-aria";
import { resolveTargetServings } from "../../domain/index.ts";
import type { PlanSlotId, Settings } from "../../domain/index.ts";
import { ArrowsClockwise, CookingPot, Minus, Plus, PushPin, PushPinSlash, Trash, type IconComponent } from "../../ui/icons.ts";
import { mealTagLabel } from "./plan-week.ts";
import { computeIndivisibleForecast, type PlanSlotView } from "./plan-derive.ts";
import styles from "./plan.module.css";

function IconButton({
  icon: Icon,
  label,
  onPress,
  disabled = false,
  active = false,
  danger = false,
  pushRight = false,
}: {
  readonly icon: IconComponent;
  readonly label: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
  readonly active?: boolean;
  readonly danger?: boolean;
  readonly pushRight?: boolean;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const { buttonProps } = useButton({ "aria-label": label, isDisabled: disabled, onPress }, ref);
  return (
    <button
      {...buttonProps}
      ref={ref}
      type="button"
      className={`${styles.iconButton}${active ? ` ${styles.iconButtonActive}` : ""}${danger ? ` ${styles.iconButtonDanger}` : ""}${pushRight ? ` ${styles.iconButtonPushRight}` : ""}`}
    >
      <Icon size={15} aria-hidden="true" />
    </button>
  );
}

/**
 * "Remove from plan" (design/mock-responsive.html — every filled slot,
 * including past/leftover ones). Same generic, non-recipe-specific
 * aria-label as `Reroll`/`Pin` above, deliberately — one label reachable
 * per day card via a day-scoped locator, matching how this file's other
 * icon actions already work. `Plan.tsx` owns the actual removal (it opens
 * the two-variant confirm dialog first — never fires on a bare click).
 */
function RemoveButton({ onPress, disabled }: { readonly onPress: () => void; readonly disabled: boolean }) {
  return <IconButton icon={Trash} label="Remove from plan" onPress={onPress} disabled={disabled} danger pushRight />;
}

export interface PlanSlotRowProps {
  readonly view: PlanSlotView;
  readonly settings: Settings;
  readonly isBusy: boolean;
  readonly onReroll: (slotId: PlanSlotId) => void;
  readonly onTogglePin: (slotId: PlanSlotId) => void;
  readonly onCook: (slotId: PlanSlotId) => void;
  readonly onOpenPicker: (slotId: PlanSlotId) => void;
  readonly onScaleChange: (slotId: PlanSlotId, servings: number | undefined) => void;
  /** Opens the remove confirm (Plan.tsx) — never called for an empty slot, which has nothing to remove. */
  readonly onRemove: (slotId: PlanSlotId) => void;
}

/**
 * One slot's card — shared markup for the desktop 7-column week grid and
 * the mobile stacked day-card list (parent supplies the outer `.day`/
 * `.dayCard` wrapper; this renders what goes inside it). Visually distinct
 * per state (pinned/leftover/empty/normal — UI_DESIGN.md §13), matching
 * design/mock-responsive.html's Plan section.
 *
 * Every filled variant below (leftover, past/read-only, planned-recipe)
 * splits its body into `.slotRow1` (name + whatever quantity info that slot
 * has — a servings stepper, a leftover-forecast badge, or a status badge)
 * and `.slotRow2` (buttons). `plan.module.css` lays those two out side by
 * side on one line at tablet/desktop and stacked on phone — "two-line
 * mobile slot" (mock, § owner request) without forking this markup in two.
 */
export function PlanSlotRow({
  view,
  settings,
  isBusy,
  onReroll,
  onTogglePin,
  onCook,
  onOpenPicker,
  onScaleChange,
  onRemove,
}: PlanSlotRowProps) {
  const { slot } = view;
  const tagLabel = mealTagLabel(slot.slotType);

  if (slot.filling.kind === "empty") {
    return (
      <button
        type="button"
        className={`${styles.slot} ${styles.slotAdd}`}
        onClick={() => onOpenPicker(slot.id)}
        aria-label={`Pick a meal for ${tagLabel}`}
      >
        <span className={styles.slotTag}>{tagLabel}</span>
        <span className={styles.addLabel}>
          <Plus size={16} aria-hidden="true" />
          Pick a meal
        </span>
      </button>
    );
  }

  if (slot.filling.kind === "leftover") {
    const portions = view.leftoverLot?.quantity.amount;
    return (
      <div className={`${styles.slot} ${styles.slotLeftover}`}>
        <span className={styles.slotTag}>{tagLabel} · leftover</span>
        <div className={styles.slotBody}>
          <div className={styles.slotRow1}>
            <span>{view.leftoverIngredient?.name ?? "Leftover"}</span>
            {portions !== undefined ? (
              <span className={styles.badge}>
                {portions} {portions === 1 ? "portion" : "portions"}
              </span>
            ) : null}
          </div>
          <div className={styles.slotRow2}>
            <RemoveButton onPress={() => onRemove(slot.id)} disabled={isBusy} />
          </div>
        </div>
      </div>
    );
  }

  // WP-leftover-planning: a leftover the planner expects but hasn't cooked
  // yet. Reads as contingent (a plain "not made yet" instead of the ordinary
  // leftover badge) rather than a real, ready-to-eat portion count — and, if
  // whatever it depended on changed, says so plainly instead of quietly
  // pointing at food that was never made (no "projected"/"provisional"
  // jargon on screen, per the work order).
  if (slot.filling.kind === "leftover-projected") {
    const name = view.projectedRecipe ? `Leftover: ${view.projectedRecipe.name}` : "Leftover";
    return (
      <div className={`${styles.slot} ${styles.slotLeftover}`}>
        <span className={styles.slotTag}>{tagLabel} · leftover</span>
        <div className={styles.slotBody}>
          <div className={styles.slotRow1}>
            <span>{name}</span>
            <span className={`${styles.badge}${view.projectedBroken ? ` ${styles.badgeWarn}` : ""}`}>
              {view.projectedBroken ? "May not happen now" : "Not made yet"}
            </span>
          </div>
          <div className={styles.slotRow2}>
            <RemoveButton onPress={() => onRemove(slot.id)} disabled={isBusy} />
          </div>
        </div>
      </div>
    );
  }

  // filling.kind === "recipe"
  const targetServings = resolveTargetServings(settings, slot.filling) ?? settings.householdSize;
  const isOverridden = slot.filling.scaleServings !== undefined;
  const badgeText = `${tagLabel}${slot.pinned ? " · pinned" : ""}${view.isToday ? " · tonight" : ""}`;
  // WP-PURCHASING (DESIGN_PURCHASING.md §4/§6 last bullet): an indivisible
  // recipe (a bought meal, or `indivisible: true`) can't take a per-serving
  // stepper — there's no such thing as 2.3 lasagnas — so it shows the
  // leftover forecast instead, matching the mock's Friday "Store lasagna"
  // slot ("→ 2 leftover") in place of the +/- servings control.
  const forecast = computeIndivisibleForecast(view.recipe, targetServings);

  // Past "planned" (cooked/skipped): a read-only card, no reroll/pin/Cook —
  // WP-13's own generator already refuses to touch a non-"planned" slot
  // when regenerating (generator.ts's header comment) — rerolling one from
  // here would silently rewrite history the same way. It still gets
  // Remove: "the user commits forever" otherwise (design mock) — removing
  // it corrects the plan without touching the InventoryEvents already
  // recorded for it (Plan.tsx's confirm copy says so explicitly).
  if (slot.state !== "planned") {
    return (
      <div className={styles.slot}>
        <span className={styles.slotTag}>{badgeText}</span>
        <div className={styles.slotBody}>
          <div className={styles.slotRow1}>
            <span>{view.recipe?.name ?? "Unknown recipe"}</span>
            <span className={styles.badge}>{slot.state === "cooked" ? "Cooked" : "Skipped"}</span>
          </div>
          <div className={styles.slotRow2}>
            <RemoveButton onPress={() => onRemove(slot.id)} disabled={isBusy} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`${styles.slot}${slot.pinned ? ` ${styles.slotPinned}` : ""}`}>
      <span className={styles.slotTag}>{badgeText}</span>
      <div className={styles.slotBody}>
        <div className={styles.slotRow1}>
          <button
            type="button"
            className={styles.slotNameButton}
            // The name is clamped to two lines at narrow widths, so expose
            // the full text here — otherwise two similarly-named recipes
            // become indistinguishable once clipped.
            title={view.recipe?.name ?? "Unknown recipe"}
            onClick={() => onOpenPicker(slot.id)}
          >
            {view.recipe?.name ?? "Unknown recipe"}
          </button>
          {forecast ? (
            forecast.surplusServings > 0 ? <span className={styles.scaleBadge}>→ {forecast.surplusServings} leftover</span> : null
          ) : (
            <div className={styles.stepper}>
              {/* Always show the count. It used to render only when the
                  servings were overridden, so at the household default the
                  control was a bare "−  +" with no number between them — you
                  could not see what you were about to change. Overridden
                  still stands out, via `.scaleBadgeOverridden`. */}
              <span
                className={`${styles.scaleBadge} ${isOverridden ? styles.scaleBadgeOverridden : ""}`}
              >
                {targetServings} {targetServings === 1 ? "serving" : "servings"}
              </span>
              <IconButton
                icon={Minus}
                label={`Fewer servings for ${view.recipe?.name ?? tagLabel}`}
                disabled={isBusy || targetServings <= 1}
                onPress={() => onScaleChange(slot.id, Math.max(1, targetServings - 1))}
              />
              <IconButton
                icon={Plus}
                label={`More servings for ${view.recipe?.name ?? tagLabel}`}
                disabled={isBusy}
                onPress={() => onScaleChange(slot.id, targetServings + 1)}
              />
            </div>
          )}
        </div>
        <div className={styles.slotRow2}>
          {/* Cook is offered on any still-planned recipe slot, not gated to
              "today" — a household marks meals cooked after the fact too
              (e.g. logging yesterday's dinner). "tonight" in the tag line
              above is the only date-specific affordance from the mock;
              this button itself is always available once there's a recipe
              to cook. */}
          <button type="button" className={styles.cookButton} onClick={() => onCook(slot.id)} disabled={isBusy}>
            <CookingPot size={15} aria-hidden="true" />
            Cook
          </button>
          <IconButton icon={ArrowsClockwise} label="Reroll" disabled={isBusy || slot.pinned} onPress={() => onReroll(slot.id)} />
          <IconButton
            icon={slot.pinned ? PushPinSlash : PushPin}
            label={slot.pinned ? "Unpin" : "Pin"}
            active={slot.pinned}
            disabled={isBusy}
            onPress={() => onTogglePin(slot.id)}
          />
          <RemoveButton onPress={() => onRemove(slot.id)} disabled={isBusy} />
        </div>
      </div>
    </div>
  );
}
