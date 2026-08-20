/**
 * In-memory SheetsTransport fake, backed by a plain grid per sheet. WP-10's
 * real implementation talks to the Sheets REST API; this fake is what
 * everything else (WP-11 while WP-10 is in flight, WP-11's own dev-time
 * tests) codes against, and it must pass the exact same contract suite
 * (../contract-tests/sheets-transport.contract.ts) that WP-10 re-runs
 * against the real thing.
 *
 * Supports the A1 subset actually used elsewhere in this codebase:
 * `Sheet!A1`, `Sheet!A1:C5`, `Sheet!A2:H` (open-ended row — "to the last row
 * present"). Not a general-purpose A1 parser.
 */
import type { CellGrid, CellRow, SheetsTransport } from "../contracts.ts";

interface ParsedRange {
  readonly sheet: string;
  readonly startCol: number;
  readonly startRow: number;
  readonly endCol: number;
  readonly endRow: number | undefined;
}

const RANGE_RE = /^([^!]+)!([A-Z]+)(\d+)(?::([A-Z]+)(\d+)?)?$/;

function colToIndex(letters: string): number {
  let index = 0;
  for (const ch of letters) {
    index = index * 26 + (ch.charCodeAt(0) - 64);
  }
  return index - 1;
}

function indexToCol(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function parseRange(range: string): ParsedRange {
  const match = RANGE_RE.exec(range);
  if (!match) {
    throw new Error(`Not a supported A1 range: ${JSON.stringify(range)}`);
  }
  const sheet = match[1];
  const startColLetters = match[2];
  const startRowStr = match[3];
  const endColLetters = match[4];
  const endRowStr = match[5];
  if (sheet === undefined || startColLetters === undefined || startRowStr === undefined) {
    throw new Error(`Not a supported A1 range: ${JSON.stringify(range)}`);
  }
  const startCol = colToIndex(startColLetters);
  return {
    sheet,
    startCol,
    startRow: Number(startRowStr) - 1,
    endCol: endColLetters ? colToIndex(endColLetters) : startCol,
    endRow: endRowStr ? Number(endRowStr) - 1 : undefined,
  };
}

/** Creates a fresh, empty in-memory SheetsTransport. Each instance is isolated. */
export function createFakeSheetsTransport(): SheetsTransport {
  const sheets = new Map<string, CellRow[]>();

  function getSheet(name: string): CellRow[] {
    let rows = sheets.get(name);
    if (!rows) {
      rows = [];
      sheets.set(name, rows);
    }
    return rows;
  }

  function sliceRange(rows: readonly CellRow[], parsed: ParsedRange): CellGrid {
    const lastRow = parsed.endRow ?? rows.length - 1;
    const out: CellRow[] = [];
    for (let r = parsed.startRow; r <= lastRow && r < rows.length; r += 1) {
      const row = rows[r] ?? [];
      out.push(row.slice(parsed.startCol, parsed.endCol + 1));
    }
    return out;
  }

  return {
    async readRange(range) {
      const parsed = parseRange(range);
      return sliceRange(getSheet(parsed.sheet), parsed);
    },

    async batchRead(ranges) {
      return ranges.map((range) => {
        const parsed = parseRange(range);
        return sliceRange(getSheet(parsed.sheet), parsed);
      });
    },

    async appendRows(sheetName, rows) {
      const sheet = getSheet(sheetName);
      const startRow = sheet.length;
      for (const row of rows) {
        sheet.push([...row]);
      }
      const endRow = sheet.length;
      const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
      const endCol = width > 0 ? indexToCol(width - 1) : "A";
      return { updatedRange: `${sheetName}!A${startRow + 1}:${endCol}${endRow}` };
    },

    async updateRange(range, rows) {
      const parsed = parseRange(range);
      const sheet = getSheet(parsed.sheet);
      rows.forEach((row, i) => {
        const targetRow = parsed.startRow + i;
        while (sheet.length <= targetRow) {
          sheet.push([]);
        }
        const existing = sheet[targetRow] ?? [];
        const next = [...existing];
        row.forEach((value, j) => {
          next[parsed.startCol + j] = value;
        });
        sheet[targetRow] = next;
      });
    },
  };
}
