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
  ArrowsClockwise,
  PushPin,
  PushPinSlash,
  Trash,
  // Shopping FAB (WP-23) / the scan route it opens (M6 — DESIGN_PRODUCTS.md §1).
  Barcode,
  Camera,
  CameraSlash,
  Keyboard,
  Tag,
  ImageSquare,
  // Auth / workbook gating (§12 — signed-out / no-workbook shell states)
  GoogleLogo,
  SignOut,
  FileArrowUp,
  FolderOpen,
  // The workbook chip (§12/§13 header) — the active spreadsheet, at a glance.
  Table,
  // Photos (WP-PHOTO UI — DESIGN_PHOTOS.md): `Timer` labels a resting
  // duration badge and the "Start timer" button; `Pause` is the running
  // timer's pause control (`X` above already covers "cancel") — both on
  // RecipeDetail.tsx's method timer.
  //
  // `Camera` is NOT re-exported here: it is already imported above for the
  // M6 scan route, and this package's shared add/replace affordance
  // (src/ui/photo/**) reuses that same one. Both packages added it
  // independently on different lines, so git merged them without a conflict
  // and TypeScript caught the duplicate instead — one icon, one export.
  Timer,
  Pause,
  // Route error boundary (RouteError.tsx) — a genuine "this address doesn't
  // exist" 404, distinct from WarningCircle's "something went wrong".
  Compass,
  // Recipe-card metadata (defect-sweep WP-VC5: "prep"/"cook"/"serves" spelled
  // out in words on every card). `Clock` labels both time figures (prep and
  // cook are both durations — one glyph, two values, same as a kitchen timer
  // reads); `Users` labels the serving count. Each icon pairs with an
  // `aria-label` on its wrapping `<span>` (Recipes.tsx) rather than standing
  // alone — see that file's comment on why this is metadata, not a control,
  // and still needs its value announced in full.
  Clock,
  Users,
} from "@phosphor-icons/react";
