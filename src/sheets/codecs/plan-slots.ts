/**
 * `PlanSlots` sheet codec (WP-11) — DESIGN.md §3: one row per planned meal
 * (date, slot type, recipe_id, scale, state).
 *
 * `PlanSlotFilling` is a 4-way union (recipe | leftover | leftover-projected
 * | empty — types.ts, widened by WP-leftover-planning). Modelled the same
 * way HANDOVER.md's decision register already settled for `InventoryEvents`:
 * a `filling_kind` discriminator column plus every variant's fields, blank
 * where not applicable — never a JSON blob (invariant 6).
 *
 * `leftover-projected` reuses `filling_recipe_id` (it names the recipe the
 * leftover is expected to come from, same column `recipe` already uses) and
 * adds one new column, `filling_source_slot_id`, for the `PlanSlotId` it
 * depends on. Appending this column after the existing ones, rather than
 * inserting it near `filling_recipe_id`, keeps every pre-existing column
 * index in `PLAN_SLOTS_HEADER` unchanged for a legacy row.
 */
import type { CellRow } from "../../domain/contracts.ts";
import {
  makeIsoDate,
  makeLotId,
  makePlanSlotId,
  makeRecipeId,
  type PlanSlot,
  type PlanSlotFilling,
} from "../../domain/types.ts";
import { cellBoolean, cellEnum, cellNumber, cellOptionalNumber, cellString } from "./common.ts";
import { FILLING_KINDS, MEAL_TAGS, PLAN_SLOT_STATES } from "./enums.ts";

export const PLAN_SLOTS_HEADER: CellRow = [
  "id",
  "date",
  "slot_type",
  "slot_index",
  "filling_kind",
  "filling_recipe_id",
  "filling_scale_servings",
  "filling_lot_id",
  "state",
  "pinned",
  "filling_source_slot_id",
];

export function encodePlanSlot(slot: PlanSlot): CellRow {
  const base: CellRow = [slot.id, slot.date, slot.slotType, slot.slotIndex];
  switch (slot.filling.kind) {
    case "recipe":
      return [
        ...base,
        "recipe",
        slot.filling.recipeId,
        slot.filling.scaleServings ?? "",
        "",
        slot.state,
        slot.pinned,
        "",
      ];
    case "leftover":
      return [...base, "leftover", "", "", slot.filling.lotId, slot.state, slot.pinned, ""];
    case "leftover-projected":
      return [
        ...base,
        "leftover-projected",
        slot.filling.recipeId,
        "",
        "",
        slot.state,
        slot.pinned,
        slot.filling.sourceSlotId,
      ];
    case "empty":
      return [...base, "empty", "", "", "", slot.state, slot.pinned, ""];
  }
}

export function decodePlanSlot(row: CellRow): PlanSlot {
  const id = makePlanSlotId(cellString(row, 0, "id"));
  const date = makeIsoDate(cellString(row, 1, "date"));
  const slotType = cellEnum(row, 2, "slot_type", MEAL_TAGS);
  const slotIndex = cellNumber(row, 3, "slot_index");
  const fillingKind = cellEnum(row, 4, "filling_kind", FILLING_KINDS);

  let filling: PlanSlotFilling;
  if (fillingKind === "recipe") {
    const recipeId = makeRecipeId(cellString(row, 5, "filling_recipe_id"));
    const scale = cellOptionalNumber(row, 6, "filling_scale_servings");
    filling = { kind: "recipe", recipeId, ...(scale !== undefined ? { scaleServings: scale } : {}) };
  } else if (fillingKind === "leftover") {
    const lotId = makeLotId(cellString(row, 7, "filling_lot_id"));
    filling = { kind: "leftover", lotId };
  } else if (fillingKind === "leftover-projected") {
    const recipeId = makeRecipeId(cellString(row, 5, "filling_recipe_id"));
    const sourceSlotId = makePlanSlotId(cellString(row, 10, "filling_source_slot_id"));
    filling = { kind: "leftover-projected", sourceSlotId, recipeId };
  } else {
    filling = { kind: "empty" };
  }

  const state = cellEnum(row, 8, "state", PLAN_SLOT_STATES);
  const pinned = cellBoolean(row, 9, "pinned");

  if (slotIndex < 0) {
    throw new Error(`slot_index must not be negative, got ${slotIndex}`);
  }

  return { id, date, slotType, slotIndex, filling, state, pinned };
}
