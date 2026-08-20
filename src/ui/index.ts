// UI shell + component kit barrel (WP-15). Feature packages (WP-20…WP-23)
// import shared UI from here rather than reaching into individual files.
export { AppShell } from "./AppShell.tsx";
export type { AppShellProps } from "./AppShell.tsx";

export { AuthStatusSlot } from "./slots/AuthStatusSlot.tsx";
export type { AuthStatusSlotProps } from "./slots/AuthStatusSlot.tsx";
export { WorkbookSwitcherSlot } from "./slots/WorkbookSwitcherSlot.tsx";
export type { WorkbookSwitcherSlotProps } from "./slots/WorkbookSwitcherSlot.tsx";

export * from "./components/index.ts";
