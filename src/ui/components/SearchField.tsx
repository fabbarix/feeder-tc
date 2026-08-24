import { MagnifyingGlass } from "../icons.ts";
import styles from "./SearchField.module.css";

export interface SearchFieldProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder: string;
  /** Accessible name — every caller sets this explicitly (e.g. "Search recipes"), never left to the placeholder alone. */
  readonly "aria-label": string;
  readonly id?: string;
}

/**
 * The one search input every browse list uses (WP-VC5 — see this module's
 * `.module.css` doc comment). A pill with a leading `MagnifyingGlass` icon
 * and no visible `<label>`: the icon is a well-understood convention for
 * "this is search" and the `aria-label` carries the real accessible name,
 * same reasoning as the recipe-card metadata icons (Recipes.tsx) — this is
 * repeated, learnable chrome, not a one-off control.
 */
export function SearchField({ value, onChange, placeholder, id, ...aria }: SearchFieldProps) {
  return (
    <div className={styles.search}>
      <MagnifyingGlass size={16} aria-hidden="true" />
      <input
        id={id}
        type="text"
        className={styles.input}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={aria["aria-label"]}
      />
    </div>
  );
}
