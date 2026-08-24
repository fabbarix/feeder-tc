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
 * The key is DERIVED from the current schema (`schemaKeyFor`, below) rather
 * than a hand-maintained version string. An earlier draft used a literal
 * `v1` prefix with a comment asking whoever next changes the schema to bump
 * it — rejected in review, correctly: this project has already lived the
 * failure mode where "remember to update the other thing" silently doesn't
 * happen (STATUS.md's own production bug #36 - a workbook missing a tab a
 * later schema change added, every read against it 400ing - is exactly what
 * `ensureWorkbookSchema` exists to fix; a hand-maintained flag key would let
 * that bug come back the moment someone adds a sheet without also bumping a
 * version they have no reason to know exists). Hashing
 * `WorkbookSheetName`'s own members instead means adding, removing, or
 * renaming a sheet changes the key automatically - every browser re-checks
 * exactly once, structurally, with nothing for anyone to remember.
 */
import { WORKBOOK_SHEET_NAMES } from "./bootstrap.ts";

/**
 * A short, stable (not cryptographic - collision resistance to the level of
 * "won't happen by accident for a handful of sheet-name strings" is all this
 * needs) hash of the given sheet names, order-independent (sorted first) so
 * this module doesn't also have to track WORKBOOK_SHEET_NAMES's declared
 * order as part of what counts as "the schema changed". FNV-1a, 32-bit,
 * hex-encoded - plenty of entropy for a handful of short ASCII strings, and
 * trivial to keep dependency-free.
 */
export function schemaKeyFor(sheetNames: readonly string[]): string {
  const joined = [...sheetNames].sort().join(",");
  let hash = 0x811c9dc5;
  for (let i = 0; i < joined.length; i += 1) {
    hash ^= joined.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

const KEY_PREFIX = `feeder:schemaMigrated:${schemaKeyFor(WORKBOOK_SHEET_NAMES)}:`;

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
