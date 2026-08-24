import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useWorkbookContext } from "../workbook-context.ts";
import { useToast } from "../ui/components/Toast/useToast.ts";
import { ConfirmDialog, ErrorState, QuantityInput, SegmentedControl, Skeleton } from "../ui/components";
import { PhotoField, type PhotoDraft } from "../ui/photo/index.ts";
import { IntegerField, TextField } from "./fields.tsx";
import { uniqueSlug } from "./slug.ts";
import { makeIngredientId, makeQuantity, type Ingredient, type PurchaseMode, type Quantity, type StorageLocation, type Unit } from "../domain/index.ts";
import { getPhotoDataUrl } from "../photos/index.ts";
import { applyPhotoDraft } from "./photo-save.ts";
import styles from "./forms.module.css";

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function quantityEquals(a: Quantity | undefined, b: Quantity | undefined): boolean {
  if (a === undefined && b === undefined) return true;
  if (a === undefined || b === undefined) return false;
  return a.amount === b.amount && a.unit === b.unit;
}

/**
 * Mirrors `defaultPurchaseMode`'s own §3 derivation
 * (`src/domain/purchasing.ts`) for a draft that isn't a full `Ingredient`
 * yet — kept here as the same two-branch literal rather than constructing a
 * throwaway `Ingredient` just to satisfy that function's signature. Not a
 * unit conversion (invariant 3 doesn't apply to purchase-mode defaulting);
 * if the domain rule ever changes, update both.
 */
function derivedPurchaseMode(unit: Unit): PurchaseMode {
  return unit === "piece" || unit === "portion" ? "whole" : "loose";
}

/**
 * Field-by-field comparison of the parts of an `Ingredient` this editor
 * actually lets a person change — same shape and same reason as
 * `RecipeEditor.tsx`'s `recipeContentEquals` (WP-30, the reference pattern
 * for this stale-save workstream): detects "someone else's write landed
 * since this editor loaded" without tripping on incidental structural
 * differences (e.g. `hasPhoto` present-vs-absent-and-false).
 *
 * WP-purchasing-editor widened this to cover every field the new "How you
 * buy it"/"How you measure it" groups can now change — before this package,
 * those fields (plus `category`/`roundTo`, which this editor still has no
 * UI for) weren't compared here AND weren't carried forward on save either,
 * so editing an ingredient's name and saving silently wiped its category and
 * purchasability data out from under a concurrent household member. Fixed
 * below in `handleSave` by spreading the loaded row forward; extending the
 * comparison here is the other half of the same fix — a concurrent edit to
 * any of these fields must still surface as a conflict, not a silent loss.
 */
