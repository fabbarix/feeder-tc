import { useState } from "react";
import { ConfirmDialog } from "../../ui/components";
import { ArrowDown, ArrowUp, Trash } from "../../ui/icons.ts";
import type { MealType } from "../../domain/index.ts";
import { Stepper } from "../Stepper.tsx";
import { TextField } from "../fields.tsx";
import forms from "../forms.module.css";
import styles from "./settings.module.css";

export interface MealTypeUsage {
  readonly recipes: number;
  readonly upcomingMeals: number;
}

export interface MealTypeDialogProps {
  /** `undefined` adds a new meal type; a type edits that one. */
  readonly editing: MealType | undefined;
  readonly householdSize: number;
  /** Position in the list, for the move buttons (edit only). */
  readonly position?: { readonly index: number; readonly count: number };
  readonly onSave: (fields: { readonly name: string; readonly servings: number | undefined }) => void;
  readonly onMove?: (direction: -1 | 1) => void;
  /** Counts what still uses the type — removal is refused while anything does. */
  readonly usage?: () => Promise<MealTypeUsage>;
  readonly onRemove?: () => void;
  readonly onClose: () => void;
}

/**
 * Add or edit one meal type (custom meal types, 2026-10-10): its name, and
 * whether it's scaled to the household or to its own serving count (a cat's
 * breakfast serves 1). Editing also moves it up/down the list and removes
 * it — refused, with the reason, while recipes or upcoming meals still use
 * it, so removing a type never strands a recipe or a planned meal.
 */
export function MealTypeDialog({
  editing,
  householdSize,
  position,
  onSave,
  onMove,
  usage,
  onRemove,
  onClose,
}: MealTypeDialogProps) {
  const [name, setName] = useState(editing?.name ?? "");
  const [ownServings, setOwnServings] = useState(editing?.servings !== undefined);
  const [servings, setServings] = useState(editing?.servings ?? 1);
  const [nameError, setNameError] = useState(false);
  const [removal, setRemoval] = useState<"idle" | "checking" | "confirm" | { readonly blocked: string }>("idle");

  function save(): void {
    const trimmed = name.trim();
    if (trimmed === "") {
      setNameError(true);
      return;
    }
    onSave({ name: trimmed, servings: ownServings ? servings : undefined });
  }

  async function startRemove(): Promise<void> {
    if (!usage) return;
    setRemoval("checking");
    try {
      const { recipes, upcomingMeals } = await usage();
      if (recipes === 0 && upcomingMeals === 0) {
        setRemoval("confirm");
        return;
      }
      const parts = [
        recipes > 0 ? `${recipes} recipe${recipes === 1 ? " is" : "s are"} tagged with it` : undefined,
        upcomingMeals > 0 ? `${upcomingMeals} upcoming meal${upcomingMeals === 1 ? " is" : "s are"} planned for it` : undefined,
      ].filter((part): part is string => part !== undefined);
      setRemoval({
        blocked: `Can't remove it yet: ${parts.join(" and ")}. Untag those recipes and clear those meals first.`,
      });
    } catch {
      setRemoval({ blocked: "Couldn't check what uses this meal type. Please try again." });
    }
  }

  if (removal === "confirm" && editing) {
    return (
      <ConfirmDialog
        open
        title={`Remove ${editing.name}?`}
        description="It comes off every day of your meal layout. Meals already cooked keep their history."
        confirmLabel="Remove"
        cancelLabel="Keep it"
        destructive
        onConfirm={() => onRemove?.()}
        onCancel={() => setRemoval("idle")}
      />
    );
  }

  return (
    <ConfirmDialog
      open
      title={editing ? `Edit ${editing.name}` : "Add a meal type"}
      confirmLabel={editing ? "Save" : "Add"}
      onConfirm={save}
      onCancel={onClose}
      description={
        <div className={styles.dialogForm}>
          <TextField
            label="Name"
            value={name}
            onChange={(value) => {
              setName(value);
              setNameError(false);
            }}
            placeholder="e.g. Cat's breakfast"
          />
          {nameError ? <p className={styles.dialogError}>Give it a name.</p> : null}
          <div className={forms.checkboxField}>
            <label>
              <input
                type="checkbox"
                checked={!ownServings}
                onChange={(event) => setOwnServings(!event.target.checked)}
              />
              Feeds the household ({householdSize} {householdSize === 1 ? "person" : "people"})
            </label>
            <p className={forms.hint}>Turn off for a meal with its own size, like a pet&rsquo;s.</p>
          </div>
          {ownServings ? (
            <Stepper
              layout="row"
              label="Servings"
              unit="servings"
              unitOne="serving"
              min={1}
              value={servings}
              onChange={setServings}
            />
          ) : null}
          {editing && position && onMove ? (
            <div className={styles.dialogActions}>
              <button
                type="button"
                className={forms.cancelButton}
                disabled={position.index === 0}
                onClick={() => onMove(-1)}
              >
                <ArrowUp size={16} aria-hidden="true" /> Move up
              </button>
              <button
                type="button"
                className={forms.cancelButton}
                disabled={position.index === position.count - 1}
                onClick={() => onMove(1)}
              >
                <ArrowDown size={16} aria-hidden="true" /> Move down
              </button>
            </div>
          ) : null}
          {editing && usage && onRemove ? (
            <div className={styles.dialogRemove}>
              <button
                type="button"
                className={`${forms.cancelButton} ${styles.removeButton}`}
                disabled={removal === "checking"}
                onClick={() => void startRemove()}
              >
                <Trash size={16} aria-hidden="true" /> {removal === "checking" ? "Checking…" : "Remove this meal type"}
              </button>
              {typeof removal === "object" ? (
                <p className={styles.dialogError} role="alert">
                  {removal.blocked}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      }
    />
  );
}
