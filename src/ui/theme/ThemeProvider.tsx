import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ThemeContext, type ThemeContextValue } from "./ThemeContext.ts";
import { DEFAULT_THEME, loadTheme, saveTheme, type ThemeMode } from "./storage.ts";

export interface ThemeProviderProps {
  readonly children: ReactNode;
}

const DARK_QUERY = "(prefers-color-scheme: dark)";

function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(DARK_QUERY).matches;
}

/**
 * Owns the System/Light/Dark + accent-hue preference (UI_DESIGN.md §2/§3).
 * Mount once, above the router (see `main.tsx`).
 *
 * `index.html` carries a synchronous inline script that stamps `data-theme`
 * and `--accent-hue` on `<html>` before first paint (module scripts run too
 * late and would flash the wrong theme). This provider re-applies the same
 * values on mount — a no-op in the common case — and then keeps them in sync
 * as the user changes mode/hue or the OS preference changes while mode is
 * "system". It also owns the ONE deliberate `localStorage` use permitted in
 * `src/ui/**` (UI_DESIGN.md §7) and rewrites `<meta name="theme-color">` at
 * runtime to track the chosen accent (§11).
 */
export function ThemeProvider({ children }: ThemeProviderProps) {
  const [{ mode, hue }, setTheme] = useState(() => {
    if (typeof window === "undefined") return DEFAULT_THEME;
    return loadTheme();
  });
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  // Track OS preference changes while mode === "system" — this is what
  // makes the light/dark half of the guard in src/index.css meaningful at
  // runtime, not just on cold load.
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(DARK_QUERY);
    const handleChange = (event: MediaQueryListEvent): void => setSystemDark(event.matches);
    mql.addEventListener("change", handleChange);
    return () => mql.removeEventListener("change", handleChange);
  }, []);

  const resolvedMode: "light" | "dark" = mode === "system" ? (systemDark ? "dark" : "light") : mode;

  // Apply data-theme + --accent-hue to <html>, persist, and rewrite the
  // theme-color meta tag to follow the accent — all in one effect so the DOM
  // is never in a state where the CSS variable and the meta tag disagree.
  useEffect(() => {
    const root = document.documentElement;
    if (mode === "system") {
      root.removeAttribute("data-theme");
    } else {
      root.setAttribute("data-theme", mode);
    }
    root.style.setProperty("--accent-hue", String(hue));
    saveTheme({ mode, hue });

    // index.html ships two static <meta name="theme-color" media="..."> tags
    // as pre-JS defaults (brand green). This provider maintains one ADDITIONAL
    // unmedia-qualified tag, kept first among theme-color metas so the
    // browser's "first matching" selection always prefers it once mounted —
    // its content is read back from the resolved --accent custom property, so
    // it automatically tracks both the chosen hue and the resolved light/dark
    // role without reimplementing the OKLCH→sRGB conversion here.
    const resolvedAccent = getComputedStyle(root).getPropertyValue("--accent").trim();
    if (resolvedAccent) {
      let dynamicMeta = document.getElementById("theme-color-dynamic");
      if (!(dynamicMeta instanceof HTMLMetaElement)) {
        dynamicMeta = document.createElement("meta");
        dynamicMeta.id = "theme-color-dynamic";
        dynamicMeta.setAttribute("name", "theme-color");
        document.head.prepend(dynamicMeta);
      }
      dynamicMeta.setAttribute("content", resolvedAccent);
    }
  }, [mode, hue, resolvedMode]);

  const setMode = useCallback((next: ThemeMode) => {
    setTheme((current) => ({ ...current, mode: next }));
  }, []);

  const setHue = useCallback((next: number) => {
    setTheme((current) => ({ ...current, hue: next }));
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ mode, hue, resolvedMode, setMode, setHue }),
    [mode, hue, resolvedMode, setMode, setHue],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
