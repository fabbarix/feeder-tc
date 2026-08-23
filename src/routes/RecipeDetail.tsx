import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useWorkbookContext } from "../workbook-context.ts";
import { useToast } from "../ui/components/Toast/useToast.ts";
import { ErrorState, Markdown, SegmentedControl, Skeleton } from "../ui/components";
import { PhotoMedia } from "../ui/photo/index.ts";
import { Minus, Pause, Plus, Timer, X } from "../ui/icons";
import {
  formatQuantity,
  newPlanSlotId,
  scaledRecipeIngredients,
  type IngredientId,
  type IsoDate,
  type PlanSlot,
  type Recipe,
  type RecipeIngredient,
  type RecipeStatus,
  type RecipeStep,
  type StepId,
} from "../domain/index.ts";
import { getPhotoDataUrl } from "../photos/index.ts";
import { usePantryInventory } from "./pantry/usePantryInventory.ts";
import { formatShortDate } from "./date-format.ts";
import { STATUS_OPTIONS } from "./recipe-options.ts";
import formsStyles from "./forms.module.css";
import recipesStyles from "./recipes.module.css";
import styles from "./recipe-detail.module.css";

/** One running/paused kitchen timer, tied to a specific step — only one at a time (mock-responsive.html shows a single `.timerrun`, contextual to whichever step started it). */
interface ActiveTimer {
  readonly stepId: StepId;
  readonly remainingSeconds: number;
  readonly paused: boolean;
}

