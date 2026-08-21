/**
 * The photo pipeline's read path (WP-PHOTO — DESIGN_PHOTOS.md §6: "Out
 * (read): `photos.get(ownerKind, ownerId)` for visible items only"). A
 * thin, shared wrapper so every consumer fetches a photo the same way
 * instead of each rolling its own `store.photos.get(...).then(p =>
 * p?.dataUrl)` — the "small helper for fetching by key" the task brief asks
 * for.
 *
 * Deliberately trivial: no caching, no batching, no `readAll` fallback (see
 * `WorkbookStore.photos`'s own doc comment in contracts.ts for why a
 * `readAll` must never exist here at all). Callers are UI code that already
 * knows to fetch lazily, only for items currently on screen, and to show
 * the kit's `Skeleton` while this promise is in flight and a placeholder
 * once it resolves to `undefined` (DESIGN_PHOTOS.md §6) — this module has
 * no opinion on any of that, it only fetches.
 */
import type { WorkbookStore } from "../domain/contracts.ts";
import type { PhotoOwnerId, PhotoOwnerKind } from "../domain/types.ts";

/** Fetches one photo's data URL by `(ownerKind, ownerId)`, or `undefined` if none has been saved for that owner yet. */
export async function getPhotoDataUrl(
  store: WorkbookStore,
  ownerKind: PhotoOwnerKind,
  ownerId: PhotoOwnerId,
): Promise<string | undefined> {
  const photo = await store.photos.get(ownerKind, ownerId);
  return photo?.dataUrl;
}
