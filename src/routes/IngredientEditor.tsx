import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useWorkbookContext } from "../workbook-context.ts";
import { useToast } from "../ui/components/Toast/useToast.ts";
import { ErrorState, SegmentedControl, Skeleton } from "../ui/components";
import { PhotoField, type PhotoDraft } from "../ui/photo/index.ts";
import { IntegerField, TextField } from "./fields.tsx";
import { uniqueSlug } from "./slug.ts";
import { makeIngredientId, type Ingredient, type StorageLocation, type Unit } from "../domain/index.ts";
import { getPhotoDataUrl } from "../photos/index.ts";
import { applyPhotoDraft } from "./photo-save.ts";
import styles from "./forms.module.css";

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// "portion" is reserved for system-minted leftover lots (DESIGN.md §2
// "Servings, scaling & leftovers") — never offered when hand-adding a
// catalog ingredient.
const SELECTABLE_UNITS: readonly { value: Unit; label: string }[] = [
  { value: "g", label: "g" },
  { value: "ml", label: "ml" },
  { value: "piece", label: "piece" },
];

const LOCATIONS: readonly { value: StorageLocation; label: string }[] = [
  { value: "pantry", label: "Pantry" },
  { value: "fridge", label: "Fridge" },
  { value: "freezer", label: "Freezer" },
];

/** Create/edit one catalog ingredient (WP-20). There is no delete: `WorkbookStore.ingredients` only ever upserts (workbook-store.ts — Sheets has no row-delete primitive this app uses). */
export function IngredientEditor() {
  const { ingredientId } = useParams();
  const navigate = useNavigate();
  const { store, rng, clock } = useWorkbookContext();
  const { showToast } = useToast();
  const isNew = ingredientId === undefined;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [existingIds, setExistingIds] = useState<ReadonlySet<string>>(new Set());

  const [name, setName] = useState("");
  const [unit, setUnit] = useState<Unit>("g");
  const [location, setLocation] = useState<StorageLocation>("pantry");
  const [shelfLifeDays, setShelfLifeDays] = useState<number | null>(30);
  const [openedShelfLifeDays, setOpenedShelfLifeDays] = useState<number | null>(30);
  // Same "hint + local draft" shape as RecipeEditor's own recipe/step photo
  // fields — nothing writes to `Photos` until this form's own Save.
  const [initialHasPhoto, setInitialHasPhoto] = useState(false);
  const [photoDraft, setPhotoDraft] = useState<PhotoDraft>({ status: "unchanged" });

  useEffect(() => {
    // `loading`/`error` are only ever set from the promise's own
    // resolution below, never synchronously here (react-hooks'
    // set-state-in-effect rule) — their initial `useState` values already
    // cover the first mount.
    let cancelled = false;
    store.ingredients
      .readAll()
      .then((result) => {
        if (cancelled) return;
        setExistingIds(new Set(result.rows.map((i) => i.id)));
        if (!isNew) {
          const found = result.rows.find((i) => i.id === ingredientId);
          if (!found) {
            setError(`No ingredient with id "${ingredientId}".`);
            return;
          }
          setName(found.name);
          setUnit(found.unit);
          setLocation(found.defaultLocation);
          setShelfLifeDays(found.shelfLifeDays);
          setOpenedShelfLifeDays(found.openedShelfLifeDays);
          setInitialHasPhoto(found.hasPhoto ?? false);
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
  }, [store, ingredientId, isNew]);

  async function handleSave(): Promise<void> {
    if (name.trim() === "" || shelfLifeDays === null || openedShelfLifeDays === null) {
      showToast({ variant: "warning", title: "Fill in every field before saving." });
      return;
    }
    setSaving(true);
    try {
      const id = isNew ? makeIngredientId(uniqueSlug(name, existingIds, rng)) : makeIngredientId(ingredientId!);
      // Photo write first — see RecipeEditor.tsx's identical note on why
      // (never claim `hasPhoto: true` ahead of the row that backs it).
      const hasPhotoFinal = await applyPhotoDraft(store, clock, "ingredient", id, initialHasPhoto, photoDraft);
      const ingredient: Ingredient = {
        id,
        name: name.trim(),
        unit,
        shelfLifeDays,
        openedShelfLifeDays,
        defaultLocation: location,
        ...(hasPhotoFinal ? { hasPhoto: true } : {}),
      };
      await store.ingredients.upsert(ingredient);
      showToast({ variant: "success", title: `Saved "${ingredient.name}"`, durationMs: 4000 });
      navigate("/recipes/ingredients");
    } catch (err) {
      showToast({ variant: "error", title: "Couldn't save the ingredient", description: messageOf(err) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      <p>
        <Link to="/recipes/ingredients" className={styles.backLink}>
          &larr; Ingredients
        </Link>
      </p>
      <h1>{isNew ? "Add ingredient" : "Edit ingredient"}</h1>

      {loading ? <Skeleton /> : null}
      {!loading && error ? <ErrorState title="Couldn't load this ingredient" description={error} /> : null}
      {!loading && !error ? (
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            void handleSave();
          }}
        >
          <TextField label="Name" value={name} onChange={setName} required placeholder="e.g. Rolled oats" />

          <div className={styles.field}>
            <span className={styles.fieldLabel}>Photo</span>
            <PhotoField
              hasPhoto={initialHasPhoto}
              {...(!isNew
                ? { fetchPhoto: () => getPhotoDataUrl(store, "ingredient", makeIngredientId(ingredientId!)) }
                : {})}
              value={photoDraft}
              onChange={setPhotoDraft}
            />
          </div>

          <div className={styles.field}>
            <span>Canonical unit</span>
            <SegmentedControl<Unit> aria-label="Canonical unit" options={SELECTABLE_UNITS} value={unit} onChange={setUnit} />
          </div>

          <div className={styles.field}>
            <span>Default storage location</span>
            <SegmentedControl<StorageLocation>
              aria-label="Default storage location"
              options={LOCATIONS}
              value={location}
              onChange={setLocation}
            />
          </div>

          <div className={styles.row}>
            <IntegerField label="Shelf life" suffix="days" value={shelfLifeDays} onChange={setShelfLifeDays} required />
            <IntegerField
              label="Opened shelf life"
              suffix="days"
              value={openedShelfLifeDays}
              onChange={setOpenedShelfLifeDays}
              required
            />
          </div>

          <div className={styles.actions}>
            <button type="submit" className={styles.saveButton} disabled={saving}>
              {saving ? "Saving…" : "Save ingredient"}
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
