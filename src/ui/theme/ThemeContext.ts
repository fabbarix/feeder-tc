import { createContext } from "react";
import type { ThemeMode } from "./storage.ts";

export interface ThemeContextValue {
  /** The stored preference — "system" follows the OS. */
  readonly mode: ThemeMode;
  readonly hue: number;
  /** The mode actually in effect right now ("system" resolved against the OS preference). */
  readonly resolvedMode: "light" | "dark";
  readonly setMode: (mode: ThemeMode) => void;
  readonly setHue: (hue: number) => void;
}

export const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);
