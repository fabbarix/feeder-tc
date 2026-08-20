// UI shell + component kit barrel (WP-15, revised WP-15b). Feature packages
// import shared UI from here rather than reaching into individual files.
export { AppShell } from "./AppShell.tsx";
export type { AppShellProps, ShellState } from "./AppShell.tsx";

export { AuthStatusSlot } from "./slots/AuthStatusSlot.tsx";
export type { AuthStatusSlotProps } from "./slots/AuthStatusSlot.tsx";
export { WorkbookSwitcherSlot } from "./slots/WorkbookSwitcherSlot.tsx";
export type { WorkbookSwitcherSlotProps } from "./slots/WorkbookSwitcherSlot.tsx";

export { ThemeProvider } from "./theme/ThemeProvider.tsx";
export { useTheme } from "./theme/useTheme.ts";
export { ThemeControl } from "./theme/ThemeControl.tsx";
export type { ThemeMode } from "./theme/storage.ts";
export type { ThemeContextValue } from "./theme/ThemeContext.ts";

export * from "./icons.ts";

export * from "./components/index.ts";
