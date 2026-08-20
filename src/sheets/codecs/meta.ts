/** `Meta` sheet codec (WP-11) — DESIGN.md §3: schema version, generation number. */
import type { CellRow } from "../../domain/contracts.ts";
import type { Meta } from "../../domain/types.ts";
import { cellNumber } from "./common.ts";

/** Stamped by bootstrap.ts on a fresh workbook. Bumped only via a dedicated contract-change task. */
export const SCHEMA_VERSION = 1;

export const META_HEADER: CellRow = ["schema_version", "generation"];

export function encodeMeta(meta: Meta): CellRow {
  return [meta.schemaVersion, meta.generation];
}

export function decodeMeta(row: CellRow): Meta {
  return {
    schemaVersion: cellNumber(row, 0, "schema_version"),
    generation: cellNumber(row, 1, "generation"),
  };
}
