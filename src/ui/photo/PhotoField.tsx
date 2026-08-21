import { useEffect, useRef, useState } from "react";
import { encodePhotoDataUrl } from "../../photos/encode.ts";
import { Camera } from "../icons.ts";
import { useToast } from "../components/Toast/useToast.ts";
import styles from "./PhotoField.module.css";

/**
 * A photo field's pending edit, held in the parent form's own draft state
 * (RecipeEditor.tsx/IngredientEditor.tsx) exactly like every other field on
 * those forms — nothing here writes to `WorkbookStore.photos` itself; that
 * only happens once, at Save, same as the rest of the form (mirrors
 * mock-responsive.html's "Editing a recipe" note: add/replace/remove are all
 * LOCAL until Save, so Cancel never leaves an orphaned write behind).
 *
 * "unchanged" covers both "never had one" and "has one, untouched" — the
 * caller already knows which via its own `hasPhoto` hint, and doesn't need
 * this type to repeat it.
 */
export type PhotoDraft =
  | { readonly status: "unchanged" }
  | { readonly status: "new"; readonly dataUrl: string }
  | { readonly status: "removed" };

export interface PhotoFieldProps {
  /** Whether an existing photo should be previewed (the entity's own denormalised `hasPhoto` hint). */
  readonly hasPhoto: boolean;
  /** Fetches the existing photo's data URL for preview — omitted for a brand-new entity that cannot have one yet. Same `WorkbookStore`-free contract as `PhotoMedia.fetchPhoto` (UI_DESIGN.md §7). */
  readonly fetchPhoto?: () => Promise<string | undefined>;
  readonly value: PhotoDraft;
  readonly onChange: (draft: PhotoDraft) => void;
  /** "Add a photo" (recipe/ingredient identity) vs "Add" (a step's tighter card) — mock-responsive.html's own two labels. */
  readonly label?: string;
  /** "1 / 1" (recipe/ingredient identity, square) vs "2.4 / 1" (a step's wide `.photo-add`/`.photo-filled`) — mock-responsive.html's own two aspect ratios. */
  readonly aspectRatio?: string;
  /** Overrides the encoder's default 32KB budget — mainly for tests. */
  readonly budgetBytes?: number;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Add / replace / remove — one control, three always-visible states (never
 * hover-only — mock-responsive.html's own note: "Plan's reroll/pin icons
 * already established that hover-only controls fail on touch"). Used for a
 * recipe's own photo, a step's photo, and an ingredient's photo — the same
 * component at a different `aspectRatio`/`label`.
 *
 * SHARED COMPONENT, same as `PhotoMedia` — a product-photo editor
 * (M6/M6-barcode) should reuse this rather than building a second one.
 */
export function PhotoField({
  hasPhoto,
  fetchPhoto,
  value,
  onChange,
  label = "Add a photo",
  aspectRatio = "1 / 1",
  budgetBytes,
}: PhotoFieldProps) {
  const { showToast } = useToast();
  const [existingPreview, setExistingPreview] = useState<string | undefined>(undefined);
  const [existingLoading, setExistingLoading] = useState(hasPhoto && fetchPhoto !== undefined);
  const [encoding, setEncoding] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    // The initial `useState` above already computed the right starting
    // value for "nothing to fetch" — nothing to synchronise back
    // synchronously here (react-hooks' set-state-in-effect rule; see
    // PhotoMedia.tsx's identical note).
    if (!hasPhoto || !fetchPhoto) return;
    let cancelled = false;
    fetchPhoto()
      .then((url) => {
        if (!cancelled) setExistingPreview(url);
      })
      .finally(() => {
        if (!cancelled) setExistingLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // Runs once for this field's lifetime — `hasPhoto`/`fetchPhoto` describe
    // the entity being edited, which does not change while this field is
    // mounted (the editor route remounts wholesale on a different :id).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleFileChosen(file: File): Promise<void> {
    setEncoding(true);
    try {
      const dataUrl = await encodePhotoDataUrl(file, budgetBytes !== undefined ? { budgetBytes } : {});
      onChange({ status: "new", dataUrl });
    } catch (err) {
      showToast({ variant: "error", title: "Couldn't process that photo", description: messageOf(err) });
    } finally {
      setEncoding(false);
    }
  }

  function openPicker(): void {
    inputRef.current?.click();
  }

  const previewUrl = value.status === "new" ? value.dataUrl : value.status === "unchanged" ? existingPreview : undefined;
  const showFilled = previewUrl !== undefined;

  return (
    <div className={styles.field}>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className={styles.hiddenInput}
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void handleFileChosen(file);
        }}
      />
      {showFilled ? (
        <div className={styles.filledWrap}>
          <div className={styles.filled} style={{ aspectRatio }}>
            <img src={previewUrl} alt="" />
          </div>
          <div className={styles.actions}>
            <button type="button" className={styles.actionButton} onClick={openPicker} disabled={encoding}>
              Replace
            </button>
            <button
              type="button"
              className={`${styles.actionButton} ${styles.actionButtonDestructive}`}
              onClick={() => onChange({ status: "removed" })}
              disabled={encoding}
            >
              Remove
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className={styles.addButton}
          style={{ aspectRatio }}
          onClick={openPicker}
          disabled={encoding || existingLoading}
        >
          <Camera size={22} aria-hidden="true" />
          <span>{encoding ? "Processing…" : existingLoading ? "Loading…" : label}</span>
        </button>
      )}
    </div>
  );
}
