import { NavLink } from "react-router-dom";
import styles from "./RouteTabs.module.css";

export interface RouteTabItem {
  readonly to: string;
  readonly label: string;
  /** Passed through to `NavLink`'s own `end` prop — required for a parent path (e.g. `/recipes`) that would otherwise match every nested child route too. */
  readonly end?: boolean;
}

export interface RouteTabsProps {
  readonly items: readonly RouteTabItem[];
  readonly "aria-label": string;
}

/**
 * Segmented-pill sub-navigation between sibling routes (UI_DESIGN.md's
 * mock — the `.seg` control, reused here for real page navigation rather
 * than a single value). Renders `<NavLink>`s, not `SegmentedControl`
 * (radio-group semantics would be wrong: these are distinct URLs, not one
 * control's value) — replaces a bare, unstyled `<Link>` between Recipes and
 * the ingredients catalog (owner-reported, comparing production to the
 * approved mock: the link rendered in the browser's default purple, and the
 * catalogue should read as a proper tab of Recipes, not a stray link).
 */
export function RouteTabs({ items, ...aria }: RouteTabsProps) {
  return (
    <nav className={styles.group} aria-label={aria["aria-label"]}>
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end ?? false}
          className={({ isActive }) => `${styles.tab}${isActive ? ` ${styles.tabActive}` : ""}`}
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}