/** "18:42" / "6:05" — mm:ss, never hours (no step here runs an hour+). */
function formatTimer(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function capitalize(word: string): string {
  return word.length === 0 ? word : word[0]!.toUpperCase() + word.slice(1);
}

/** "3" or "1.5" — a stock total for the "· N in pantry" annotation, trimmed to at most 2 decimals so float noise (e.g. FIFO remainders) never prints as "3.0000000001". */
function formatStock(amount: number): string {
  const rounded = Math.round(amount * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

/**
 * Read-only recipe view (WP-VC2, design/mock-screens.html #recipe) — what a
 * recipe card now opens into, replacing the always-editable form that used
 * to sit at this exact route. Editing moved to its own route,
 * `/recipes/:id/edit` (RecipeEditor.tsx, unchanged apart from the move).
 *
 * Two of this page's three rail controls are live actions, not just
 * display, matching the mock's own interactive `.seg`/`.qty` controls on
 * the "read" screen: the household flag writes through immediately
 * (`store.recipes.upsert`, a last-write-wins plain-row edit per
 * contracts.ts — not the outbox, which is inventory-events-only per
 * invariant 9), and the servings stepper only rescales the ingredient list
 * shown here, client-side.
 *
 * "Mark cooked" is scoped deliberately narrowly: it transitions today's
 * `PlanSlot` for this recipe to `state: "cooked"` (or creates one, if this
 * recipe wasn't already planned for today) via `store.planSlots.upsert` —
 * consistent with how "Cooked N times" is computed here and in
 * RecipeEditor.tsx. It does NOT run FIFO ingredient consumption or create a
 * leftover lot: that full "mark cooked -> confirm/tweak screen -> usage
 * events -> leftover lot" flow is IMPLEMENTATION_PLAN.md's WP-22
 * (unbuilt — Plan.tsx is still a stub), and `scaledRecipeIngredients`'s own
 * doc comment already names WP-22, not this route, as that flow's owner.
 * Faking the deduction here would violate invariant 4 (FIFO) with no real
 * pantry data behind it, so this stays a real, honest, smaller action
 * instead of a fake big one.
 */
export function RecipeDetail() {
  const { recipeId } = useParams();
  const { store, clock, rng } = useWorkbookContext();
  const { showToast } = useToast();
  const pantry = usePantryInventory();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [marking, setMarking] = useState(false);

  const [recipe, setRecipe] = useState<Recipe | undefined>(undefined);
  const [lines, setLines] = useState<readonly RecipeIngredient[]>([]);
  const [steps, setSteps] = useState<readonly RecipeStep[]>([]);
  const [planSlots, setPlanSlots] = useState<readonly PlanSlot[]>([]);
  const [servings, setServings] = useState<number | undefined>(undefined);
  const [activeTimer, setActiveTimer] = useState<ActiveTimer | undefined>(undefined);

  const today = clock.today();

  const timerRunning = activeTimer !== undefined && !activeTimer.paused && activeTimer.remainingSeconds > 0;
  useEffect(() => {
    if (!timerRunning) return;
    const id = window.setInterval(() => {
      setActiveTimer((current) => {
        if (!current) return current;
        return { ...current, remainingSeconds: Math.max(0, current.remainingSeconds - 1) };
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [timerRunning]);

  function startTimer(step: RecipeStep): void {
    if (step.durationMinutes === undefined) return;
    setActiveTimer({ stepId: step.id, remainingSeconds: step.durationMinutes * 60, paused: false });
  }

  function togglePauseTimer(): void {
    setActiveTimer((current) => (current ? { ...current, paused: !current.paused } : current));
  }

  function cancelTimer(): void {
    setActiveTimer(undefined);
  }

  useEffect(() => {
    // `loading`/`error` are only ever set from the promise's own resolution
    // below, never synchronously here — same react-hooks discipline as
    // Recipes.tsx/RecipeEditor.tsx.
    let cancelled = false;
    Promise.all([
      store.recipes.readAll(),
      store.recipeIngredients.readAll(),
      store.recipeSteps.readAll(),
      store.planSlots.readAll(),
      store.settings.read(),
    ])
      .then(([recipesResult, linesResult, stepsResult, slotsResult, settingsResult]) => {
        if (cancelled) return;
        const found = recipesResult.rows.find((r) => r.id === recipeId);
        if (!found) {
          setError(`No recipe with id "${recipeId}".`);
          return;
        }
        setRecipe(found);
        setLines(linesResult.rows.filter((l) => l.recipeId === recipeId));
        setSteps(
          [...stepsResult.rows].filter((s) => s.recipeId === recipeId).sort((a, b) => a.stepNumber - b.stepNumber),
        );
        setPlanSlots(slotsResult.rows);
        setServings(settingsResult.householdSize);
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
  }, [store, recipeId]);

  const stockByIngredient = useMemo(() => {
    const map = new Map<IngredientId, number>();
    for (const lot of pantry.lots) {
      map.set(lot.ingredientId, (map.get(lot.ingredientId) ?? 0) + lot.quantity.amount);
    }
    return map;
  }, [pantry.lots]);

  const scaledLines = useMemo(() => {
    if (!recipe || servings === undefined) return [];
    return scaledRecipeIngredients(recipe, lines, servings);
  }, [recipe, lines, servings]);

  const cookedSlots = useMemo(
    () =>
      planSlots.filter(
        (s) => s.state === "cooked" && s.filling.kind === "recipe" && s.filling.recipeId === recipeId,
      ),
    [planSlots, recipeId],
  );
  const lastCookedDate = useMemo<IsoDate | undefined>(
    () => cookedSlots.reduce<IsoDate | undefined>((latest, s) => (!latest || s.date > latest ? s.date : latest), undefined),
    [cookedSlots],
  );

  /**
   * WP-stale-save: this used to spread the LOCAL `recipe` (loaded once at
   * mount) into the write — a blind full-row write that could revert
   * whatever else a concurrent household member had since edited on this
   * recipe (name, servings, a photo...) back to this route's stale copy.
   * Re-reads and applies just the `status` flag to the freshest row instead
   * — the toggle's own value is still correctly last-write-wins (tapping
   * the flag again is the obvious "undo"), this only protects every OTHER
   * field. No ConfirmDialog: this is a one-tap flag, not a multi-field form
   * Save (RecipeEditor.tsx's own `/edit` route already covers that case for
   * this exact recipe).
   */
  async function handleStatusChange(status: RecipeStatus): Promise<void> {
    if (!recipe) return;
    const previous = recipe;
    const optimistic: Recipe = { ...recipe, status };
    setRecipe(optimistic);
    try {
      const latest = (await store.recipes.readAll()).rows.find((r) => r.id === recipe.id);
      if (!latest) {
        setRecipe(previous);
        showToast({ variant: "error", title: "Couldn't update the household flag", description: "This recipe no longer exists." });
        return;
      }
      const updated: Recipe = { ...latest, status };
      setRecipe(updated);
      await store.recipes.upsert(updated);
    } catch (err) {
      setRecipe(previous);
      showToast({ variant: "error", title: "Couldn't update the household flag", description: messageOf(err) });
    }
  }

  /**
   * WP-stale-save: `existing` used to come from `planSlots` — this route's
   * OWN local snapshot, loaded once at mount — so a save here could revert
   * a pin/scale/recipe-swap another household member made to today's exact
   * slot since this page opened, or (worse) create a SECOND "cooked" slot
   * for today alongside one someone else already logged, if this route's
   * copy hadn't caught up. Re-reads `planSlots` fresh and redoes the exact
   * same "is there already a planned slot for this recipe today" search
   * over THAT, so the create-vs-update decision is made on current data.
   */
  async function handleMarkCooked(): Promise<void> {
    if (!recipe) return;
    setMarking(true);
    try {
      const targetServings = servings ?? recipe.baseServings;
      const scaleOverride = targetServings !== recipe.baseServings ? { scaleServings: targetServings } : {};
      const latestPlanSlots = (await store.planSlots.readAll()).rows;
      const existing = latestPlanSlots.find(
        (s) =>
          s.date === today &&
          s.state === "planned" &&
          s.filling.kind === "recipe" &&
          s.filling.recipeId === recipe.id,
      );
      const slot: PlanSlot = existing
        ? { ...existing, state: "cooked", filling: { kind: "recipe", recipeId: recipe.id, ...scaleOverride } }
        : {
            id: newPlanSlotId(rng),
            date: today,
            slotType: recipe.mealTags[0] ?? "dinner",
            slotIndex: 0,
            filling: { kind: "recipe", recipeId: recipe.id, ...scaleOverride },
            state: "cooked",
            pinned: false,
          };
      await store.planSlots.upsert(slot);
      setPlanSlots((current) => {
        const idx = current.findIndex((s) => s.id === slot.id);
        if (idx === -1) return [...current, slot];
        const next = [...current];
        next[idx] = slot;
        return next;
      });
      // No success toast (UX review round 2, "quieten the toasts"): the
      // "Cooked N times · last on …" line just above this button reads off
      // `planSlots`, so it updates to say "today" the moment the state
      // above commits — that line already IS the confirmation.
    } catch (err) {
      showToast({ variant: "error", title: "Couldn't mark this cooked", description: messageOf(err) });
    } finally {
      setMarking(false);
    }
  }

  return (
    <section>
      {/* Exactly one h1 either way — required for axe's
          `page-has-heading-one` (e2e/wp-15-a11y.spec.ts's "/recipes/12"
          case: an id that doesn't exist still has to render a heading
          above its ErrorState) — but never two: the loaded branch below
          renders the recipe's own `<h1>` positioned inside `.headRow`
          beside its actions (matching the mock), so this fallback only
          fires while there is no `recipe` yet to name it after. */}
      {!recipe ? <h1>Recipe</h1> : null}

      {loading ? (
        <>
          <Skeleton height="1.2em" width="40%" />
          <Skeleton height="10em" />
        </>
      ) : null}

      {!loading && error ? <ErrorState title="Couldn't load this recipe" description={error} /> : null}

      {!loading && !error && recipe ? (
        <>
          <div className={styles.headRow}>
            <div>
              <h1>{recipe.name}</h1>
              <div className={styles.pillRow}>
                {recipe.mealTags.map((tag) => (
                  <span key={tag} className={recipesStyles.tagPill}>
                    {capitalize(tag)}
                  </span>
                ))}
                <span className={recipesStyles.tagPill}>{recipe.prepMinutes} prep</span>
                <span className={recipesStyles.tagPill}>{recipe.cookMinutes} cook</span>
                {recipe.kind === "bought" ? <span className={recipesStyles.tagPill}>Bought</span> : null}
              </div>
              <p className={styles.dtSub}>
                {cookedSlots.length === 0
                  ? "Not cooked yet"
                  : `Cooked ${cookedSlots.length} time${cookedSlots.length === 1 ? "" : "s"}${
                      lastCookedDate ? ` · last on ${formatShortDate(lastCookedDate)}` : ""
                    }`}
              </p>
            </div>
            <div className={styles.headActions}>
              <Link to={`/recipes/${recipe.id}/edit`} className={styles.editLink}>
                Edit
              </Link>
              <button
                type="button"
                className={styles.markCookedButton}
                onClick={() => void handleMarkCooked()}
                disabled={marking}
              >
                {marking ? "Marking…" : "Mark cooked"}
              </button>
            </div>
          </div>

          <div className={styles.cols}>
            <div className={styles.main}>
              <div className={formsStyles.sectionCard}>
                <div className={formsStyles.sectionCardHead}>
                  Ingredients · scaled to {servings ?? recipe.baseServings} servings
                </div>
                <div className={formsStyles.sectionCardBody}>
                  {scaledLines.length === 0 ? (
                    <p className={formsStyles.hint}>No ingredients recorded.</p>
                  ) : (
                    <div className={styles.ilist}>
                      {scaledLines.map((line) => {
                        const ingredient = pantry.ingredientsById.get(line.ingredientId);
                        const stock = stockByIngredient.get(line.ingredientId) ?? 0;
                        return (
                          <div key={line.ingredientId} className={styles.ilistRow}>
                            <span>
                              {ingredient?.name ?? line.ingredientId}
                              {stock > 0 ? <span className={styles.have}> · {formatStock(stock)} in pantry</span> : null}
                            </span>
                            <span className={styles.q}>{formatQuantity(line.quantity)}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              <div className={formsStyles.sectionCard}>
                <div className={formsStyles.sectionCardHead}>Method</div>
                <div className={formsStyles.sectionCardBody}>
                  {steps.length === 0 ? (
                    <p className={formsStyles.hint}>No steps recorded.</p>
                  ) : (
                    <>
                      {activeTimer
                        ? (() => {
                            const runningIndex = steps.findIndex((s) => s.id === activeTimer.stepId);
                            return (
                              <div className={styles.timerRun}>
                                <div>
                                  <p className={styles.timerLabel}>
                                    Running — step {runningIndex === -1 ? "" : runningIndex + 1}
                                  </p>
                                  <p className={styles.timerCount}>{formatTimer(activeTimer.remainingSeconds)}</p>
                                </div>
                                <div className={styles.timerActions}>
                                  <button
                                    type="button"
                                    className={styles.timerButton}
                                    aria-label={activeTimer.paused ? "Resume timer" : "Pause timer"}
                                    onClick={togglePauseTimer}
                                  >
                                    <Pause size={18} aria-hidden="true" />
                                  </button>
                                  <button
                                    type="button"
                                    className={styles.timerButton}
                                    aria-label="Cancel timer"
                                    onClick={cancelTimer}
                                  >
                                    <X size={18} aria-hidden="true" />
                                  </button>
                                </div>
                              </div>
                            );
                          })()
                        : null}
                      <ol className={styles.stepsList}>
                        {steps.map((step) => {
                          const isRunning = activeTimer?.stepId === step.id;
                          return (
                            <li key={step.id} className={styles.stepItem}>
                              <div className={styles.stepBody}>
                                <p className={styles.stepLine}>{step.description}</p>
                                {step.hasPhoto ? (
                                  <div className={styles.stepImgWrap}>
                                    <PhotoMedia
                                      kind="recipe-step"
                                      hasPhoto
                                      size="step"
                                      fetchPhoto={() => getPhotoDataUrl(store, "recipe-step", step.id)}
                                    />
                                  </div>
                                ) : null}
                                {step.durationMinutes !== undefined ? (
                                  <div className={styles.stepMeta}>
                                    <span className={styles.stepDur}>
                                      <Timer size={12} aria-hidden="true" />
                                      {step.durationMinutes} min{isRunning ? " · running" : ""}
                                    </span>
                                    {!isRunning ? (
                                      <button
                                        type="button"
                                        className={styles.timerBtn}
                                        onClick={() => startTimer(step)}
                                      >
                                        Start timer
                                      </button>
                                    ) : null}
                                  </div>
                                ) : null}
                                {step.detail ? (
                                  <details className={styles.stepDetail}>
                                    <summary />
                                    <div className={styles.detailText}>
                                      <Markdown text={step.detail} />
                                    </div>
                                  </details>
                                ) : null}
                              </div>
                            </li>
                          );
                        })}
                      </ol>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className={styles.rail}>
              {recipe.hasPhoto ? (
                <PhotoMedia
                  kind="recipe"
                  hasPhoto
                  size="detail"
                  fetchPhoto={() => getPhotoDataUrl(store, "recipe", recipe.id)}
                  alt={recipe.name}
                />
              ) : null}
              <div className={formsStyles.sectionCard}>
                <div className={formsStyles.sectionCardHead}>Use in planning</div>
                <div className={formsStyles.sectionCardBody}>
                  <div className={formsStyles.fullWidthControl}>
                    <SegmentedControl<RecipeStatus>
                      aria-label="Use in planning"
                      options={STATUS_OPTIONS}
                      value={recipe.status}
                      onChange={(status) => void handleStatusChange(status)}
                    />
                  </div>
                  <p className={formsStyles.hint}>
                    Staple: added to every week automatically. Rotation: picked at random. Retired: skipped when
                    generating a week.
                  </p>
                </div>
              </div>

              <div className={formsStyles.sectionCard}>
                <div className={formsStyles.sectionCardHead}>Servings</div>
                <div className={formsStyles.sectionCardBody}>
                  <div className={formsStyles.qty}>
                    <button
                      type="button"
                      aria-label="Fewer servings"
                      onClick={() => setServings((s) => Math.max(1, (s ?? recipe.baseServings) - 1))}
                    >
                      <Minus size={16} aria-hidden="true" />
                    </button>
                    <span className={formsStyles.qtyValue}>
                      {servings ?? recipe.baseServings} <span className={formsStyles.qtyUnit}>servings</span>
                    </span>
                    <button
                      type="button"
                      aria-label="More servings"
                      onClick={() => setServings((s) => (s ?? recipe.baseServings) + 1)}
                    >
                      <Plus size={16} aria-hidden="true" />
                    </button>
                  </div>
                  <p className={formsStyles.hint}>
                    Base {recipe.baseServings} · surplus becomes a leftover lot when cooked.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}
