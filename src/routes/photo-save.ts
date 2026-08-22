/**
 * Cross-domain glue for saving a `PhotoField`'s local `PhotoDraft` into
 * `WorkbookStore.photos` — done HERE, in `src/routes/**`, never inside
 * `src/ui/**` (UI_DESIGN.md §7: `src/ui/**` may not import `WorkbookStore`).
 * Shared by RecipeEditor.tsx (a recipe's own photo, and each step's) and
 * IngredientEditor.tsx so all three save the exact same way instead of each
 * re-deriving this logic.
 *
 * Nothing here writes until a form's own Save calls it — a `PhotoField`
 * only ever holds its edit locally (see that component's own doc comment),
 * matching every other field on these forms: Cancel never leaves an
 * orphaned `Photos` row behind.
 *
 * WP-stale-save: deliberately NO stale-save protection on `photos.upsert`/
 * `photos.remove` here. A `Photo` row (contracts.ts) IS the image —
 * `ownerKind`/`ownerId`/`dataUrl`/`updatedAt`, no adjacent field a
 * concurrent write could clobber — so last-write-wins is simply "whichever
 * photo was saved last is the one that shows", the same as any other
 * single-value field. The recipe/ingredient forms that call this already
 * run their OWN stale-save check on the entity's other fields
 * (name/status/shelf-life/...) before ever reaching this call.
 */
import type { Clock, PhotoOwnerId, PhotoOwnerKind, WorkbookStore } from "../domain/index.ts";
import type { PhotoDraft } from "../ui/photo/index.ts";

/**
 * Applies a `PhotoDraft` to the `Photos` sheet for one owner and returns
 * whether that owner should now claim `hasPhoto: true` on its own row.
 * `initialHasPhoto` is the value the field started from (the entity's own
 * denormalised hint) — needed because "unchanged" must resolve to whatever
 * was already true, and "removed" only needs a real `store.photos.remove`
 * call if a photo genuinely existed to remove.
 */
export async function applyPhotoDraft(
  store: WorkbookStore,
  clock: Clock,
  ownerKind: PhotoOwnerKind,
  ownerId: PhotoOwnerId,
  initialHasPhoto: boolean,
  draft: PhotoDraft,
): Promise<boolean> {
  if (draft.status === "new") {
    await store.photos.upsert({ ownerKind, ownerId, dataUrl: draft.dataUrl, updatedAt: clock.now() });
    return true;
  }
  if (draft.status === "removed") {
    if (initialHasPhoto) await store.photos.remove(ownerKind, ownerId);
    return false;
  }
  return initialHasPhoto;
}
