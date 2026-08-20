import { useId } from "react";
import { SegmentedControl, type SegmentedControlOption } from "../components/SegmentedControl.tsx";
import { useTheme } from "./useTheme.ts";
import type { ThemeMode } from "./storage.ts";
import styles from "./ThemeControl.module.css";

const MODE_OPTIONS: readonly SegmentedControlOption<ThemeMode>[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/** 12 evenly-spaced hues — a tappable grid, not an `<input type="range">` (UI_DESIGN.md §3). */
const HUES: readonly number[] = Array.from({ length: 12 }, (_, i) => i * 30);

/**
 * The three-state System/Light/Dark control plus the accent hue grid
 * (UI_DESIGN.md §2/§3). Reads/writes via `useTheme()` — mount anywhere under
 * `<ThemeProvider>` (currently `Settings`).
 */
export function ThemeControl() {
  const { mode, hue, setMode, setHue } = useTheme();
  const modeLabelId = useId();
  const hueLabelId = useId();

  return (
    <div className={styles.root}>
      <div className={styles.section}>
        <span id={modeLabelId} className={styles.label}>
          Appearance
        </span>
        <SegmentedControl aria-labelledby={modeLabelId} options={MODE_OPTIONS} value={mode} onChange={setMode} />
      </div>
      <div className={styles.section}>
        <span id={hueLabelId} className={styles.label}>
          Accent color
        </span>
        <div className={styles.swatchGrid} role="group" aria-labelledby={hueLabelId}>
          {HUES.map((swatchHue) => (
            <button
              key={swatchHue}
              type="button"
              className={styles.swatch}
              style={{ background: `oklch(0.55 0.2 ${swatchHue})` }}
              aria-pressed={hue === swatchHue}
              aria-label={`Hue ${swatchHue} degrees`}
              onClick={() => setHue(swatchHue)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