function ingredientContentEquals(a: Ingredient, b: Ingredient): boolean {
  return (
    a.name === b.name &&
    a.unit === b.unit &&
    a.defaultLocation === b.defaultLocation &&
    a.shelfLifeDays === b.shelfLifeDays &&
    a.openedShelfLifeDays === b.openedShelfLifeDays &&
    (a.hasPhoto ?? false) === (b.hasPhoto ?? false) &&
    (a.category ?? undefined) === (b.category ?? undefined) &&
    (a.purchaseMode ?? derivedPurchaseMode(a.unit)) === (b.purchaseMode ?? derivedPurchaseMode(b.unit)) &&
    quantityEquals(a.packSize, b.packSize) &&
    (a.roundTo ?? null) === (b.roundTo ?? null) &&
    (a.gramsPerMl ?? null) === (b.gramsPerMl ?? null) &&
    (a.gramsPerPiece ?? null) === (b.gramsPerPiece ?? null) &&
    (a.packLabel ?? "") === (b.packLabel ?? "")
  );
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

const PURCHASE_MODE_OPTIONS: readonly { value: PurchaseMode; label: string }[] = [
  { value: "whole", label: "Whole" },
  { value: "loose", label: "Loose" },
];

/**
 * `1 cup weighs 130 g` → placeholder text "130" — rounds to one decimal
 * place to trim float noise from `gramsPerMl * 240` (e.g. `0.5417 * 240 =
 * 130.008`) without inventing false precision. `String()` on a JS number
 * never carries a trailing ".0" (`String(130)` is `"130"`, not `"130.0"`),
 * so this needs no separate integer-vs-decimal branch.
 */
function formatPlaceholder(amount: number): string {
  return String(Math.round(amount * 10) / 10);
}

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
  // WP-stale-save: the row as this editor last read it — compared against a
  // fresh read at save time (see `handleSave`) to detect a stale save,
  // exactly like `RecipeEditor.tsx`'s `loadedRecipeRef`. `undefined` for a
  // brand new ingredient, which has no prior row to go stale against. ALSO
  // (WP-purchasing-editor) the source `handleSave` spreads forward, so
  // fields this form has no control for (`category`, `roundTo`) survive a
  // save unchanged instead of being silently dropped.
  const loadedIngredientRef = useRef<Ingredient | undefined>(undefined);
  const [staleConflict, setStaleConflict] = useState<Ingredient | undefined>(undefined);

  const [name, setName] = useState("");
  const [unit, setUnit] = useState<Unit>("g");
  const [location, setLocation] = useState<StorageLocation>("pantry");
  const [shelfLifeDays, setShelfLifeDays] = useState<number | null>(30);
  const [openedShelfLifeDays, setOpenedShelfLifeDays] = useState<number | null>(30);
  // Same "hint + local draft" shape as RecipeEditor's own recipe/step photo
  // fields — nothing writes to `Photos` until this form's own Save.
  const [initialHasPhoto, setInitialHasPhoto] = useState(false);
  const [photoDraft, setPhotoDraft] = useState<PhotoDraft>({ status: "unchanged" });

  // --- "How you buy it" (DESIGN_PURCHASING.md §8) — collapsed by default. ---
  const [buyExpanded, setBuyExpanded] = useState(false);
  const [purchaseMode, setPurchaseMode] = useState<PurchaseMode>("loose");
  const [packSizeAmount, setPackSizeAmount] = useState<number | null>(null);
  const [packLabel, setPackLabel] = useState("");

  // --- "How you measure it" (§8/§10.1a) — collapsed by default. The two
  // numeric fields are deliberately NEVER pre-filled from the loaded
  // ingredient's actual gramsPerMl/gramsPerPiece (even when a seeded default
  // gave it a real value) — only shown as a *placeholder*, so an untouched
  // field stays visibly "using the default" rather than looking like a
  // household-confirmed number (scope note, DESIGN_PURCHASING.md §8). A
  // blank field at save time means "leave whatever was already stored
  // alone", never "clear it" — see `handleSave`. ---
  const [measureExpanded, setMeasureExpanded] = useState(false);
  const [cupWeightInput, setCupWeightInput] = useState<number | null>(null);
  const [pieceWeightInput, setPieceWeightInput] = useState<number | null>(null);
  const [cupWeightPlaceholder, setCupWeightPlaceholder] = useState<string | undefined>(undefined);
  const [pieceWeightPlaceholder, setPieceWeightPlaceholder] = useState<string | undefined>(undefined);

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
          loadedIngredientRef.current = found;
          setName(found.name);
          setUnit(found.unit);
          setLocation(found.defaultLocation);
          setShelfLifeDays(found.shelfLifeDays);
          setOpenedShelfLifeDays(found.openedShelfLifeDays);
          setInitialHasPhoto(found.hasPhoto ?? false);

          setPurchaseMode(found.purchaseMode ?? derivedPurchaseMode(found.unit));
          setPackSizeAmount(found.packSize?.amount ?? null);
          setPackLabel(found.packLabel ?? "");
          setBuyExpanded(
            found.purchaseMode !== undefined || found.packSize !== undefined || found.packLabel !== undefined,
          );

          setMeasureExpanded(found.gramsPerMl !== undefined || found.gramsPerPiece !== undefined);
          setCupWeightPlaceholder(found.gramsPerMl !== undefined ? formatPlaceholder(found.gramsPerMl * 240) : undefined);
          setPieceWeightPlaceholder(
            found.gramsPerPiece !== undefined ? formatPlaceholder(found.gramsPerPiece) : undefined,
          );
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

  async function handleSave(force = false): Promise<void> {
    if (name.trim() === "" || shelfLifeDays === null || openedShelfLifeDays === null) {
      showToast({ variant: "warning", title: "Fill in every field before saving." });
      return;
    }
    setSaving(true);
    try {
      // Stale-save check, before any write (photo included) — see
      // RecipeEditor.tsx's identical check for the full rationale. Skipped
      // for a brand-new ingredient and on the confirmed "Save anyway" retry.
      if (!isNew && !force) {
        const latest = await store.ingredients.readAll();
        const current = latest.rows.find((i) => i.id === ingredientId);
        const loaded = loadedIngredientRef.current;
        if (current && loaded && !ingredientContentEquals(current, loaded)) {
          setSaving(false);
          setStaleConflict(current);
          return;
        }
      }

      const id = isNew ? makeIngredientId(uniqueSlug(name, existingIds, rng)) : makeIngredientId(ingredientId!);
      // Photo write first — see RecipeEditor.tsx's identical note on why
      // (never claim `hasPhoto: true` ahead of the row that backs it).
      const hasPhotoFinal = await applyPhotoDraft(store, clock, "ingredient", id, initialHasPhoto, photoDraft);

      // Carry forward whatever this form has no control over at all
      // (`category`, `roundTo`) — see `ingredientContentEquals`'s doc
      // comment for the data-loss bug this fixes: before this package, a
      // save built a brand-new `Ingredient` object from scratch and never
      // included these, so editing an ingredient's name and saving silently
      // wiped its category and any pre-existing purchasability data.
      const previous = loadedIngredientRef.current;

      // "How you buy it": only made explicit when it says something the
      // derived default (§3) doesn't already say, OR it was already
      // explicit on the loaded row — an ingredient nobody has ever opened
      // this group for keeps deriving its mode from `unit` forever, exactly
      // as before this package existed (DESIGN_PURCHASING.md §3: "zero data
      // entry"). `packSize`/`packLabel` only ever apply to Whole — "a Loose
      // ingredient has nothing to round to" (scope note), so switching back
      // to Loose in this session clears them rather than leaving a stale,
      // hidden value behind.
      const purchaseModeExplicit = previous?.purchaseMode !== undefined;
      const purchaseModeFinal: PurchaseMode | undefined =
        purchaseMode === derivedPurchaseMode(unit) && !purchaseModeExplicit ? undefined : purchaseMode;
      const packSizeFinal: Quantity | undefined =
        purchaseMode === "whole" && packSizeAmount !== null && packSizeAmount > 0
          ? makeQuantity(packSizeAmount, unit)
          : undefined;
      const packLabelFinal = purchaseMode === "whole" && packLabel.trim() !== "" ? packLabel.trim() : undefined;

      // "How you measure it": a blank field preserves whatever was already
      // stored (a seeded default, or an earlier household correction) —
      // never guesses, never silently clears (scope note: "leaving a field
      // empty must stay valid"). Only a positive typed number overrides it;
      // "1 cup weighs X g" is stored as gramsPerMl = X / 240 (§8/§10.2).
      const gramsPerMlFinal =
        cupWeightInput !== null && cupWeightInput > 0 ? cupWeightInput / 240 : previous?.gramsPerMl;
      const gramsPerPieceFinal =
        pieceWeightInput !== null && pieceWeightInput > 0 ? pieceWeightInput : previous?.gramsPerPiece;

      const ingredient: Ingredient = {
        id,
        name: name.trim(),
        unit,
        shelfLifeDays,
        openedShelfLifeDays,
        defaultLocation: location,
        ...(previous?.category !== undefined ? { category: previous.category } : {}),
        ...(previous?.roundTo !== undefined ? { roundTo: previous.roundTo } : {}),
        ...(hasPhotoFinal ? { hasPhoto: true } : {}),
        ...(purchaseModeFinal !== undefined ? { purchaseMode: purchaseModeFinal } : {}),
        ...(packSizeFinal !== undefined ? { packSize: packSizeFinal } : {}),
        ...(packLabelFinal !== undefined ? { packLabel: packLabelFinal } : {}),
        ...(gramsPerMlFinal !== undefined ? { gramsPerMl: gramsPerMlFinal } : {}),
        ...(gramsPerPieceFinal !== undefined ? { gramsPerPiece: gramsPerPieceFinal } : {}),
      };
      await store.ingredients.upsert(ingredient);
      // No success toast (UX review round 2, "quieten the toasts"): this
      // navigates straight to the ingredients list, where the saved row is
      // already the confirmation — a toast repeating "saved" on top of that
      // is noise, not information.
      navigate("/recipes/ingredients");
    } catch (err) {
      showToast({ variant: "error", title: "Couldn't save the ingredient", description: messageOf(err) });
    } finally {
      setSaving(false);
    }
  }

  const measureItemLabel = name.trim() !== "" ? name.trim().toLowerCase() : "item";

  return (
    <section>
      <p>
        <Link to="/recipes/ingredients" className={styles.backLink}>
          &larr; Cancel
        </Link>
      </p>
      <h1>{isNew ? "Add ingredient" : "Edit ingredient"}</h1>

      {/* WP-products-screen (usability finding): the only way to fix a
          barcode scanned onto the wrong ingredient used to be "stand in the
          shop with the product in your hand" — there was no way to reach
          the products for an ingredient from here at all. This is that
          repair path: from the ingredient, straight to every product that
          claims it, where a barcode can be moved, removed, or the products
          merged. */}
      {!isNew && !loading && !error ? (
        <p>
          <Link to={`/products?ingredient=${ingredientId}`} className={styles.itemLink}>
            View products for this ingredient
          </Link>
        </p>
      ) : null}

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
            <span className={styles.fieldLabel}>Canonical unit</span>
            <SegmentedControl<Unit> aria-label="Canonical unit" options={SELECTABLE_UNITS} value={unit} onChange={setUnit} />
          </div>

          <div className={styles.field}>
            <span className={styles.fieldLabel}>Default storage location</span>
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

          {/* "How you buy it" (DESIGN_PURCHASING.md §8) — collapsed by
              default; the §3 defaults already fix "0.5 Onion" and the
              lasagna bug with nothing filled in here. */}
          <div className={styles.field}>
            {!buyExpanded ? (
              <button type="button" className={styles.addButton} onClick={() => setBuyExpanded(true)}>
                + How you buy it
              </button>
            ) : (
              <>
                <span className={styles.fieldLabel}>How you buy it</span>
                <SegmentedControl<PurchaseMode>
                  aria-label="Sold as"
                  options={PURCHASE_MODE_OPTIONS}
                  value={purchaseMode}
                  onChange={setPurchaseMode}
                />
                {purchaseMode === "whole" ? (
                  <>
                    <QuantityInput
                      label="Pack size"
                      unit={unit}
                      value={packSizeAmount}
                      onChange={(q) => setPackSizeAmount(q?.amount ?? null)}
                      placeholder="1"
                    />
                    <TextField
                      label="Container name (optional)"
                      value={packLabel}
                      onChange={setPackLabel}
                      placeholder="e.g. jar, carton, box"
                    />
                  </>
                ) : (
                  // The mock is explicit that this field is ABSENT for
                  // Loose, not disabled/greyed — a Loose ingredient has
                  // nothing to round to, so there's nothing to ask for.
                  <p className={styles.hint}>
                    Loose — buy any amount, sold by weight. Switch to Whole to set a pack size and round the basket
                    to it.
                  </p>
                )}
              </>
            )}
          </div>

          {/* "How you measure it" (§8/§10.1a) — collapsed by default. Never
              a guessed conversion: an absent field disables the units it
              can't convert (§10.1) rather than assuming a density of 1.0. */}
          <div className={styles.field}>
            {!measureExpanded ? (
              <button type="button" className={styles.addButton} onClick={() => setMeasureExpanded(true)}>
                + How you measure it
              </button>
            ) : (
              <>
                <span className={styles.fieldLabel}>How you measure it</span>
                <QuantityInput
                  label="1 cup weighs"
                  unit="g"
                  value={cupWeightInput}
                  onChange={(q) => setCupWeightInput(q?.amount ?? null)}
                  {...(cupWeightPlaceholder !== undefined ? { placeholder: cupWeightPlaceholder } : {})}
                />
                <QuantityInput
                  label={`1 ${measureItemLabel} weighs`}
                  unit="g"
                  value={pieceWeightInput}
                  onChange={(q) => setPieceWeightInput(q?.amount ?? null)}
                  {...(pieceWeightPlaceholder !== undefined ? { placeholder: pieceWeightPlaceholder } : {})}
                />
                <p className={styles.hint}>
                  Leaving either blank keeps whatever&rsquo;s already set (a seeded default, or nothing at all) —
                  never a guessed conversion.
                </p>
              </>
            )}
          </div>

          <div className={styles.actions}>
            <button type="submit" className={styles.saveButton} disabled={saving}>
              {saving ? "Saving…" : "Save ingredient"}
            </button>
          </div>
        </form>
      ) : null}
      <ConfirmDialog
        open={staleConflict !== undefined}
        title="This ingredient changed elsewhere"
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
    </section>
  );
}
