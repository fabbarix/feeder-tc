import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useWorkbookContext } from "../workbook-context.ts";
import { useToast } from "../ui/components/Toast/useToast.ts";
import {
  ErrorState,
  QuantityInput,
  SegmentedControl,
  SelectSheet,
  Skeleton,
  ToggleChips,
} from "../ui/components";
import { Plus, Trash } from "../ui/icons";
import {
  makeIngredientId,
  makeQuantity,
  makeRecipeId,
  newRecipeId,
  newStepId,
  type Ingredient,
  type IngredientId,
  type MealTag,
  type Recipe,
  type RecipeIngredient,
  type RecipeKind,
  type RecipeStatus,
  type RecipeStep,
  type Rng,
  type StepId,
} from "../domain/index.ts";
import { TextField } from "./fields.tsx";
import { KIND_OPTIONS, MEAL_TAG_OPTIONS, STATUS_OPTIONS } from "./recipe-options.ts";
import { uniqueSlug } from "./slug.ts";
import styles from "./forms.module.css";
import detailStyles from "./recipe-detail.module.css";

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

interface LineDraft {
  readonly key: string;
  readonly ingredientId: IngredientId | null;
  readonly amount: number | null;
}

/**
 * A step's `StepId` is required on `RecipeStep` (WP-PHOTO — DESIGN_PHOTOS.md
 * §3: a step without identity is the bug that widening closes), so a draft
 * carries one from the moment it exists — minted immediately for a new step
 * (`newStepId(rng)`), or kept as-is for a step loaded from an existing
 * recipe. `key` is a separate, purely-local React list key (same pattern as
 * `LineDraft.key` above); `id` is the identity that actually gets saved.
 *
 * `detail`/`durationMinutes`/`hasPhoto` mirror `RecipeStep`'s own optional
 * fields (types.ts), represented here with draft-friendly defaults ("" / null
 * / false) instead of `undefined` — same "" -> undefined convention `name`
 * already uses elsewhere in this file. Carrying all three all the way
 * through load -> state -> save is the fix for the round-trip data-loss bug
 * this file used to have: the old `StepDraft` only ever held `description`,
 * so re-saving a step through this editor silently dropped anything else a
 * step had ever been given (WP-PHOTO's own worry in DESIGN_PHOTOS.md §3
 * about a widened `RecipeStep` becoming real data loss the moment a UI could
 * populate it).
 */
interface StepDraft {
  readonly key: string;
  readonly id: StepId;
  readonly description: string;
  readonly detail: string;
  readonly durationMinutes: number | null;
  readonly hasPhoto: boolean;
}

/** A brand-new step draft, minting a fresh `StepId` immediately (see `StepDraft`'s own doc comment for why). */
function emptyStepDraft(key: string, rng: Rng): StepDraft {
  return { key, id: newStepId(rng), description: "", detail: "", durationMinutes: null, hasPhoto: false };
}

