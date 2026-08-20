import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useWorkbookContext } from "../workbook-context.ts";
import { useToast } from "../ui/components/Toast/useToast.ts";
import { ErrorState, QuantityInput, SegmentedControl, SelectSheet, Skeleton, ToggleChips } from "../ui/components";
import { CookingPot, Minus, Plus, Trash } from "../ui/icons";
import {
  makeIngredientId,
  makeQuantity,
  makeRecipeId,
  newRecipeId,
  type Ingredient,
  type IngredientId,
  type MealTag,
  type PlanSlot,
  type Recipe,
  type RecipeIngredient,
  type RecipeKind,
  type RecipeStatus,
  type RecipeStep,
} from "../domain/index.ts";
import { IntegerField, TextField } from "./fields.tsx";
import { KIND_OPTIONS, MEAL_TAG_OPTIONS, STATUS_OPTIONS } from "./recipe-options.ts";
import { uniqueSlug } from "./slug.ts";
import styles from "./forms.module.css";

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

interface LineDraft {
  readonly key: string;
  readonly ingredientId: IngredientId | null;
  readonly amount: number | null;
}

/** Create/edit a recipe — cooked or bought (WP-20). Bought recipes force prepMinutes to 0 and link a single "piece" catalog ingredient for the product itself (DESIGN.md §2 "Recipes"). */
export function RecipeEditor() {
  const { recipeId } = useParams();
  const navigate = useNavigate();
  const { store, rng } = useWorkbookContext();
  const { showToast } = useToast();
  const isNew = recipeId === undefined;
  const lineKeyCounter = useRef(0);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  const [ingredientsCatalog, setIngredientsCatalog] = useState<readonly Ingredient[]>([]);
  const [linkedIngredientId, setLinkedIngredientId] = useState<IngredientId | undefined>(undefined);
  const [cookedHistory, setCookedHistory] = useState<readonly PlanSlot[]>([]);

  const [name, setName] = useState("");
  const [kind, setKind] = useState<RecipeKind>("cooked");
  const [status, setStatus] = useState<RecipeStatus>("in-rotation");
  const [baseServings, setBaseServings] = useState<number | null>(4);
  const [prepMinutes, setPrepMinutes] = useState<number | null>(15);
  const [cookMinutes, setCookMinutes] = useState<number | null>(30);
  const [mealTags, setMealTags] = useState<readonly MealTag[]>([]);
  const [lines, setLines] = useState<readonly LineDraft[]>([]);
  const [steps, setSteps] = useState<readonly string[]>([""]);

  useEffect(() => {
    // `loading`/`error` are only ever set from the promise's own
    // resolution below, never synchronously here (react-hooks'
    // set-state-in-effect rule) — their initial `useState` values already
    // cover the first mount.
    let cancelled = false;
    Promise.all([
      store.ingredients.readAll(),
      store.recipes.readAll(),
      store.recipeIngredients.readAll(),
      store.recipeSteps.readAll(),
      store.planSlots.readAll(),
    ])
      .then(([ingredientsResult, recipesResult, linesResult, stepsResult, slotsResult]) => {
        if (cancelled) return;
        setIngredientsCatalog([...ingredientsResult.rows].sort((a, b) => a.name.localeCompare(b.name)));

        if (!isNew) {
          const found = recipesResult.rows.find((r) => r.id === recipeId);
          if (!found) {
            setError(`No recipe with id "${recipeId}".`);
            return;
          }
          setName(found.name);
          setKind(found.kind);
          setStatus(found.status);
          setBaseServings(found.baseServings);
          setPrepMinutes(found.prepMinutes);
          setCookMinutes(found.cookMinutes);
          setMealTags(found.mealTags);

          const ownLines = linesResult.rows.filter((l) => l.recipeId === recipeId);
          if (found.kind === "bought") {
            setLinkedIngredientId(ownLines[0]?.ingredientId);
          } else {
            setLines(
              ownLines.map((l) => ({
                key: `existing-${(lineKeyCounter.current += 1)}`,
                ingredientId: l.ingredientId,
                amount: l.quantity.amount,
              })),
            );
          }

          const ownSteps = [...stepsResult.rows]
            .filter((s) => s.recipeId === recipeId)
            .sort((a, b) => a.stepNumber - b.stepNumber);
          setSteps(ownSteps.length > 0 ? ownSteps.map((s) => s.text) : [""]);

          const history = slotsResult.rows
            .filter((s) => s.state === "cooked" && s.filling.kind === "recipe" && s.filling.recipeId === recipeId)
            .slice()
            .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
          setCookedHistory(history);
        }

        const warningCount =
          ingredientsResult.warnings.length +
          recipesResult.warnings.length +
          linesResult.warnings.length +
          stepsResult.warnings.length;
        if (warningCount > 0) {
          showToast({
            variant: "warning",
            title: `${warningCount} row${warningCount === 1 ? "" : "s"} skipped while loading`,
            description: "Some workbook rows didn't match the expected shape.",
          });
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(messageOf(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [store, recipeId, isNew, showToast]);

  const ingredientOptions = ingredientsCatalog.map((i) => ({ value: i.id, label: i.name }));

  function addLine(): void {
    lineKeyCounter.current += 1;
    setLines((current) => [...current, { key: `new-${lineKeyCounter.current}`, ingredientId: null, amount: null }]);
  }

  function removeLine(key: string): void {
    setLines((current) => current.filter((l) => l.key !== key));
  }

  function setLineIngredient(key: string, ingredientId: IngredientId): void {
    setLines((current) => current.map((l) => (l.key === key ? { ...l, ingredientId, amount: null } : l)));
  }

  function setLineAmount(key: string, amount: number | null): void {
    setLines((current) => current.map((l) => (l.key === key ? { ...l, amount } : l)));
  }

  function addStep(): void {
    setSteps((current) => [...current, ""]);
  }

  function updateStep(index: number, text: string): void {
    setSteps((current) => current.map((s, i) => (i === index ? text : s)));
  }

  function removeStep(index: number): void {
    setSteps((current) => current.filter((_, i) => i !== index));
  }

  async function handleSave(): Promise<void> {
    if (name.trim() === "" || baseServings === null || baseServings <= 0 || cookMinutes === null) {
      showToast({ variant: "warning", title: "Fill in a name, servings and cook time before saving." });
      return;
    }
    if (kind === "cooked" && lines.some((l) => l.ingredientId === null || l.amount === null || l.amount <= 0)) {
      showToast({ variant: "warning", title: "Every ingredient line needs an ingredient and a positive amount." });
      return;
    }

    setSaving(true);
    try {
      const id = isNew ? newRecipeId(rng) : makeRecipeId(recipeId!);
      const finalPrepMinutes = kind === "bought" ? 0 : (prepMinutes ?? 0);
      const recipe: Recipe = {
        id,
        name: name.trim(),
        kind,
        baseServings,
        prepMinutes: finalPrepMinutes,
        cookMinutes,
        mealTags,
        status,
      };

      let recipeLines: readonly RecipeIngredient[];
      if (kind === "bought") {
        const existingIngredientIds = new Set(ingredientsCatalog.map((i) => i.id));
        const productId = linkedIngredientId ?? makeIngredientId(uniqueSlug(recipe.name, existingIngredientIds, rng));
        const existingProduct = ingredientsCatalog.find((i) => i.id === productId);
        const productIngredient: Ingredient = {
          id: productId,
          name: recipe.name,
          unit: "piece",
          shelfLifeDays: existingProduct?.shelfLifeDays ?? 180,
          openedShelfLifeDays: existingProduct?.openedShelfLifeDays ?? 5,
          defaultLocation: existingProduct?.defaultLocation ?? "freezer",
        };
        await store.ingredients.upsert(productIngredient);
        setLinkedIngredientId(productId);
        recipeLines = [{ recipeId: id, ingredientId: productId, quantity: makeQuantity(1, "piece") }];
      } else {
        recipeLines = lines
          .filter(
            (l): l is LineDraft & { ingredientId: IngredientId; amount: number } =>
              l.ingredientId !== null && l.amount !== null,
          )
          .map((l) => {
            const unit = ingredientsCatalog.find((i) => i.id === l.ingredientId)?.unit ?? "g";
            return { recipeId: id, ingredientId: l.ingredientId, quantity: makeQuantity(l.amount, unit) };
          });
      }

      const recipeSteps: readonly RecipeStep[] = steps
        .map((text) => text.trim())
        .filter((text) => text !== "")
        .map((text, index) => ({ recipeId: id, stepNumber: index + 1, text }));

      await store.recipes.upsert(recipe);
      await store.recipeIngredients.replaceForRecipe(id, recipeLines);
      await store.recipeSteps.replaceForRecipe(id, recipeSteps);

      showToast({
        variant: "success",
        title: `Saved "${recipe.name}"`,
        durationMs: 5000,
        ...(kind === "bought" ? { description: `Linked catalog ingredient "${recipe.name}" (piece).` } : {}),
      });
      navigate("/recipes");
    } catch (err) {
      showToast({ variant: "error", title: "Couldn't save the recipe", description: messageOf(err) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      <p>
        <Link to="/recipes" className={styles.backLink}>
          &larr; Recipes
        </Link>
      </p>
      <h1>{isNew ? "Add recipe" : "Edit recipe"}</h1>

      {loading ? <Skeleton /> : null}
      {!loading && error ? <ErrorState title="Couldn't load this recipe" description={error} /> : null}
      {!loading && !error ? (
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            void handleSave();
          }}
        >
          <TextField label="Name" value={name} onChange={setName} required placeholder="e.g. Weeknight chili" />

          <div className={styles.field}>
            <span>Kind</span>
            <SegmentedControl<RecipeKind> aria-label="Recipe kind" options={KIND_OPTIONS} value={kind} onChange={setKind} />
          </div>

          {/* Household flag — the mockup places this right under the recipe's
              own identity, full-width, not tucked among the time/servings
              fields — it's the single most important control on the page
              after "what recipe is this". */}
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Household flag</span>
            <div className={styles.fullWidthControl}>
              <SegmentedControl<RecipeStatus>
                aria-label="Household flag"
                options={STATUS_OPTIONS}
                value={status}
                onChange={setStatus}
              />
            </div>
          </div>

          <div className={styles.field}>
            <span>Meal tags</span>
            <ToggleChips<MealTag> aria-label="Meal tags" options={MEAL_TAG_OPTIONS} value={mealTags} onChange={setMealTags} />
          </div>

          <div className={styles.row}>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>Servings</span>
              <ServingsStepper value={baseServings} onChange={setBaseServings} />
            </div>
            {kind === "cooked" ? (
              <IntegerField label="Prep time" suffix="min" value={prepMinutes} onChange={setPrepMinutes} required />
            ) : (
              <div className={styles.field}>
                <span>Prep time</span>
                <p className={styles.hint}>0 min — store-bought meals have no prep step.</p>
              </div>
            )}
            <IntegerField
              label="Cook time"
              suffix="min"
              value={cookMinutes}
              onChange={setCookMinutes}
              required
            />
          </div>

          {kind === "cooked" ? (
            <div className={styles.field}>
              <p className={styles.sectionHeading}>Ingredients</p>
              <div className={styles.sectionCard}>
                <div className={styles.sectionCardBody}>
                  {lines.length === 0 ? <p className={styles.hint}>No ingredient lines yet.</p> : null}
                  {lines.map((line) => {
                    const unit = ingredientsCatalog.find((i) => i.id === line.ingredientId)?.unit ?? "g";
                    return (
                      <div className={styles.line} key={line.key}>
                        <SelectSheet
                          label="Ingredient"
                          options={ingredientOptions}
                          value={line.ingredientId}
                          onChange={(value) => setLineIngredient(line.key, value)}
                          placeholder="Choose an ingredient…"
                        />
                        <QuantityInput
                          label="Amount"
                          unit={unit}
                          value={line.amount}
                          onChange={(q) => setLineAmount(line.key, q?.amount ?? null)}
                          disabled={line.ingredientId === null}
                          required
                        />
                        <button
                          type="button"
                          className={styles.removeButton}
                          onClick={() => removeLine(line.key)}
                          aria-label="Remove ingredient line"
                        >
                          <Trash size={18} aria-hidden="true" />
                        </button>
                      </div>
                    );
                  })}
                  <button type="button" className={styles.addButton} onClick={addLine}>
                    <Plus size={18} aria-hidden="true" />
                    Add ingredient line
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <p className={styles.hint}>
              Saving links a single catalog ingredient, &ldquo;{name.trim() || "(recipe name)"}&rdquo;, unit
              &ldquo;piece&rdquo; — the product itself.
            </p>
          )}

          <div className={styles.field}>
            <p className={styles.sectionHeading}>Steps</p>
            <div className={styles.sectionCard}>
              <div className={styles.sectionCardBody}>
                {steps.map((step, index) => (
                  <div className={styles.line} key={index}>
                    <TextField
                      label={`Step ${index + 1}`}
                      value={step}
                      onChange={(text) => updateStep(index, text)}
                      placeholder="e.g. 375 degrees, 30 min covered"
                    />
                    <button
                      type="button"
                      className={styles.removeButton}
                      onClick={() => removeStep(index)}
                      aria-label={`Remove step ${index + 1}`}
                    >
                      <Trash size={18} aria-hidden="true" />
                    </button>
                  </div>
                ))}
                <button type="button" className={styles.addButton} onClick={addStep}>
                  <Plus size={18} aria-hidden="true" />
                  Add step
                </button>
              </div>
            </div>
          </div>

          <div className={styles.actions}>
            <button type="submit" className={styles.saveButton} disabled={saving}>
              {saving ? "Saving…" : "Save recipe"}
            </button>
          </div>
        </form>
      ) : null}

      {!loading && !error && !isNew ? (
        <div className={styles.field}>
          <p className={styles.sectionHeading}>Cooked history</p>
          <div className={styles.sectionCard}>
            <div className={styles.sectionCardBody}>
              {cookedHistory.length === 0 ? (
                <p className={styles.hint}>Not marked cooked yet.</p>
              ) : (
                cookedHistory.map((slot) => (
                  <div className={styles.line} key={slot.id}>
                    <CookingPot size={18} aria-hidden="true" />
                    <span>
                      {slot.date} · {slot.slotType}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

/** Servings +/- stepper — matches the mockup's `.qty` control (UI_DESIGN.md §5: real touch targets, never a native numeric spinner). */
function ServingsStepper({
  value,
  onChange,
}: {
  readonly value: number | null;
  readonly onChange: (value: number) => void;
}) {
  const current = value ?? 1;
  return (
    <div className={styles.qty}>
      <button type="button" aria-label="Fewer servings" onClick={() => onChange(Math.max(1, current - 1))}>
        <Minus size={16} aria-hidden="true" />
      </button>
      <span className={styles.qtyValue}>
        {current} <span className={styles.qtyUnit}>servings</span>
      </span>
      <button type="button" aria-label="More servings" onClick={() => onChange(current + 1)}>
        <Plus size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
