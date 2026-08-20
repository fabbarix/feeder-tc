import { useContext } from "react";
import { ThemeContext, type ThemeContextValue } from "./ThemeContext.ts";

/** Access the current theme mode/hue and their setters. Must be used within `<ThemeProvider>` (mounted once in `main.tsx`). */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within a <ThemeProvider>");
  }
  return ctx;
}
