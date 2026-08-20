/**
 * Theme persistence (UI_DESIGN.md §2/§3). The ONE deliberate exception to
 * "no localStorage in src/ui/**" (UI_DESIGN.md §7): a display preference is
 * per-device, not domain state, so it never touches the workbook (invariant
 * 5 concerns the domain cache, not this).
 *
 * Stored as a single JSON object so mode and hue always travel together —
 * matches the pre-paint script in index.html, which reads the same key.
 */

export type ThemeMode = "system" | "light" | "dark";

export interface ThemeState {
  readonly mode: ThemeMode;
  readonly hue: number;
}

export const STORAGE_KEY = "feeder:theme";

/** Default accent hue — the OKLCH hue of the brand mark's green (#1c9b5e). See src/index.css. */
export const DEFAULT_HUE = 156;

export const DEFAULT_THEME: ThemeState = { mode: "system", hue: DEFAULT_HUE };

function normalizeHue(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_HUE;
  return ((value % 360) + 360) % 360;
}

function normalizeMode(value: unknown): ThemeMode {
  return value === "light" || value === "dark" ? value : "system";
}

/** Reads the stored theme, falling back to the default on any error (private mode, corrupt JSON, missing key). */
export function loadTheme(): ThemeState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULT_THEME;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_THEME;
    const candidate = parsed as { mode?: unknown; hue?: unknown };
    return { mode: normalizeMode(candidate.mode), hue: normalizeHue(candidate.hue) };
  } catch {
    return DEFAULT_THEME;
  }
}

/** Best-effort write; silently no-ops if storage is unavailable (private mode, quota). */
export function saveTheme(theme: ThemeState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(theme));
  } catch {
    // In-memory state still works for the rest of this session.
  }
}
