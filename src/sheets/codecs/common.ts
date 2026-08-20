/**
 * Shared row<->cell helpers for every per-sheet codec in this directory
 * (WP-11). `contracts.ts`'s `DecodeResult<T>` (`rows` + `warnings`) is the
 * load-bearing shape here: a codec must never throw out of a *read* path —
 * one malformed cell a human typed into the sheet must not take the whole
 * sheet down (WP-11 BDD "Malformed row does not break loading"). The
 * pattern used throughout this directory is: a per-row `decodeOne` function
 * freely throws a plain `Error` for anything wrong with that one row, and
 * `decodeRows` below is the single place that catches it and turns it into
 * one `DataWarning`, excluding just that row from `rows`.
 */
import type { CellRow, DataWarning, DecodeResult } from "../../domain/contracts.ts";
import type { WorkbookSheetName } from "../../domain/types.ts";

/** True if every cell in the row is blank (empty string / null / undefined), or the row has no cells at all. */
export function isBlankRow(row: CellRow): boolean {
  return row.length === 0 || row.every((cell) => cell === null || cell === undefined || cell === "");
}

/** A row of `width` blank cells — used to overwrite a shrinking data block (see workbook-store.ts's writeDataBlock). */
export function blankRow(width: number): CellRow {
  return new Array(width).fill("");
}

/** Last-column letter for a header of `columnCount` columns (1 -> "A", 27 -> "AA", ...). */
export function columnLetter(columnCount: number): string {
  let n = columnCount;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out || "A";
}

export function cellString(row: CellRow, index: number, field: string): string {
  const cell = row[index];
  if (cell === null || cell === undefined || cell === "") {
    throw new Error(`${field} is missing`);
  }
  return String(cell);
}

export function cellOptionalString(row: CellRow, index: number): string | undefined {
  const cell = row[index];
  if (cell === null || cell === undefined || cell === "") return undefined;
  return String(cell);
}

export function cellNumber(row: CellRow, index: number, field: string): number {
  const cell = row[index];
  if (typeof cell === "number") {
    if (!Number.isFinite(cell)) {
      throw new Error(`${field} must be a finite number, got ${cell}`);
    }
    return cell;
  }
  if (typeof cell === "string" && cell.trim() !== "") {
    const n = Number(cell);
    if (Number.isFinite(n)) return n;
  }
  throw new Error(`${field} must be a number, got ${JSON.stringify(cell)}`);
}

export function cellOptionalNumber(row: CellRow, index: number, field: string): number | undefined {
  const cell = row[index];
  if (cell === null || cell === undefined || cell === "") return undefined;
  return cellNumber(row, index, field);
}

export function cellBoolean(row: CellRow, index: number, field: string): boolean {
  const cell = row[index];
  if (typeof cell === "boolean") return cell;
  if (cell === "TRUE" || cell === "true") return true;
  if (cell === "FALSE" || cell === "false") return false;
  throw new Error(`${field} must be a boolean, got ${JSON.stringify(cell)}`);
}

export function cellEnum<T extends string>(
  row: CellRow,
  index: number,
  field: string,
  allowed: readonly T[],
): T {
  const raw = cellString(row, index, field);
  if (!(allowed as readonly string[]).includes(raw)) {
    throw new Error(`${field} must be one of ${allowed.join(", ")}, got ${JSON.stringify(raw)}`);
  }
  return raw as T;
}

/**
 * Shared decode driver for "one row = one entity" sheets. A structurally
 * blank row (every cell empty) is skipped silently — it is filler this
 * codec layer itself writes when a variable-length block (e.g.
 * `replaceForRecipe`) shrinks (`SheetsTransport` has no delete-row
 * operation, only append/update — see workbook-store.ts), not data a human
 * typed, so it is not a `DataWarning`. Any thrown error while decoding a
 * non-blank row becomes one `DataWarning` and that row is excluded from
 * `rows` — the rest of the sheet loads normally (WP-11 BDD "Malformed row
 * does not break loading").
 */
export function decodeRows<T>(
  sheet: WorkbookSheetName,
  rawRows: readonly CellRow[],
  startRowNumber: number,
  decodeOne: (row: CellRow) => T,
): DecodeResult<T> {
  const rows: T[] = [];
  const warnings: DataWarning[] = [];
  rawRows.forEach((row, i) => {
    if (isBlankRow(row)) return;
    try {
      rows.push(decodeOne(row));
    } catch (err) {
      warnings.push({
        sheet,
        row: startRowNumber + i,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  });
  return { rows, warnings };
}
