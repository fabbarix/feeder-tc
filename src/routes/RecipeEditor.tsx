import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useWorkbookContext } from "../workbook-context.ts";
import { useToast } from "../ui/components/Toast/useToast.ts";
import {
  ConfirmDialog,
  ErrorState,
  QuantityInput,
  SegmentedControl,
  SelectSheet,
  Skeleton,
  ToggleChips,
  Tooltip,
} from "../ui/components";
import { PhotoField, type PhotoDraft } from "../ui/photo/index.ts";
import { Plus, Trash } from "../ui/icons";
import {
  isIndivisible,
  makeIngredientId,
  makeQuantity,
  makeRecipeId,
  newRecipeId,
  newStepId,
  type EntryUnit,
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
import { convertEntryToCanonical } from "../domain/units.ts";
import { getPhotoDataUrl } from "../photos/index.ts";
import { applyPhotoDraft } from "./photo-save.ts";
import { ENTRY_UNIT_LABELS, gramsPreview, recipeEntryUnitsFor } from "./entry-units.ts";
import { TextField } from "./fields.tsx";
import { KIND_OPTIONS, MEAL_TAG_OPTIONS, SPLIT_OPTIONS, STATUS_OPTIONS, type SplitChoice } from "./recipe-options.ts";
import { uniqueSlug } from "./slug.ts";
import styles from "./forms.module.css";
import detailStyles from "./recipe-detail.module.css";
import stepStyles from "./recipe-steps.module.css";
import { describeError as messageOf } from "../sheets/error-messages.ts";
import type { RecipeImportDraft } from "./RecipeImport.tsx";

/**
 * Field-by-field comparison of the parts of a `Recipe` this editor actually
 * lets a person change — used only to detect "someone else's write landed
 * since this editor loaded", never persisted or sent anywhere. Deliberately
 * not a JSON.stringify/deep-equal of the whole object: two `Recipe`s built
 * from independent decodes can differ in key insertion order (conditional
 * `hasPhoto` spread) without differing in any value a save could clobber.
 */
function recipeContentEquals(a: Recipe, b: Recipe): boolean {
  return (
    a.name === b.name &&
    a.kind === b.kind &&
    a.baseServings === b.baseServings &&
    a.prepMinutes === b.prepMinutes &&
    a.cookMinutes === b.cookMinutes &&
    a.status === b.status &&
    (a.hasPhoto ?? false) === (b.hasPhoto ?? false) &&
    isIndivisible(a) === isIndivisible(b) &&
    a.mealTags.length === b.mealTags.length &&
    a.mealTags.every((tag, i) => tag === b.mealTags[i])
  );
}

interface LineDraft {
  readonly key: string;
  readonly ingredientId: IngredientId | null;
  readonly amount: number | null;
  /**
   * The unit this line's `amount` is typed in (§10) — defaults to the
   * ingredient's own canonical unit the moment an ingredient is picked, so
   * "no conversion" stays the common case. `null` only while no ingredient
   * is chosen yet.
   */
  readonly entryUnit: EntryUnit | null;
  /**
   * Recipe import only (DESIGN_RECIPE_IMPORT.md §4/§11) — display-only,
   * never saved: `true` when this line was pre-filled by the matcher's own
   * confident match, shown with a visibly different "matched from import"
   * marker so it never reads as more certain than it is (still editable,
   * not locked). `undefined` for every hand-typed or hand-picked line.
   */
  readonly importMatched?: boolean;
  /**
   * Recipe import only — what the model actually returned for this line
   * ("2 piece garlic"), shown as a hint under an UNMATCHED imported line so
   * the cook can see what to enter even though no ingredient is picked yet
   * (§10: "keeps the source text visible so a misread can be spotted").
   */
  readonly importRawText?: string;
}

/**
 * A step's `StepId` is required on `RecipeStep` (WP-PHOTO — DESIGN_PHOTOS.md
 * §3: a step without identity is the bug that widening closes), so a draft
 * carries one from the moment it exists — minted immediately for a new step
 * (`newStepId(rng)`), or kept as-is for a step loaded from an existing
 * recipe. `key` is a separate, purely-local React list key (same pattern as
 * `LineDraft.key` above); `id` is the identity that actually gets saved.
 *
 * `detail`/`durationMinutes` mirror `RecipeStep`'s own optional fields
 * (types.ts), represented here with draft-friendly defaults ("" / null)
 * instead of `undefined` — same "" -> undefined convention `name` already
 * uses elsewhere in this file. Carrying both all the way through load ->
 * state -> save is (part of) the fix for the round-trip data-loss bug this
 * file used to have: the old `StepDraft` only ever held `description`, so
 * re-saving a step through this editor silently dropped anything else a
 * step had ever been given (WP-PHOTO's own worry in DESIGN_PHOTOS.md §3
 * about a widened `RecipeStep` becoming real data loss the moment a UI could
 * populate it).
 *
 * `initialHasPhoto`/`photoDraft` are the step's photo: `initialHasPhoto` is
 * the hint this step loaded with (used to preview an existing photo and to
 * resolve "unchanged" at save), `photoDraft` is the local, unsaved edit a
 * `PhotoField` reports — same "nothing writes until Save" contract as every
 * other field here (see `PhotoField`'s own doc comment).
 */
interface StepDraft {
  readonly key: string;
  readonly id: StepId;
  readonly description: string;
  readonly detail: string;
  readonly durationMinutes: number | null;
  readonly initialHasPhoto: boolean;
  readonly photoDraft: PhotoDraft;
}

/** A brand-new step draft, minting a fresh `StepId` immediately (see `StepDraft`'s own doc comment for why). */
function emptyStepDraft(key: string, rng: Rng): StepDraft {
  return {
    key,
    id: newStepId(rng),
    description: "",
    detail: "",
    durationMinutes: null,
    initialHasPhoto: false,
    photoDraft: { status: "unchanged" },
  };
}

/** Create/edit a recipe — cooked or bought (WP-20). Bought recipes force prepMinutes to 0 and link a single "piece" catalog ingredient for the product itself (DESIGN.md §2 "Recipes"). */
export function RecipeEditor() {
  const { recipeId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { store, rng, clock } = useWorkbookContext();
  const { showToast } = useToast();
  const isNew = recipeId === undefined;
  const lineKeyCounter = useRef(0);
  const stepKeyCounter = useRef(0);
  // DESIGN_RECIPE_IMPORT.md §11: pre-fills THIS editor rather than a second
  // screen — "the review screen is the existing RecipeEditor, pre-filled".
  // Captured once via a lazy `useState` initializer (never set again after
  // mount, so it behaves like a stable value) from router state
  // (`RecipeImport.tsx`'s navigate call) — not a `useRef`, which
  // `react-hooks/refs` forbids reading during render.
  const [importDraft] = useState(() =>
    isNew ? ((location.state as { importedDraft?: RecipeImportDraft } | null)?.importedDraft ?? undefined) : undefined,
  );
  const [showImportSource, setShowImportSource] = useState(true);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  // WP-30: the row as this editor last read it — compared against a fresh
  // read at save time to detect a stale save (HANDOVER §4's plain-row LWW
  // deliberately never locks or blocks a write, but silently overwriting a
  // concurrent household member's edit with no warning at all is a
  // different, worse thing than "last write wins": nobody who did that
  // second write ever knew a conflict happened). `undefined` for a brand
  // new recipe, which has no prior row to go stale against.
  const loadedRecipeRef = useRef<Recipe | undefined>(undefined);
  const [staleConflict, setStaleConflict] = useState<Recipe | undefined>(undefined);
  // UA review findings #3b/#4: neither "no meal tags" nor "nothing to cook
  // from" ever blocked Save (and shouldn't — both are legitimate states for
  // a recipe someone means to finish later), but neither said anything
  // either, so the consequence only ever surfaced later, somewhere else
  // entirely (a "Pick a meal" sheet with no explanation, or a shopping list
  // silently missing a recipe's ingredients). A nudge dialog at the moment
  // that matters — Save — makes the consequence visible without making
  // either field mandatory. `undefined` when neither nudge is pending.
  const [pendingNudge, setPendingNudge] = useState<"no-tags" | "empty" | undefined>(undefined);

  const [ingredientsCatalog, setIngredientsCatalog] = useState<readonly Ingredient[]>([]);
  const [linkedIngredientId, setLinkedIngredientId] = useState<IngredientId | undefined>(undefined);

  const [name, setName] = useState(() => importDraft?.parsed.name ?? "");
  const [kind, setKind] = useState<RecipeKind>("cooked");
  const [status, setStatus] = useState<RecipeStatus>("in-rotation");
  const [baseServings, setBaseServings] = useState<number | null>(() => importDraft?.parsed.servings ?? 4);
  const [prepMinutes, setPrepMinutes] = useState<number | null>(() => importDraft?.parsed.prepMinutes ?? 15);
  const [cookMinutes, setCookMinutes] = useState<number | null>(() => importDraft?.parsed.cookMinutes ?? 30);
  const [mealTags, setMealTags] = useState<readonly MealTag[]>([]);
  // "Can't be split" (DESIGN_PURCHASING.md §4/§8) — pre-checked for Bought,
  // matching `Recipe.indivisible`'s own default (`kind === "bought"`).
  // `null` means "still following Kind" (never touched this session, or
  // loaded from a row whose `indivisible` was never made explicit) —
  // derived at render time from `kind`, same pattern as `displayedPrepMinutes`
  // below, rather than a synced-by-effect boolean: a `setState` inside a
  // `useEffect` purely to mirror another piece of state is exactly the
  // cascading-render smell `react-hooks/set-state-in-effect` flags, and a
  // plain derived value needs no effect at all.
  const [indivisibleOverride, setIndivisibleOverride] = useState<boolean | null>(null);
  const indivisible = indivisibleOverride ?? kind === "bought";
  // The recipe's own photo — same "hint + local draft" shape as a step's
  // (see `StepDraft`'s doc comment).
  const [recipeInitialHasPhoto, setRecipeInitialHasPhoto] = useState(false);
  const [recipePhotoDraft, setRecipePhotoDraft] = useState<PhotoDraft>({ status: "unchanged" });
  const [lines, setLines] = useState<readonly LineDraft[]>(() =>
    importDraft
      ? importDraft.lines.map((resolved): LineDraft => {
          // Tolerant parsing (owner's 2026-08-25 report): a matched line
          // still carries whatever `note` the model returned — including a
          // unit word `normalize.ts` couldn't represent (e.g. "cloves")
          // and folded into `rawNote` instead of dropping. An unmatched
          // line already shows all of this via "As read" below; a MATCHED
          // line otherwise shows nothing but the ingredient/amount picker,
          // which would make that same coercion invisible the moment a
          // name happens to match the catalogue — exactly the "silent"
          // outcome the owner's brief rules out. Shown distinctly from "As
          // read" (that phrase implies "this whole line is unresolved",
          // which a matched line isn't).
          const importRawText =
            resolved.ingredientId === null
              ? (resolved.conversionNote ??
                `As read: "${[resolved.amount, resolved.entryUnit, resolved.rawName].filter((part) => part !== null && part !== "").join(" ")}${resolved.rawNote ? ` (${resolved.rawNote})` : ""}"`)
              : resolved.rawNote.trim() !== ""
                ? `Imported note: "${resolved.rawNote}"`
                : undefined;
          return {
            key: resolved.key,
            ingredientId: resolved.ingredientId,
            amount: resolved.ingredientId !== null ? resolved.amount : null,
            entryUnit: resolved.ingredientId !== null ? resolved.entryUnit : null,
            importMatched: resolved.matched,
            ...(importRawText !== undefined ? { importRawText } : {}),
          };
        })
      : [],
  );
  // Fixed literal key, not the ref-backed counter below: reading a ref
  // during render (even just to seed useState's lazy initializer) trips
  // react-hooks' "refs are for effects/handlers, not render" rule. This
  // runs exactly once regardless, so a hardcoded key is no less unique than
  // one drawn from the counter would have been.
  const [steps, setSteps] = useState<readonly StepDraft[]>(() =>
    importDraft && importDraft.parsed.steps.length > 0
      ? importDraft.parsed.steps.map((step, index) => ({
          ...emptyStepDraft(`import-step-${index}`, rng),
          description: step.description,
        }))
      : [emptyStepDraft("initial-step", rng)],
  );

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
          loadedRecipeRef.current = found;
          setName(found.name);
          setKind(found.kind);
          setStatus(found.status);
          setBaseServings(found.baseServings);
          setPrepMinutes(found.prepMinutes);
          setCookMinutes(found.cookMinutes);
          setMealTags(found.mealTags);
          setRecipeInitialHasPhoto(found.hasPhoto ?? false);
          // `null` (keep following `kind`) unless this row already made a
          // choice explicit — see `indivisibleOverride`'s own doc comment.
          setIndivisibleOverride(found.indivisible !== undefined ? isIndivisible(found) : null);

          const ownLines = linesResult.rows.filter((l) => l.recipeId === recipeId);
          if (found.kind === "bought") {
            setLinkedIngredientId(ownLines[0]?.ingredientId);
          } else {
            setLines(
              ownLines.map((l) => {
                // §10.5: a line saved with an entry-time conversion carries
                // `displayQuantity`/`displayUnit` forward as provenance —
                // what the recipe author actually typed, never read by any
                // engine. A line with neither (the common case, saved
                // before this package or simply typed in the ingredient's
                // own canonical unit) falls back to the canonical amount in
                // the ingredient's own unit — i.e. "no conversion happened".
                const ingredient = ingredientsResult.rows.find((i) => i.id === l.ingredientId);
                return {
                  key: `existing-${(lineKeyCounter.current += 1)}`,
                  ingredientId: l.ingredientId,
                  amount: l.displayQuantity ?? l.quantity.amount,
                  // "portion" (a `Unit`, not an `EntryUnit` — leftover-lots
                  // only, never a recipe ingredient's canonical unit in
                  // practice) falls back to "g" rather than widening
                  // `EntryUnit`'s type for a case that can't really occur.
                  entryUnit: l.displayUnit ?? (ingredient && ingredient.unit !== "portion" ? ingredient.unit : "g"),
                };
              }),
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
                  initialHasPhoto: s.hasPhoto ?? false,
                  photoDraft: { status: "unchanged" as const },
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
            title: `${warningCount} ${warningCount === 1 ? "entry" : "entries"} skipped while loading`,
            description: "Some saved data didn't match what we expected, so it was left out.",
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
      { key: `new-${lineKeyCounter.current}`, ingredientId: null, amount: null, entryUnit: null },
    ]);
  }

  function removeLine(key: string): void {
    setLines((current) => current.filter((l) => l.key !== key));
  }

  function setLineIngredient(key: string, ingredientId: IngredientId): void {
    // Default the entry unit to the newly-chosen ingredient's own canonical
    // unit (§10: "no conversion" is the common case) — never `null` once an
    // ingredient is picked, so the unit chip always has something to show.
    const chosen = ingredientsCatalog.find((i) => i.id === ingredientId);
    const entryUnit: EntryUnit = chosen && chosen.unit !== "portion" ? chosen.unit : "g";
    setLines((current) =>
      current.map((l) => (l.key === key ? { ...l, ingredientId, amount: null, entryUnit } : l)),
    );
  }

  function setLineAmount(key: string, amount: number | null): void {
    setLines((current) => current.map((l) => (l.key === key ? { ...l, amount } : l)));
  }

  /**
   * Changing only the unit (not the ingredient) keeps whatever amount was
   * already typed — the household is re-interpreting the same number in a
   * different unit ("2" was grams, now it's cups), not clearing the field.
   */
  function setLineEntryUnit(key: string, entryUnit: EntryUnit): void {
    setLines((current) => current.map((l) => (l.key === key ? { ...l, entryUnit } : l)));
  }

  function addStep(): void {
    stepKeyCounter.current += 1;
    setSteps((current) => [...current, emptyStepDraft(`new-${stepKeyCounter.current}`, rng)]);
  }

  function updateStep(index: number, description: string): void {
    setSteps((current) => current.map((s, i) => (i === index ? { ...s, description } : s)));
  }

  function updateStepDetail(index: number, detail: string): void {
    setSteps((current) => current.map((s, i) => (i === index ? { ...s, detail } : s)));
  }

  function updateStepDuration(index: number, durationMinutes: number | null): void {
    setSteps((current) => current.map((s, i) => (i === index ? { ...s, durationMinutes } : s)));
  }

  function updateStepPhoto(index: number, photoDraft: PhotoDraft): void {
    setSteps((current) => current.map((s, i) => (i === index ? { ...s, photoDraft } : s)));
  }

  function removeStep(index: number): void {
    setSteps((current) => current.filter((_, i) => i !== index));
  }

  async function handleSave(force = false, skipTagsNudge = false, skipEmptyNudge = false): Promise<void> {
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

    // #3b: no meal tags means this recipe can never be picked for a meal —
    // not by "Generate week" (candidatesForSlot filters on tag), and not
    // from the "Pick a meal" sheet, which just says "No recipes for this
    // meal yet" with no hint that a taggable recipe exists but isn't
    // tagged. Checked before the emptiness nudge below so the two never
    // show at once — confirming this one re-runs handleSave, which then
    // checks the next.
    if (!skipTagsNudge && mealTags.length === 0) {
      setPendingNudge("no-tags");
      return;
    }

    // #4: a cooked recipe with no ingredient lines and no non-blank step is
    // saved as a name and nothing else — it contributes nothing to a
    // shopping list and can't actually be cooked from. The partial-line
    // check above already refuses a HALF-filled ingredient row; this is the
    // matching guard for the "not even started" case that check can't
    // catch, as a nudge rather than a block (someone saving a placeholder
    // to finish later is legitimate). Bought recipes are exempt — they have
    // no manual ingredient lines or steps to fill in the first place.
    if (
      !skipEmptyNudge &&
      kind === "cooked" &&
      lines.length === 0 &&
      !steps.some((s) => s.description.trim() !== "")
    ) {
      setPendingNudge("empty");
      return;
    }

    setSaving(true);
    try {
      // Stale-save check, before ANY write below (photos included) — a
      // household member editing the same recipe on another device may
      // have saved since this editor loaded. Skipped for a brand-new
      // recipe (no prior row to have gone stale) and on the confirmed
      // "Save anyway" retry (`force`). Deliberately a full re-read rather
      // than a cheap version/etag check: HANDOVER §4 amendment 3 is the
      // only sanctioned exception to "no version columns", and it is
      // scoped to units, not this.
      if (!isNew && !force) {
        const latest = await store.recipes.readAll();
        const current = latest.rows.find((r) => r.id === recipeId);
        const loaded = loadedRecipeRef.current;
        if (current && loaded && !recipeContentEquals(current, loaded)) {
          setSaving(false);
          setStaleConflict(current);
          return;
        }
      }

      const id = isNew ? newRecipeId(rng) : makeRecipeId(recipeId!);

      // Steps with a blank instruction are dropped entirely below (existing
      // behaviour, unchanged) — resolved here, BEFORE any photo write, so a
      // dropped step's photo is cleaned up rather than orphaned in the
      // `Photos` sheet under an id no `RecipeStep` row references any more.
      const trimmedSteps = steps.map((s) => ({ ...s, description: s.description.trim(), detail: s.detail.trim() }));
      const survivingSteps = trimmedSteps.filter((s) => s.description !== "");
      const droppedSteps = trimmedSteps.filter((s) => s.description === "");

      // Photo writes happen first, before the rows that CLAIM a photo
      // exists (`hasPhoto: true`) — so a reader never sees the flag land
      // ahead of the actual `Photos` row (WP-PHOTO UI). Nothing here writes
      // until this Save, matching every other field on this form —
      // `PhotoField`'s own doc comment.
      const recipeHasPhotoFinal = await applyPhotoDraft(
        store,
        clock,
        "recipe",
        id,
        recipeInitialHasPhoto,
        recipePhotoDraft,
      );
      const stepHasPhotoById = new Map(
        await Promise.all(
          survivingSteps.map(
            async (s) =>
              [s.id, await applyPhotoDraft(store, clock, "recipe-step", s.id, s.initialHasPhoto, s.photoDraft)] as const,
          ),
        ),
      );
      await Promise.all(
        droppedSteps.filter((s) => s.initialHasPhoto).map((s) => store.photos.remove("recipe-step", s.id)),
      );

      const finalPrepMinutes = kind === "bought" ? 0 : (prepMinutes ?? 0);
      // "Can't be split": only made explicit when the household has touched
      // it this session (`indivisibleOverride !== null`) — untouched,
      // `indivisible` already equals the derived default (§4: "absent ⇒
      // kind === 'bought'") and can stay implicit, the same "don't freeze a
      // default that would otherwise keep deriving" reasoning
      // `IngredientEditor.tsx` applies to `purchaseMode`.
      const recipe: Recipe = {
        id,
        name: name.trim(),
        kind,
        baseServings,
        prepMinutes: finalPrepMinutes,
        cookMinutes,
        mealTags,
        status,
        ...(recipeHasPhotoFinal ? { hasPhoto: true } : {}),
        ...(indivisibleOverride !== null ? { indivisible: indivisibleOverride } : {}),
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
        // §10: a line typed in the ingredient's own canonical unit needs no
        // conversion at all (the common case, and every line saved before
        // this package) — `quantity` is just `{ amount, unit }` directly,
        // with no `displayQuantity`/`displayUnit` provenance to carry
        // (nothing was converted, so there's nothing to attribute). A line
        // typed in a different `EntryUnit` (a cup of flour, two pounds of
        // mince) is converted exactly once, here, via `units.ts` — the sole
        // sanctioned conversion module — and keeps what was actually typed
        // as provenance alongside the canonical amount arithmetic uses.
        try {
          recipeLines = lines
            .filter(
              (l): l is LineDraft & { ingredientId: IngredientId; amount: number } =>
                l.ingredientId !== null && l.amount !== null,
            )
            .map((l) => {
              const ingredient = ingredientsCatalog.find((i) => i.id === l.ingredientId);
              const unit = ingredient && ingredient.unit !== "portion" ? ingredient.unit : "g";
              const entryUnit: EntryUnit = l.entryUnit ?? unit;
              if (entryUnit === unit) {
                return { recipeId: id, ingredientId: l.ingredientId, quantity: makeQuantity(l.amount, unit) };
              }
              const density = ingredient
                ? {
                    ...(ingredient.gramsPerMl !== undefined ? { gramsPerMl: ingredient.gramsPerMl } : {}),
                    ...(ingredient.gramsPerPiece !== undefined ? { gramsPerPiece: ingredient.gramsPerPiece } : {}),
                  }
                : {};
              const quantity = convertEntryToCanonical({ amount: l.amount, unit: entryUnit }, unit, density);
              return {
                recipeId: id,
                ingredientId: l.ingredientId,
                quantity,
                displayQuantity: l.amount,
                displayUnit: entryUnit,
              };
            });
        } catch (err) {
          // `finally` below still resets `saving` — no need to do it here too.
          showToast({ variant: "error", title: "Couldn't convert an ingredient amount", description: messageOf(err) });
          return;
        }
      }

      // WP-PHOTO round-trip fix: `detail`/`durationMinutes`/`hasPhoto` are
      // carried through from `StepDraft` here instead of being dropped —
      // this is the actual fix for the bug this file used to have (see
      // `StepDraft`'s doc comment above). `detail`/`durationMinutes` fold
      // back to `undefined` when blank/null, same "absent, not empty" shape
      // `RecipeStep`'s own optional fields expect.
      const recipeSteps: readonly RecipeStep[] = survivingSteps.map((s, index) => ({
        recipeId: id,
        id: s.id,
        stepNumber: index + 1,
        description: s.description,
        ...(s.detail !== "" ? { detail: s.detail } : {}),
        ...(s.durationMinutes !== null ? { durationMinutes: s.durationMinutes } : {}),
        ...(stepHasPhotoById.get(s.id) ? { hasPhoto: true } : {}),
      }));

      await store.recipes.upsert(recipe);
      await store.recipeIngredients.replaceForRecipe(id, recipeLines);
      await store.recipeSteps.replaceForRecipe(id, recipeSteps);

      // No success toast (UX review round 2, "quieten the toasts"): this
      // navigates straight to /recipes, where the saved card is already the
      // confirmation. (The "bought" kind used to add a description noting
      // the linked catalog ingredient — a real side effect, but a minor
      // implementation detail rather than something worth a toast of its
      // own; nothing stops it coming back as a smaller, separate surface if
      // that turns out to matter.)
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
      {/* One exit affordance per screen (pattern audit #3): a breadcrumb
          link above the heading, same place/weight as every other detail
          and editor screen (RecipeDetail.tsx, IngredientEditor.tsx,
          ProductDetail.tsx, PantryItem.tsx) — not a second, equally-weighted
          "Cancel" pill beside Save, which used to live in the top bar below
          and read as two competing primary actions. */}
      <p>
        <Link to={cancelTo} className={styles.backLink}>
          &larr; Cancel
        </Link>
      </p>
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
              <button type="submit" className={styles.saveButton} disabled={saving}>
                {saving ? "Saving…" : "Save recipe"}
              </button>
            </div>
          </div>

          {/* DESIGN_RECIPE_IMPORT.md §10/§11: "keeps the original pasted
              text visible side-by-side with the draft" — the dangerous
              failure here is a misread quantity, not a hallucinated
              ingredient, and the cook's own read of the source is the only
              real check for either. Open by default the first time (§11),
              collapsible so it doesn't crowd the rest of the review once
              checked. */}
          {/* A photo import has no pasted text or fetched-page source to
              show here — its source is the photo(s) themselves, rendered
              instead right beside the ingredient lines below (this file's
              "Check the amounts below against the photo" gallery), which is
              the more useful place to compare a quantity than a text panel
              at the top of the screen. */}
          {importDraft && !importDraft.photos ? (
            <div className={styles.sectionCard}>
              <button
                type="button"
                className={`${styles.sectionCardHead} ${styles.importSourceToggle}`}
                aria-expanded={showImportSource}
                onClick={() => setShowImportSource((v) => !v)}
              >
                {importDraft.sourceText.trim() !== "" ? "What you pasted" : "Where this came from"}{" "}
                {showImportSource ? "▾" : "▸"}
              </button>
              {showImportSource ? (
                <div className={styles.sectionCardBody}>
                  {importDraft.sourceUrl ? (
                    <p className={styles.hint}>Source: {importDraft.sourceUrl}</p>
                  ) : null}
                  <p className={styles.hint}>
                    Compare this against the draft below — quantities are the easiest thing to misread.
                  </p>
                  {importDraft.sourceText.trim() !== "" ? (
                    <pre className={`${stepStyles.detailTextarea} ${styles.importSourceText}`}>{importDraft.sourceText}</pre>
                  ) : (
                    <p className={styles.hint}>
                      Feeder opened the address above itself and read the recipe from it — there&rsquo;s no pasted
                      text to compare, so check the draft below carefully against the page.
                    </p>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Tolerant parsing (owner's 2026-08-25 report): every shape-fix
              `normalize.ts` applied before this draft could even validate —
              a stripped code fence, a "title" read as the name, a unit
              outside our enum kept as a note instead of dropped, a missing
              note left blank — surfaces here, always open, never behind a
              disclosure the way the diagnostic history is. "Every coercion
              must be visible in the review screen, not silent" (owner's own
              words): this is that visibility. Absent entirely when the
              reply matched the schema exactly, so a clean import shows
              nothing extra at all. */}
          {importDraft && importDraft.parsed.coercions.length > 0 ? (
            <div className={styles.sectionCard}>
              <div className={styles.sectionCardHead}>Feeder had to fix up this reply</div>
              <div className={styles.sectionCardBody}>
                <p className={styles.hint}>
                  The address you use didn&rsquo;t quite answer the way Feeder asked — nothing here was invented,
                  only reshaped. Check it against the draft below.
                </p>
                <ul className={styles.importCoercionList}>
                  {importDraft.parsed.coercions.map((coercion, index) => (
                    <li key={index} className={styles.hint}>
                      {coercion}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}

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
                  {/* Photo sits right after Name, before Meal tags — identity
                      is what a recipe is called, what it looks like, and how
                      it's tagged (mock-responsive.html's own "Editing a
                      recipe" note). */}
                  <div className={styles.field}>
                    <span className={styles.fieldLabel}>Photo</span>
                    <PhotoField
                      hasPhoto={recipeInitialHasPhoto}
                      {...(!isNew
                        ? { fetchPhoto: () => getPhotoDataUrl(store, "recipe", makeRecipeId(recipeId!)) }
                        : {})}
                      value={recipePhotoDraft}
                      onChange={setRecipePhotoDraft}
                    />
                  </div>
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
                    {/* DESIGN_RECIPE_IMPORT_PHOTO.md's single most important
                        review-screen requirement: "make quantities the most
                        scrutinised thing on the review screen, with the
                        image visible beside them" — no per-field confidence
                        signal exists for a photo import (the shared schema
                        deliberately has none), so the source photo itself is
                        the backstop, shown right here next to the amounts
                        it's meant to be checked against. */}
                    {importDraft?.photos && importDraft.photos.length > 0 ? (
                      <>
                        <p className={styles.hint}>Check the amounts below against the photo.</p>
                        <div className={styles.reviewPhotoGallery}>
                          {importDraft.photos.map((photoUrl, index) => (
                            <img
                              key={index}
                              src={photoUrl}
                              alt={`Page ${index + 1} of the recipe you photographed`}
                              className={styles.reviewPhotoGalleryImg}
                            />
                          ))}
                        </div>
                      </>
                    ) : null}
                    {lines.length === 0 ? (
                      <p className={styles.hint}>No ingredient lines yet.</p>
                    ) : null}
                    {lines.map((line) => {
                      const ingredient = ingredientsCatalog.find((i) => i.id === line.ingredientId);
                      const canonicalUnit = ingredient && ingredient.unit !== "portion" ? ingredient.unit : "g";
                      const entryUnit: EntryUnit = line.entryUnit ?? canonicalUnit;
                      // §10: the unit chip opens a picker of only the units
                      // THIS ingredient can accept — never a fixed list, so
                      // a unit needing a conversion constant the ingredient
                      // doesn't have (§10.1) simply isn't offered.
                      const entryUnitOptions = (ingredient ? recipeEntryUnitsFor(ingredient) : []).map((u) => ({
                        value: u,
                        label: ENTRY_UNIT_LABELS[u],
                      }));
                      const preview =
                        ingredient && line.amount !== null ? gramsPreview(line.amount, entryUnit, ingredient) : undefined;
                      return (
                        <div key={line.key}>
                          {/* DESIGN_RECIPE_IMPORT.md §4/§11: a confident
                              match pre-fills the picker but is never shown
                              as more certain than "this is a fill-in, still
                              check it" — the badge, not a lock. */}
                          {line.importMatched ? (
                            <p className={styles.hint}>
                              <span className={styles.importMatchedBadge}>Matched from import</span>
                            </p>
                          ) : null}
                          {line.importRawText ? <p className={styles.hint}>{line.importRawText}</p> : null}
                          <div className={styles.line}>
                            <SelectSheet
                              label="Ingredient"
                              options={ingredientOptions}
                              value={line.ingredientId}
                              onChange={(value) => setLineIngredient(line.key, value)}
                              placeholder="Choose an ingredient…"
                            />
                            <QuantityInput<EntryUnit>
                              label="Amount"
                              unit={entryUnit}
                              value={line.amount}
                              onChange={(q) => setLineAmount(line.key, q?.amount ?? null)}
                              disabled={line.ingredientId === null}
                              required
                            />
                            {entryUnitOptions.length > 1 ? (
                              <SelectSheet<EntryUnit>
                                label="Unit"
                                options={entryUnitOptions}
                                value={entryUnit}
                                onChange={(value) => setLineEntryUnit(line.key, value)}
                              />
                            ) : null}
                            <Tooltip label="Remove ingredient line">
                              <button
                                type="button"
                                className={styles.removeButton}
                                onClick={() => removeLine(line.key)}
                                aria-label="Remove ingredient line"
                              >
                                <Trash size={18} aria-hidden="true" />
                              </button>
                            </Tooltip>
                          </div>
                          {/* §10.5: "1 cup flour (130 g)" — the household
                              sees both what they typed and the canonical
                              number the app is actually reasoning about. */}
                          {preview !== undefined && ingredient ? (
                            <p className={styles.hint}>
                              {line.amount} {ENTRY_UNIT_LABELS[entryUnit]} {ingredient.name.toLowerCase()} (
                              {Math.round(preview * 10) / 10} g)
                            </p>
                          ) : null}
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

              {/* One card per step — instruction, duration, photo and
                  detail, never all required (mock-responsive.html's own
                  "Editing a recipe" note). Reordering/adding/deleting steps
                  preserves each step's own `id` (StepDraft.id), never
                  recomputed from position — `stepNumber` is assigned fresh
                  at Save from array order, but photos key on `id`
                  (DESIGN_PHOTOS.md §3), so deleting step 2 of five must not
                  reassign steps 3-5's photos onto the wrong instructions. */}
              <div className={styles.sectionCard}>
                <div className={styles.sectionCardHead}>Steps</div>
                <div className={styles.sectionCardBody}>
                  {steps.map((step, index) => (
                    <div className={stepStyles.stepCard} key={step.key}>
                      <div className={stepStyles.stepCardHead}>
                        <span className={stepStyles.stepCardNum}>Step {index + 1}</span>
                        <Tooltip label={`Remove step ${index + 1}`}>
                          <button
                            type="button"
                            className={styles.removeButton}
                            onClick={() => removeStep(index)}
                            aria-label={`Remove step ${index + 1}`}
                          >
                            <Trash size={18} aria-hidden="true" />
                          </button>
                        </Tooltip>
                      </div>
                      <TextField
                        label="Instruction"
                        value={step.description}
                        onChange={(text) => updateStep(index, text)}
                        placeholder="e.g. 375 degrees, 30 min covered"
                      />
                      <div className={stepStyles.stepCardRow}>
                        <QuantityInput<"min">
                          label="Duration"
                          unit="min"
                          value={step.durationMinutes}
                          onChange={(q) => updateStepDuration(index, q?.amount ?? null)}
                          showSteppers
                        />
                        <div className={styles.field}>
                          <span className={styles.fieldLabel}>Photo</span>
                          <PhotoField
                            hasPhoto={step.initialHasPhoto}
                            fetchPhoto={() => getPhotoDataUrl(store, "recipe-step", step.id)}
                            value={step.photoDraft}
                            onChange={(draft) => updateStepPhoto(index, draft)}
                            label="Add"
                            aspectRatio="2.4 / 1"
                          />
                        </div>
                      </div>
                      <div className={styles.field}>
                        <span className={styles.fieldLabel}>
                          Detail <span className={stepStyles.optional}>(markdown, optional)</span>
                        </span>
                        <textarea
                          className={stepStyles.detailTextarea}
                          rows={2}
                          value={step.detail}
                          onChange={(event) => updateStepDetail(index, event.target.value)}
                          placeholder="Extra tips, why it matters…"
                          aria-label={`Step ${index + 1} detail (markdown, optional)`}
                        />
                      </div>
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
                    {/* Named for the question ("how does this recipe scale?"),
                        not for either answer — a group whose accessible name
                        repeats one of its own options is unannounceable by a
                        screen reader ("Can't be split, group" ... "Can't be
                        split, radio"). SPLIT_OPTIONS (recipe-options.ts) also
                        shortens "Splits into portions" to "Splits" so both
                        options render on one line. */}
                    <span className={styles.fieldLabel}>Splitting</span>
                    <SegmentedControl<SplitChoice>
                      aria-label="Splitting"
                      options={SPLIT_OPTIONS}
                      value={indivisible ? "cant" : "splits"}
                      onChange={(value) => setIndivisibleOverride(value === "cant")}
                    />
                    <p className={styles.hint}>Scales in whole units — extras become leftovers.</p>
                  </div>
                  <div className={styles.field}>
                    <span className={styles.fieldLabel}>Use in planning</span>
                    <div className={styles.fullWidthControl}>
                      <SegmentedControl<RecipeStatus>
                        aria-label="Use in planning"
                        options={STATUS_OPTIONS}
                        value={status}
                        onChange={setStatus}
                      />
                    </div>
                    <p className={styles.hint}>
                      Staple: added to every week automatically. Rotation: picked at random. Retired: skipped when
                      generating a week.
                    </p>
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
                    unitOne="serving"
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
      <ConfirmDialog
        open={staleConflict !== undefined}
        title="This recipe changed elsewhere"
        description={
          staleConflict
            ? `Someone else saved "${staleConflict.name}" since you opened it. Saving now overwrites their changes with yours.`
            : undefined
        }
        confirmLabel="Save anyway"
        cancelLabel="Keep editing"
        destructive
        onConfirm={() => {
          setStaleConflict(undefined);
          void handleSave(true);
        }}
        onCancel={() => setStaleConflict(undefined)}
      />
      <ConfirmDialog
        open={pendingNudge === "no-tags"}
        title="No meal tags"
        description='Without a breakfast, lunch, dinner or snack tag, this recipe never appears in "Generate week" or the "Pick a meal" sheet. Save it untagged anyway?'
        confirmLabel="Save anyway"
        cancelLabel="Add a tag"
        onConfirm={() => {
          setPendingNudge(undefined);
          void handleSave(false, true, false);
        }}
        onCancel={() => setPendingNudge(undefined)}
      />
      <ConfirmDialog
        open={pendingNudge === "empty"}
        title="Nothing to cook from yet"
        description="This recipe has no ingredients and no steps — it won't add anything to a shopping list or show how to cook it. Save it as a placeholder anyway?"
        confirmLabel="Save anyway"
        cancelLabel="Keep editing"
        onConfirm={() => {
          setPendingNudge(undefined);
          void handleSave(false, true, true);
        }}
        onCancel={() => setPendingNudge(undefined)}
      />
    </section>
  );
}
