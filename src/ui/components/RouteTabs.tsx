import { useRef, type KeyboardEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import styles from "./RouteTabs.module.css";

export interface RouteTabItem {
  readonly to: string;
  readonly label: string;
  /** Stable id for this tab, used to build `id`/`aria-controls` pairs with the route's own panel — see this module's doc comment. */
  readonly id: string;
  /** A tab is "active" for an exact pathname match unless this is set, in which case a nested path (e.g. `/recipes/12`) counts too. */
  readonly end?: boolean;
}

export interface RouteTabsProps {
  readonly items: readonly RouteTabItem[];
  readonly "aria-label": string;
}

/**
 * Real tab headers between sibling routes (WP-VC4, replacing the pill
 * `SegmentedControl`-look this component used to render) — the owner's own
 * words: "make the tab selectors look more like tab headers, with a
 * defined content, and a visual clue that that is a tab, just not a
 * segmented selector." Visually this now borrows the exact same underline
 * language as `AppShell.module.css`'s `.navItemActive` (colour + a 2px
 * accent underline, motion on colour only) rather than a pill trough, so a
 * tab reads as the same kind of "active" affordance the top nav already
 * uses, not a second, competing one.
 *
 * Structurally these ARE tabs (`role="tablist"`/`"tab"`, `aria-selected`,
 * roving tabindex, arrow-key/Home/End navigation per the WAI-ARIA APG tabs
 * pattern) even though each one navigates to a distinct, deep-linkable
 * route rather than swapping an in-page panel — hand-rolled rather than
 * built on React Aria's `useTabList` because that hook's collection model
 * (`<Item>` children, one mounted panel per key) is shaped for exactly the
 * swap-a-panel-in-place case and doesn't fit "each tab is its own router
 * page" without fighting it. A caller pairs this with `role="tabpanel"
 * id={itemId} aria-labelledby={itemId+"-tab"}` on that route's own root
 * element (see Recipes.tsx/Ingredients.tsx) to complete the tablist/tab/
 * tabpanel triad WCAG expects.
 */
export function RouteTabs({ items, ...aria }: RouteTabsProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const tabRefs = useRef<Record<string, HTMLAnchorElement | null>>({});

  function isActive(item: RouteTabItem): boolean {
    const path = location.pathname;
    if (item.end ?? false) return path === item.to;
    return path === item.to || path.startsWith(`${item.to}/`);
  }

  function focusTab(index: number): void {
    const item = items[index];
    if (!item) return;
    tabRefs.current[item.id]?.focus();
  }

  // WAI-ARIA APG "automatic activation": moving focus with the arrow keys
  // also navigates immediately (no separate activation keypress) — the
  // natural mapping here since each tab already navigates on click/Enter,
  // and there is no cheaper "preview without navigating" state for a routed
  // tab the way there is for an in-page panel swap.
  function handleKeyDown(event: KeyboardEvent<HTMLAnchorElement>, index: number): void {
    let nextIndex: number | undefined;
    switch (event.key) {
      case "ArrowRight":
        nextIndex = (index + 1) % items.length;
        break;
      case "ArrowLeft":
        nextIndex = (index - 1 + items.length) % items.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = items.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const next = items[nextIndex];
    if (!next) return;
    focusTab(nextIndex);
    navigate(next.to);
  }

  return (
    <div role="tablist" aria-label={aria["aria-label"]} className={styles.group}>
      {items.map((item, index) => {
        const active = isActive(item);
        return (
          <Link
            key={item.id}
            to={item.to}
            id={`${item.id}-tab`}
            role="tab"
            aria-selected={active}
            aria-controls={item.id}
            tabIndex={active ? 0 : -1}
            ref={(el) => {
              tabRefs.current[item.id] = el;
            }}
            className={`${styles.tab}${active ? ` ${styles.tabActive}` : ""}`}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
