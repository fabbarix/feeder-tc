/** Shared option lists/labels for the pantry route (WP-21) — the fixed, small enums `SegmentedControl`/`DateChips` render inline (UI_DESIGN.md §5). */
import { addDays } from "../../domain/index.ts";
import type { IsoDate, StorageLocation, Unit } from "../../domain/index.ts";
import type { DateChipOption } from "../../ui/components";

export const LOCATION_OPTIONS: readonly { value: StorageLocation; label: string }[] = [
  { value: "pantry", label: "Pantry" },
  { value: "fridge", label: "Fridge" },
  { value: "freezer", label: "Freezer" },
];

export function locationLabel(location: StorageLocation): string {
  return LOCATION_OPTIONS.find((option) => option.value === location)?.label ?? location;
}

/** `Today` / `Yesterday` — UI_DESIGN.md §5 "Dates", purchase-date row. */
export function purchaseDateOptions(today: IsoDate): readonly DateChipOption[] {
  return [
    { label: "Today", date: today },
    { label: "Yesterday", date: addDays(today, -1) },
  ];
}

/** `+3d` / `+1w` / `+1m` — UI_DESIGN.md §5 "Dates", expiry-override row. */
export function expiryOverrideOptions(today: IsoDate): readonly DateChipOption[] {
  return [
    { label: "+3d", date: addDays(today, 3) },
    { label: "+1w", date: addDays(today, 7) },
    { label: "+1m", date: addDays(today, 30) },
  ];
}

/** Lots at/inside this many days of their expiry (inclusive of already-expired) surface under "Expiring soon" — UI_DESIGN.md §13 "group by urgency first". */
export const EXPIRING_SOON_DAYS = 3;

const UNIT_FULL_NAME: Record<Unit, string> = {
  g: "gram",
  ml: "millilitre",
  piece: "piece",
  portion: "portion",
};

/** "gram" / "millilitre" / "piece" / "portion" — the pantry-item detail page's subtitle (design/mock-screens.html #lot: "Canonical unit: gram · pantry default · shelf life 730 days"), spelled out rather than the bare `Unit` code. */
export function unitFullName(unit: Unit): string {
  return UNIT_FULL_NAME[unit];
}
