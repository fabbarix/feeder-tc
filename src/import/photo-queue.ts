/**
 * Offline queue for a photo-import SEND — DESIGN_RECIPE_IMPORT_PHOTO.md §12
 * and "Decisions (owner, 2026-08-24)": capture and encode work fully offline
 * (pure client-side canvas work), but sending needs a live connection. A
 * photo taken offline is a real queue candidate — capturing it needs no
 * network at all — so the send step queues instead of failing outright, and
 * fires once connectivity returns.
 *
 * Deliberately NOT `src/sync/outbox.ts` / `InventoryEvents` (invariant 9:
 * that outbox is append-only, idempotent inventory events). A queued
 * photo-import retry is neither idempotent nor append-safe — replaying it
 * twice means two API calls and two drafts, not two harmless facts about the
 * household's kitchen. So this is its own small, separate queue: one pending
 * item at a time is enough for v1, keyed so a duplicate submit doesn't
 * double-queue.
 *
 * Stored in `localStorage`, same trust boundary as `src/import/settings.ts`
 * (the address/key are already there) — 1-3 photos at roughly 200-400KB each
 * as base64 data URLs stays comfortably under a couple of MB, well inside
 * ordinary localStorage limits.
 */

export interface PendingPhotoImport {
  readonly id: string;
  /** The already-encoded model-input photos (data URLs) — see `src/import/photo-encode.ts`. */
  readonly photos: readonly string[];
  /** Only what sending actually needs — never the whole `RecipeImportSettings` shape, so this queue doesn't accidentally carry fields (daily limit, link toggle) that have nothing to do with firing this one request. */
  readonly settings: { readonly baseUrl: string; readonly apiKey: string; readonly model: string };
  /** ISO instant this item was queued — display-only (a future "queued since…" affordance), not read by the fire-on-reconnect logic itself. */
  readonly queuedAt: string;
}

const QUEUE_KEY = "feeder.recipeImport.photoQueue.v1";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/** localStorage is attacker-writable, same rule `src/import/settings.ts` already follows — a corrupted or hand-edited value degrades to "nothing queued" rather than throwing. */
export function readPendingPhotoImport(storage: Storage = window.localStorage): PendingPhotoImport | undefined {
  const raw = storage.getItem(QUEUE_KEY);
  if (raw === null) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isPlainObject(parsed)) return undefined;
    if (typeof parsed.id !== "string" || parsed.id.trim() === "") return undefined;
    if (!isStringArray(parsed.photos) || parsed.photos.length === 0) return undefined;
    if (typeof parsed.queuedAt !== "string") return undefined;
    const settings = parsed.settings;
    if (
      !isPlainObject(settings) ||
      typeof settings.baseUrl !== "string" ||
      typeof settings.apiKey !== "string" ||
      typeof settings.model !== "string"
    ) {
      return undefined;
    }
    return {
      id: parsed.id,
      photos: parsed.photos,
      settings: { baseUrl: settings.baseUrl, apiKey: settings.apiKey, model: settings.model },
      queuedAt: parsed.queuedAt,
    };
  } catch {
    return undefined;
  }
}

/**
 * Enqueues one pending photo import, replacing whatever was queued before —
 * a household only ever has one photo import in flight at a time (v1 scope,
 * "one deferred action," not a real queue of several). If the same `id` is
 * already queued, this is a no-op that returns the existing item, so a
 * duplicate tap of "Read this recipe" while offline never double-queues.
 */
export function enqueuePendingPhotoImport(
  item: Omit<PendingPhotoImport, "queuedAt">,
  storage: Storage = window.localStorage,
): PendingPhotoImport {
  const existing = readPendingPhotoImport(storage);
  if (existing && existing.id === item.id) return existing;
  const next: PendingPhotoImport = { ...item, queuedAt: new Date().toISOString() };
  storage.setItem(QUEUE_KEY, JSON.stringify(next));
  return next;
}

/** Clears the pending item — called once the queued send has settled, success or failure alike, so a failed send never retries unsupervised. */
export function clearPendingPhotoImport(storage: Storage = window.localStorage): void {
  storage.removeItem(QUEUE_KEY);
}
