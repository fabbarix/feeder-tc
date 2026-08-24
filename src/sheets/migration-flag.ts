/**
 * Request-volume fix (WP-fix-sheets-429): `App.tsx` used to run
 * `ensureWorkbookSchema` (one `listSheetTitles` round trip) followed by
 * `runProductBarcodeMigration` (two `readAll()`s — `Products` and
 * `ProductBarcodes`) on EVERY workbook open, forever, even though both are
 * idempotent no-ops on an already-current workbook — three requests spent
 * every single time just to confirm "nothing to do", stacked on top of every
 * route's own reads in the same first few seconds after sign-in.
 *
 * This is a purely local, best-effort memo of "this browser already
 * confirmed this workbook is current" — NOT a substitute for the migration
 * itself (invariant 5: Sheets stays the source of truth; this cache holds no
 * workbook data, only a boolean). Deliberately client-side/per-browser
 * rather than a `Meta` column: a stale/missing flag just costs one repeat
 * migration attempt (the original, always-correct behaviour) - never a
 * correctness risk. A workbook opened for the first time on a NEW device (no
 * flag yet) still gets migrated there, exactly as before.
 *
 * Versioned (`v1`) so a future change to what the migration covers can force
 * every browser to re-check once by bumping the key prefix, without needing
 * to touch every existing entry.
 */
const KEY_PREFIX = "feeder:schemaMigrated:v1:";

export function hasWorkbookSchemaMigrated(storage: Storage, workbookId: string): boolean {
  try {
    return storage.getItem(`${KEY_PREFIX}${workbookId}`) === "1";
  } catch {
    // Storage unavailable/blocked (private browsing, quota) — treat as "not
    // yet migrated" so the real migration still runs; see this module's own
    // "best-effort only" framing above.
    return false;
  }
}

export function markWorkbookSchemaMigrated(storage: Storage, workbookId: string): void {
  try {
    storage.setItem(`${KEY_PREFIX}${workbookId}`, "1");
  } catch {
    // Best-effort only — worst case the migration simply runs again next
    // open, same as before this fix existed.
  }
}
