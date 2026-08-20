/**
 * Small option lists for the check-off sheet (`ShoppingRow.tsx`) — deliberately
 * NOT imported from `../pantry/pantry-options.ts`: WP-23 stays inside
 * `src/routes/Shopping.tsx` / `src/routes/shopping/**` (its own work
 * package boundary) rather than reaching into a sibling route's private
 * module, even though the two lists would look identical. Same UI_DESIGN.md
 * §5 fixed-enum pattern as the pantry route's own options.
 */
import { addDays, type IsoDate, type StorageLocation } from "../../domain/index.ts";
import type { DateChipOption } from "../../ui/components";

export const LOCATION_OPTIONS: readonly { value: StorageLocation; label: string }[] = [
  { value: "pantry", label: "Pantry" },
  { value: "fridge", label: "Fridge" },
  { value: "freezer", label: "Freezer" },
];

/** `+3d` / `+1w` / `+1m` — UI_DESIGN.md §5 "Dates", expiry-override row. */
export function expiryOverrideOptions(today: IsoDate): readonly DateChipOption[] {
  return [
    { label: "+3d", date: addDays(today, 3) },
    { label: "+1w", date: addDays(today, 7) },
    { label: "+1m", date: addDays(today, 30) },
  ];
}