/** Create/edit a recipe — cooked or bought (WP-20). Bought recipes force prepMinutes to 0 and link a single "piece" catalog ingredient for the product itself (DESIGN.md §2 "Recipes"). */
export function RecipeEditor() {
  const { recipeId } = useParams();
  const navigate = useNavigate();
  const { store, rng } = useWorkbookContext();
  const { showToast } = useToast();
  const isNew = recipeId === undefined;
  const lineKeyCounter = useRef(0);
  const stepKeyCounter = useRef(0);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  const [ingredientsCatalog, setIngredientsCatalog] = useState<readonly Ingredient[]>([]);
  const [linkedIngredientId, setLinkedIngredientId] = useState<IngredientId | undefined>(undefined);

  const [name, setName] = useState("");
  const [kind, setKind] = useState<RecipeKind>("cooked");
  const [status, setStatus] = useState<RecipeStatus>("in-rotation");
  const [baseServings, setBaseServings] = useState<number | null>(4);
  const [prepMinutes, setPrepMinutes] = useState<number | null>(15);
  const [cookMinutes, setCookMinutes] = useState<number | null>(30);
  const [mealTags, setMealTags] = useState<readonly MealTag[]>([]);
  const [lines, setLines] = useState<readonly LineDraft[]>([]);
  // Fixed literal key, not the ref-backed counter below: reading a ref
  // during render (even just to seed useState's lazy initializer) trips
  // react-hooks' "refs are for effects/handlers, not render" rule. This
  // runs exactly once regardless, so a hardcoded key is no less unique than
  // one drawn from the counter would have been.
  const [steps, setSteps] = useState<readonly StepDraft[]>(() => [emptyStepDraft("initial-step", rng)]);

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
    ])
      .then(([ingredientsResult, recipesResult, linesResult, stepsResult]) => {
        if (cancelled) return;
        setIngredientsCatalog(
          [...ingredientsResult.rows].sort((a, b) => a.name.localeCompare(b.name)),
        );

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
          setSteps(
            ownSteps.length > 0
              ? ownSteps.map((s) => ({
                  key: `existing-${(stepKeyCounter.current += 1)}`,
                  id: s.id,
                  description: s.description,
                  // WP-PHOTO round-trip fix: these three used to be dropped
                  // on the floor here — only `description` was ever read
                  // out of a loaded step — so re-saving with no edit at all
                  // silently erased them. See `StepDraft`'s doc comment.
                  detail: s.detail ?? "",
                  durationMinutes: s.durationMinutes ?? null,
                  hasPhoto: s.hasPhoto ?? false,
                }))
              : [emptyStepDraft(`new-${(stepKeyCounter.current += 1)}`, rng)],
          );
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
  }, [store, recipeId, isNew, showToast, rng]);

  // Store-bought recipes have no prep step (DESIGN.md §2 "Recipes") — shown
  // and locked (QuantityInput's `disabled`) at 0 the moment "Kind" is
  // Bought, so the field never displays a stale non-zero value while it
  // can't be edited. Derived at render time, not via a setState-in-effect,
  // so switching back to "Cooked" restores whatever the user had typed
  // rather than needing a second piece of state to remember it.
  const displayedPrepMinutes = kind === "bought" ? 0 : (prepMinutes ?? 0);

  const ingredientOptions = ingredientsCatalog.map((i) => ({ value: i.id, label: i.name }));
  const kindLabel = KIND_OPTIONS.find((option) => option.value === kind)?.label ?? kind;

  function addLine(): void {
    lineKeyCounter.current += 1;
    setLines((current) => [
      ...current,
      { key: `new-${lineKeyCounter.current}`, ingredientId: null, amount: null },
    ]);
  }

  function removeLine(key: string): void {
    setLines((current) => current.filter((l) => l.key !== key));
  }

  function setLineIngredient(key: string, ingredientId: IngredientId): void {
    setLines((current) =>
      current.map((l) => (l.key === key ? { ...l, ingredientId, amount: null } : l)),
    );
  }

  function setLineAmount(key: string, amount: number | null): void {
    setLines((current) => current.map((l) => (l.key === key ? { ...l, amount } : l)));
  }

  function addStep(): void {
    stepKeyCounter.current += 1;
    setSteps((current) => [...current, emptyStepDraft(`new-${stepKeyCounter.current}`, rng)]);
  }

  function updateStep(index: number, description: string): void {
    setSteps((current) => current.map((s, i) => (i === index ? { ...s, description } : s)));
  }

  function removeStep(index: number): void {
    setSteps((current) => current.filter((_, i) => i !== index));
  }

  async function handleSave(): Promise<void> {
    if (name.trim() === "" || baseServings === null || baseServings <= 0 || cookMinutes === null) {
      showToast({
        variant: "warning",
        title: "Fill in a name, servings and cook time before saving.",
      });
      return;
    }
    if (
      kind === "cooked" &&
      lines.some((l) => l.ingredientId === null || l.amount === null || l.amount <= 0)
    ) {
      showToast({
        variant: "warning",
        title: "Every ingredient line needs an ingredient and a positive amount.",
      });
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
        const productId =
          linkedIngredientId ??
          makeIngredientId(uniqueSlug(recipe.name, existingIngredientIds, rng));
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
        recipeLines = [
          { recipeId: id, ingredientId: productId, quantity: makeQuantity(1, "piece") },
        ];
      } else {
        recipeLines = lines
          .filter(
            (l): l is LineDraft & { ingredientId: IngredientId; amount: number } =>
              l.ingredientId !== null && l.amount !== null,
          )
          .map((l) => {
            const unit = ingredientsCatalog.find((i) => i.id === l.ingredientId)?.unit ?? "g";
            return {
              recipeId: id,
              ingredientId: l.ingredientId,
              quantity: makeQuantity(l.amount, unit),
            };
          });
      }

      // WP-PHOTO round-trip fix: `detail`/`durationMinutes`/`hasPhoto` are
      // carried through from `StepDraft` here instead of being dropped —
      // this is the actual fix for the bug this file used to have (see
      // `StepDraft`'s doc comment above). `detail`/`durationMinutes` fold
      // back to `undefined` when blank/null, same "absent, not empty" shape
      // `RecipeStep`'s own optional fields expect.
      const recipeSteps: readonly RecipeStep[] = steps
        .map((s) => ({ ...s, description: s.description.trim(), detail: s.detail.trim() }))
        .filter((s) => s.description !== "")
        .map((s, index) => ({
          recipeId: id,
          id: s.id,
          stepNumber: index + 1,
          description: s.description,
          ...(s.detail !== "" ? { detail: s.detail } : {}),
          ...(s.durationMinutes !== null ? { durationMinutes: s.durationMinutes } : {}),
          ...(s.hasPhoto ? { hasPhoto: true } : {}),
        }));

      await store.recipes.upsert(recipe);
      await store.recipeIngredients.replaceForRecipe(id, recipeLines);
      await store.recipeSteps.replaceForRecipe(id, recipeSteps);

      showToast({
        variant: "success",
        title: `Saved "${recipe.name}"`,
        durationMs: 5000,
        ...(kind === "bought"
          ? { description: `Linked catalog ingredient "${recipe.name}" (piece).` }
          : {}),
      });
      navigate("/recipes");
    } catch (err) {
      showToast({
        variant: "error",
        title: "Couldn't save the recipe",
        description: messageOf(err),
      });
    } finally {
      setSaving(false);
    }
  }

  const cancelTo = isNew ? "/recipes" : `/recipes/${recipeId}`;

  return (
    <section>
      {/* Exactly one h1 (axe `page-has-heading-one`, same discipline as
          RecipeDetail.tsx) — shown here while loading/erroring, and again,
          once, inside the form's own top bar below once data is ready. */}
      {loading || error ? <h1>{isNew ? "Add recipe" : "Edit recipe"}</h1> : null}

      {loading ? <Skeleton /> : null}
      {!loading && error ? (
        <ErrorState title="Couldn't load this recipe" description={error} />
      ) : null}
      {!loading && !error ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void handleSave();
          }}
        >
          {/* Top bar: Save/Cancel live beside the heading, never floating
              mid-page (WP-VC4, design/mock-screens.html #editor's
              `.dt-actions`/`.p-head` — the owner's own words: "Save lives
              in the top bar, not floating in the middle of the page"). */}
          <div className={detailStyles.headRow}>
            <div>
              <h1>{isNew ? "Add recipe" : "Edit recipe"}</h1>
              {!isNew ? (
                <p className={detailStyles.dtSub}>
                  {name.trim() || "Untitled"} · {kindLabel}
                </p>
              ) : null}
            </div>
            <div className={detailStyles.headActions}>
              <Link to={cancelTo} className={detailStyles.editLink}>
                Cancel
              </Link>
              <button type="submit" className={styles.saveButton} disabled={saving}>
                {saving ? "Saving…" : "Save recipe"}
              </button>
            </div>
          </div>

          {/* Three concerns, three (or four) titled cards — never one
              run-on list (WP-VC4, design/mock-screens.html #editor's own
              note: "the form has three distinct concerns — identity,
              timing, and content — and they should read as three cards").
              "Content" is Steps always, plus Ingredients too for a cooked
              recipe — the mock's own example is a Bought recipe, which has
              no ingredient lines by design, so its screenshot shows only
              Identity/Steps in this column. */}
          <div className={detailStyles.cols}>
            <div className={detailStyles.main}>
              <div className={styles.sectionCard}>
                <div className={styles.sectionCardHead}>Identity</div>
                <div className={styles.sectionCardBody}>
                  <TextField
                    label="Name"
                    value={name}
                    onChange={setName}
                    required
                    placeholder="e.g. Weeknight chili"
                  />
                  <div className={styles.field}>
                    <span className={styles.fieldLabel}>Meal tags</span>
                    <ToggleChips<MealTag>
                      aria-label="Meal tags"
                      options={MEAL_TAG_OPTIONS}
                      value={mealTags}
                      onChange={setMealTags}
                    />
                  </div>
                </div>
              </div>

              {kind === "cooked" ? (
                <div className={styles.sectionCard}>
                  <div className={styles.sectionCardHead}>Ingredients</div>
                  <div className={styles.sectionCardBody}>
                    {lines.length === 0 ? (
                      <p className={styles.hint}>No ingredient lines yet.</p>
                    ) : null}
                    {lines.map((line) => {
                      const unit =
                        ingredientsCatalog.find((i) => i.id === line.ingredientId)?.unit ?? "g";
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
              ) : (
                <p className={styles.hint}>
                  Saving links a single catalog ingredient, &ldquo;{name.trim() || "(recipe name)"}
                  &rdquo;, unit &ldquo;piece&rdquo; — the product itself.
                </p>
              )}

              <div className={styles.sectionCard}>
                <div className={styles.sectionCardHead}>Steps</div>
                <div className={styles.sectionCardBody}>
                  {steps.map((step, index) => (
                    <div className={styles.line} key={step.key}>
                      <TextField
                        label={`Step ${index + 1}`}
                        value={step.description}
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

            <div className={detailStyles.rail}>
              <div className={styles.sectionCard}>
                <div className={styles.sectionCardHead}>Kind &amp; rotation</div>
                <div className={styles.sectionCardBody}>
                  <div className={styles.field}>
                    <span className={styles.fieldLabel}>Kind</span>
                    <SegmentedControl<RecipeKind>
                      aria-label="Recipe kind"
                      options={KIND_OPTIONS}
                      value={kind}
                      onChange={setKind}
                    />
                  </div>
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
                </div>
              </div>

              <div className={styles.sectionCard}>
                <div className={styles.sectionCardHead}>Timing &amp; servings</div>
                <div className={styles.sectionCardBody}>
                  {/* Every numeric field on this screen is the SAME control
                      — `QuantityInput` with steppers (design/mock-screens.html
                      #editor's own note). Prep time used to be a plain number
                      box, and a sentence in its place for a bought recipe;
                      cook time was a different-looking box again. Not
                      anymore: all three are the one control, prep just
                      locked at 0 (disabled, never hidden/replaced by prose)
                      when Kind is Bought. */}
                  <QuantityInput<"servings">
                    label="Servings"
                    unit="servings"
                    value={baseServings}
                    onChange={(q) => setBaseServings(q?.amount ?? null)}
                    showSteppers
                    required
                  />
                  {/* `key={kind}` forces a remount when Kind toggles:
                      `QuantityInput` seeds its raw text from `value` only
                      on mount (uncontrolled-after-mount, like every text
                      input in this kit — see its own doc comment), so
                      without this the field would keep showing whatever
                      was last typed instead of snapping to "0" the instant
                      Kind becomes Bought, which is exactly the stale-value
                      bug this screen exists to fix. */}
                  <QuantityInput<"min">
                    key={kind}
                    label="Prep time"
                    unit="min"
                    value={displayedPrepMinutes}
                    onChange={(q) => setPrepMinutes(q?.amount ?? null)}
                    disabled={kind === "bought"}
                    showSteppers
                    required
                  />
                  <QuantityInput<"min">
                    label="Cook time"
                    unit="min"
                    value={cookMinutes}
                    onChange={(q) => setCookMinutes(q?.amount ?? null)}
                    showSteppers
                    required
                  />
                </div>
              </div>
            </div>
          </div>
        </form>
      ) : null}
    </section>
  );
}
