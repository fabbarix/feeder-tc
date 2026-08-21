import { useRef } from "react";
import { useButton } from "react-aria";
import { resolveTargetServings } from "../../domain/index.ts";
import type { PlanSlotId, Settings } from "../../domain/index.ts";
import { ArrowsClockwise, CookingPot, Minus, Plus, PushPin, PushPinSlash, type IconComponent } from "../../ui/icons.ts";
import { mealTagLabel } from "./plan-week.ts";
import type { PlanSlotView } from "./plan-derive.ts";
import styles from "./plan.module.css";

function IconButton({
  icon: Icon,
  label,
  onPress,
  disabled = false,
  active = false,
}: {
  readonly icon: IconComponent;
  readonly label: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
  readonly active?: boolean;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const { buttonProps } = useButton({ "aria-label": label, isDisabled: disabled, onPress }, ref);
  return (
    <button
      {...buttonProps}
      ref={ref}
      type="button"
      className={`${styles.iconButton}${active ? ` ${styles.iconButtonActive}` : ""}`}
    >
      <Icon size={15} aria-hidden="true" />
    </button>
  );
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
}

/**
 * One slot's card — shared markup for the desktop 7-column week grid and
 * the mobile stacked day-card list (parent supplies the outer `.day`/
 * `.dayCard` wrapper; this renders what goes inside it). Visually distinct
 * per state (pinned/leftover/empty/normal — UI_DESIGN.md §13), matching
 * design/mock-screens.html's Plan section.
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
          <span>{view.leftoverIngredient?.name ?? "Leftover"}</span>
          {portions !== undefined ? (
            <span className={styles.badge}>
              {portions} {portions === 1 ? "portion" : "portions"}
            </span>
          ) : null}
        </div>
      </div>
    );
  }

  // filling.kind === "recipe"
  const targetServings = resolveTargetServings(settings, slot.filling) ?? settings.householdSize;
  const isOverridden = slot.filling.scaleServings !== undefined;
  const badgeText = `${tagLabel}${slot.pinned ? " · pinned" : ""}${view.isToday ? " · tonight" : ""}`;

  // Past "planned" (cooked/skipped): a read-only card, no actions. WP-13's
  // own generator already refuses to touch a non-"planned" slot when
  // regenerating (generator.ts's header comment) — rerolling one from here
  // would silently rewrite history the same way, so the controls simply
  // aren't offered once a slot has moved past "planned".
  if (slot.state !== "planned") {
    return (
      <div className={styles.slot}>
        <span className={styles.slotTag}>{badgeText}</span>
        <div className={styles.slotBody}>
          <span>{view.recipe?.name ?? "Unknown recipe"}</span>
          <span className={styles.badge}>{slot.state === "cooked" ? "Cooked" : "Skipped"}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`${styles.slot}${slot.pinned ? ` ${styles.slotPinned}` : ""}`}>
      <span className={styles.slotTag}>{badgeText}</span>
      <div className={styles.slotBody}>
        <button
          type="button"
          className={styles.slotNameButton}
          onClick={() => onOpenPicker(slot.id)}
        >
          {view.recipe?.name ?? "Unknown recipe"}
        </button>
        <div className={styles.slotActions}>
          {isOverridden ? (
            <span className={styles.scaleBadge}>
              {targetServings} servings
            </span>
          ) : null}
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
        </div>
      </div>
    </div>
  );
}
