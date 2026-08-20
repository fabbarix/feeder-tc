/**
 * Curated Phosphor icon barrel (UI_DESIGN.md §9).
 *
 * Feature packages (WP-20…WP-23) import icons from HERE, never from
 * `@phosphor-icons/react` directly — enforced by the `no-restricted-imports`
 * ESLint rule in `eslint.config.js`. Swapping icon libraries later is one
 * file, and a shared vocabulary means nobody adds a second, subtly different
 * trash-can icon for "spoiled".
 *
 * Every export is a component reference (not a string name) so `prefixIcon`/
 * `suffixIcon` props stay tree-shakeable and type-safe. Icons inherit
 * `currentColor`, so they follow the accent/theme for free. Phosphor's six
 * weights give active/inactive nav states from the SAME icon
 * (`weight="fill"` vs `"regular"`) instead of two mismatched icon sets — see
 * `AppShell.tsx`'s nav items.
 *
 * Bundle size is verified against the built output, not assumed from
 * tree-shaking claims — see the WP-15b handover report for the measured
 * number.
 */
export type { Icon as IconComponent, IconWeight, IconProps } from "@phosphor-icons/react";

export {
  // Navigation (AppShell bottom tab bar)
  House,
  BookOpen,
  Package,
  CalendarBlank,
  ShoppingCart,
  GearSix,
  // Kitchen vocabulary (DESIGN.md ingredient/recipe iconography)
  CookingPot,
  BowlFood,
  ForkKnife,
  Carrot,
  Bread,
  Fish,
  EggCrack,
  Snowflake,
  // Chrome: chevrons (WeekNav), dismissal, search, status
  CaretLeft,
  CaretRight,
  CaretDown,
  X,
  Check,
  MagnifyingGlass,
  Plus,
  Minus,
  WarningCircle,
  CheckCircle,
  Info,
  CircleNotch,
  WifiSlash,
  CloudArrowUp,
  ArrowClockwise,
  Trash,
  // Auth / workbook gating (§12 — signed-out / no-workbook shell states)
  GoogleLogo,
  SignOut,
  FileArrowUp,
  FolderOpen,
  // The workbook chip (§12/§13 header) — the active spreadsheet, at a glance.
  Table,
} from "@phosphor-icons/react";
