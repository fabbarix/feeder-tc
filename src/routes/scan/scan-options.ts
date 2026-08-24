/**
 * Small, fixed option lists for the scan route (M6) — the same
 * `SegmentedControl`/`DateChips` ≤4-option pattern every other route's own
 * `*-options.ts` uses (UI_DESIGN.md §5). Deliberately NOT imported from
 * `../pantry/pantry-options.ts` or `../shopping/checkoff-options.ts` even
 * where the lists look identical — each route owns its own copy, matching
 * `checkoff-options.ts`'s own stated reason (its doc comment) for not
 * reaching into a sibling route's private module.
 */
import { addDays, type EntryUnit, type IsoDate, type StorageLocation, type Unit } from "../../domain/index.ts";
import type { DateChipOption } from "../../ui/components";

export const LOCATION_OPTIONS: readonly { value: StorageLocation; label: string }[] = [
  { value: "pantry", label: "Pantry" },
  { value: "fridge", label: "Fridge" },
  { value: "freezer", label: "Freezer" },
];

export function purchaseDateOptions(today: IsoDate): readonly DateChipOption[] {
  return [
    { label: "Today", date: today },
    { label: "Yesterday", date: addDays(today, -1) },
  ];
}

export function expiryOverrideOptions(today: IsoDate): readonly DateChipOption[] {
  return [
    { label: "+3d", date: addDays(today, 3) },
    { label: "+1w", date: addDays(today, 7) },
    { label: "+1m", date: addDays(today, 30) },
  ];
}

/**
 * Which `EntryUnit`s the product editor's package-content field offers,
 * keyed by the chosen ingredient's canonical `Unit` — a mass ingredient
 * offers `kg/g/lb/oz`, a volume ingredient offers `l/ml/fl oz`, a count
 * ingredient only ever offers `piece`. This is what keeps the picker a
 * `SegmentedControl` (≤4 options, UI_DESIGN.md §5) instead of an 8-option
 * one covering every `EntryUnit` at once: `units.ts`'s own dimension split
 * (mass/volume/count) already rules out cross-dimension entry, so the UI
 * simply never offers a unit that would fail `convertEntryToCanonical`.
 * `portion` has no entries — it is the leftover-lot-only unit and never a
 * product's canonical unit (see `units.ts`'s own doc comment); the product
 * editor filters `portion`-unit ingredients out of its picker entirely.
 */
const ENTRY_UNITS_BY_CANONICAL: Record<Exclude<Unit, "portion">, readonly EntryUnit[]> = {
  g: ["kg", "g", "lb", "oz"],
  ml: ["l", "ml", "fl oz"],
  piece: ["piece"],
};

export function entryUnitsFor(unit: Unit): readonly EntryUnit[] {
  return unit === "portion" ? [] : ENTRY_UNITS_BY_CANONICAL[unit];
}

export const ENTRY_UNIT_OPTIONS: readonly { value: EntryUnit; label: string }[] = [
  { value: "kg", label: "kg" },
  { value: "g", label: "g" },
  { value: "lb", label: "lb" },
  { value: "oz", label: "oz" },
  { value: "l", label: "l" },
  { value: "ml", label: "ml" },
  { value: "fl oz", label: "fl oz" },
  { value: "piece", label: "piece" },
];

/**
 * Default expiry as a *duration* (DESIGN_PRODUCTS.md §1.2: "6 months", "10
 * days") — presets in days, feeding the same `IntegerField (suffix "days")`
 * idiom `IngredientEditor.tsx` already uses for shelf life, rather than
 * inventing a second "duration" control.
 *
 * "1 month"/"6 months" wrapped to two lines in this 4-segment control's
 * narrow phone-width columns while "10 days"/"1 year" stayed one line —
 * same line-wrap defect as SPLIT_OPTIONS (recipe-options.ts), found by
 * screenshot review rather than by name. "mo" is shortened, not "10 days"/"1
 * year", because those already rendered on one line.
 */
export const SHELF_LIFE_PRESET_DAYS: readonly { value: string; label: string; days: number }[] = [
  { value: "10", label: "10 days", days: 10 },
  { value: "30", label: "1 mo", days: 30 },
  { value: "182", label: "6 mo", days: 182 },
  { value: "365", label: "1 year", days: 365 },
];

// "Bulk / variable weight" wrapped to two lines next to "Packaged"'s one —
// same line-wrap defect as SPLIT_OPTIONS/SHELF_LIFE_PRESET_DAYS above,
// found by screenshot review. Shortened to "Bulk"; the full "weight varies
// bag to bag" explanation already lives in this control's own hint text
// (ProductEditorPanel.tsx/ProductDetail.tsx), not just the label.
export const BULK_OPTIONS: readonly { value: "packaged" | "bulk"; label: string }[] = [
  { value: "packaged", label: "Packaged" },
  { value: "bulk", label: "Bulk" },
];
