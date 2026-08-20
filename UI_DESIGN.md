# UI Design System — Feeder

Authoritative for the component kit and every screen built on it. Agreed with the
product owner on 2026-08-20 in a design interview. **These are settled decisions —
do not re-litigate them.** If you find a genuine contradiction, escalate to the
coordinator rather than choosing silently.

Companion to `DESIGN.md` (product design), `HANDOVER.md` (invariants, conventions)
and `TESTING.md` (test conventions).

## 1. Principles

1. **Mobile-first is literal.** The phone layout is the real design; wide screens are
   the enhancement. Building a desktop layout and reflowing it down is desktop-first
   wearing a media query — do not do it.
2. **Small, reusable components.** One concern each. If we want to iterate on how
   quantities are entered, that is one file.
3. **No business intelligence in components.** See §7.
4. **No native pickers, dropdowns, alert boxes or numeric inputs.** They are
   unstyleable, behave differently per browser and OS, and cannot be themed. See §5.
5. **In-store use is a first-class case.** The shopping list is used one-handed, in a
   supermarket, possibly offline, on a low-end phone.

## 2. Theming

**Three states: System / Light / Dark.** Default System.

- Stored **per device in `localStorage`**, never in the workbook. The workbook is
  household-shared and has no per-user identity (`DESIGN.md` §2 keeps voting
  household-level deliberately), so a theme there would apply to everyone. A display
  preference is not domain state; invariant 5 concerns the domain cache, not this.
- Applied as `data-theme` on `<html>`: absent = follow system, `"light"` / `"dark"` =
  explicit.
- CSS structure — **all three states must work**:
  - light tokens on bare `:root`
  - dark tokens under `@media (prefers-color-scheme: dark)`, **guarded** as
    `:root:not([data-theme="light"])`
  - dark tokens again under `:root[data-theme="dark"]`

  The guard is what makes "explicit light on a dark-mode phone" work. Without it the
  media query wins and the toggle silently does nothing in one direction.
- **A synchronous inline script in `index.html` stamps `data-theme` before first
  paint.** It must be inline and blocking — a module import runs after the browser
  has already painted, producing a white flash on every cold load in dark mode.

## 3. Colour and user accents

**The user picks a hue; every accent token is derived in OKLCH with lightness and
chroma fixed per role.**

Store a hue angle (e.g. `285`), not a hex value:

```css
--accent:        oklch(0.55 0.20 var(--accent-hue));
--accent-text:   oklch(0.99 0.02 var(--accent-hue));
--accent-bg:     oklch(0.95 0.05 var(--accent-hue));
--accent-border: oklch(0.75 0.12 var(--accent-hue));
```

Because lightness is pinned per role and only hue rotates, **contrast is guaranteed by
construction** — every hue lands at the same perceptual lightness, so it passes for all
hues or fails for none. Test once. Dark mode redefines the same tokens with different
L values.

UI: **a grid of ~12 hue swatches**, not a slider. Tappable targets suit a thumb and
avoid `<input type="range">`.

Never hard-code a colour in a component. Always `var(--*)`.

## 4. Styling

**CSS Modules (`X.module.css`).** Native to Vite, zero dependencies, still plain CSS.

Scoping is enforced by the build rather than by discipline — with several packages
adding components in parallel, `.card` / `.row` / `.badge` collisions are otherwise
inevitable and fail silently, in one theme, on one screen.

Design tokens stay **global** on `:root` in the theme stylesheet; only component-local
rules are scoped.

## 5. Controls — what replaces the native ones

### Behavioural substrate: React Aria **hooks**

`react-aria` + `react-stately` + `@internationalized/date`. Hooks, **not**
`react-aria-components` — hooks return prop objects and we render our own DOM, so the
markup, CSS Modules and icons stay ours. We borrow behaviour, not appearance.

This covers the hard part of every banned control — keyboard navigation, focus
management, ARIA wiring, screen-reader announcements — which is exactly what the axe
requirement tests.

| Banned native | Hook |
|---|---|
| `<input type="date">` | `useCalendar` / `useDatePicker` |
| `<select>` | `useSelect` / `useListBox` / `useComboBox` |
| `window.confirm` / `alert` | `useDialog` / `useOverlay` |
| — | `useFocusRing`, `usePress` |

`@internationalized/date`'s `CalendarDate` is **timezone-free**, and
`parseDate("2026-08-20")` ↔ `.toString()` maps 1:1 to our branded `IsoDate`. Never
call `toDate(timeZone)`; never put a JS `Date` in a component prop. A `Date` at local
midnight can be the previous day in UTC, which for an *expiry* comparison is a real
off-by-one.

### Numbers

**`<input type="text" inputMode="decimal">` holding a *string* in state.**

`type="number"` is banned for concrete reasons: a scroll wheel over it silently changes
the value, spinners are tiny hit targets, it accepts `e`/`+`/`-`, and `valueAsNumber`
is `NaN` for partial input. `inputMode="decimal"` gives the same mobile keypad without
any of that.

**Hold the raw string, not a number.** Storing a number is the root cause of the jank:
the moment the user types `0.` or `1,` you parse to `NaN`, write it back, and their
cursor jumps or the input clears. Validate on change; emit a parsed `Quantity` upward
only when valid.

```tsx
<QuantityInput
  value onChange
  unit="g"          // display-only, never selectable (invariant 3)
  placeholder defaultValue
  prefixIcon suffixIcon
  showSteppers      // opt-in; sensible for `piece`, pointless for `g`
/>
```

Steppers must be real touch targets, never 16px spinners.

### Dates

**Context-shaped controls; the calendar is only an escape hatch.**

| Where | Control |
|---|---|
| Week view | previous / next chevrons + week label — no picker exists |
| Shopping range | preset chips: This week / Next week / 2 weeks / 4 weeks |
| Purchase date | `Today` / `Yesterday` / `Pick…` |
| Expiry override | `+3d` / `+1w` / `+1m` / `Pick…` |
| Mark cooked | defaults to today |

Relative offsets are *better* than a calendar here, not a workaround: nobody knows the
milk expires on the 27th, they know it lasts about a week — and `DESIGN.md` already
defines shelf life in days. `Pick…` opens the React Aria calendar.

### Selection

**No general-purpose `Select`.** Two primitives:

- **≤4 options → inline, no overlay.** `SegmentedControl` (single) / `ToggleChips`
  (multi). Covers storage location, recipe kind, recipe status (the vote control),
  meal tags, slot layout. A dropdown for three visible choices is strictly worse: two
  taps instead of one, and the current value is hidden.
- **Large searchable sets → `SelectSheet`.** Bottom sheet on mobile, popover at
  ≥768px, with a search field. Only two uses: the ingredient picker and the recipe
  picker. A sheet rises into thumb reach; a top-anchored dropdown does not.

**Threshold: past ~4 options, use the sheet.** Do not grow a segmented control.

## 6. Layout primitives

**List-first. Tables are the ≥768px enhancement, not the base.**

Changing `display` on table elements drops implicit ARIA table semantics in several
browsers, so a CSS-reflowed table has the costs of a table and the semantics of a
stack of divs — precisely on mobile, the primary target.

- `ListRow` — the workhorse: leading slot (icon/checkbox), primary + secondary text,
  trailing slot (quantity/badge/action). One `--touch-target` tall.
- `ListSection` — grouped headings (the pantry groups lots by ingredient).
- `CheckRow` — in-store variant; larger, whole row is the tap target.
- `EntityTable` — retained **only** where columns genuinely mean something on a wide
  screen, rendered as a real table with no display-swapping so its semantics survive.

Navigation: **bottom tab bar on mobile** (48px targets), top bar at ≥768px.

## 7. The component boundary

**Forbidden in `src/ui/**`:** `WorkbookStore`, `SnapshotStore`, `Outbox`,
`SheetsTransport`, any engine (`computeShoppingList`, `generateWeek`,
`applyNewEvents`), data fetching, `localStorage` (the theme provider is the single
deliberate exception).

**Allowed:** domain *value types* and pure formatters — `Quantity`, `IsoDate`, `Unit`,
`MealTag`, `StorageLocation`, `formatQuantity`, `makeIsoDate`, `addDays`.

Why allow types: invariant 3. If `QuantityInput` took `{ amount: number, unit: string }`
we would discard compile-time protection against mixed units at the exact boundary
where a user types a number. "Presentational" must not mean "stringly-typed". The kit
is app-specific, not a library we publish.

Data arrives via props; intent leaves via callbacks. A component renders; it never
decides what happens.

**Enforced by an ESLint `no-restricted-imports` rule scoped to `src/ui/**`** — built
into ESLint, no dependency, fails CI. Not a convention. When a screen legitimately
needs an engine, it calls it in the route/container above the kit and passes results
down.

## 8. Sync state

**Global banner for pending; per-item marker for failed only.**

- `AppShell` shows an offline banner and an outbox count ("3 waiting to sync"), with
  `aria-live="polite"` so the state is not purely visual.
- **No per-item pending dot.** Ten pending rows in a shop is ten pieces of noise the
  user cannot act on.
- **`failed?: boolean` on `ListRow`/`CheckRow`** — set only after a flush genuinely
  fails (WP-17 throws `SyncStorageError`). This is actionable and rare, and a global
  counter cannot say *which* row broke. Offer a retry.
- Pending is **normal**: use a muted neutral token, never `--warning` / `--danger`.
  It must read as "saved, will sync", not "failed". Only a real failure earns a
  warning colour.
- Components never import the `Outbox`. Sync state is read by the container and
  passed down as props (§7).

**This amends WP-24's mandatory scenario** in `IMPLEMENTATION_PLAN.md` — see that file.

## 9. Icons

**Phosphor (`@phosphor-icons/react`), re-exported from a curated `src/ui/icons.ts`.**

Feature packages import from the kit, never from Phosphor directly: swapping libraries
later is one file, and it forces a shared vocabulary so nobody adds a second, subtly
different trash-can icon for "spoiled".

Chosen over Lucide/Tabler for two project-specific reasons: it has a real kitchen
vocabulary (`CookingPot`, `BowlFood`, `ForkKnife`, `Carrot`, `Bread`, `Fish`,
`EggCrack`, `Snowflake`), and its **six weights** give active/inactive nav states from
the *same* icon (`weight="fill"` vs `"regular"`) rather than two mismatched sets.

Icons inherit `currentColor`, so they follow the accent and theme for free. `prefixIcon`
props take a component reference, not a string name — tree-shakeable and type-safe.

Verify the built bundle size rather than trusting tree-shaking claims: a 9,000-icon
barrel can slow Vite's dev pre-bundling.

## 10. Motion, states, scale

- **Motion**: colour/opacity transitions only, ~150ms, all inside
  `prefers-reduced-motion`. No layout animation — it feels cheap on low-end phones.
- **States**: `EmptyState`, `Skeleton`, `ErrorState` live in the kit so packages do not
  invent four visual languages. `WP-31` requires empty-state polish.
- **Scale**: existing `--space-1..6`, `--touch-target: 48px`, one fluid type scale, no
  separate density mode.

## 11. App identity, icons and install metadata

Sources of truth (`scripts/generate-icons.sh` regenerates every raster from them):

| File | Role |
|---|---|
| `public/logo.svg` | Master mark, **and** the served SVG favicon |
| `assets/logo/logo-maskable.svg` | Android maskable source — full bleed, glyph at 62% |
| `assets/logo/logo-apple.svg` | iOS source — full bleed, opaque, glyph at 78% |

The PNGs are **committed**, not built on the fly: the build must not depend on
ImageMagick being installed. Rerun the script and commit the output when a logo
changes.

### The mark

A bowl with a tilted sprig. Three filled shapes, no strokes, gradients, filters
or masks — strokes vanish at favicon sizes and filters rasterise inconsistently.
**The sprig's tilt is load-bearing**: vertically symmetric above the bowl it reads
as a flame (an oil lamp), not a leaf.

### Why three variants and not one

- **Android maskable**: the OS crops to a device-chosen shape (circle, squircle,
  teardrop). Only the inner 80% is guaranteed. The rounded-tile master would have
  its bowl rim clipped on a circular mask, so the maskable variant is full-bleed
  with a smaller glyph.
- **iOS**: ignores the manifest's icons entirely and reads only
  `<link rel="apple-touch-icon">`. It applies its **own** squircle mask, so
  shipping pre-rounded corners rounds them twice and leaves pale slivers. It also
  composites over **black**, so the icon must be fully opaque — the generator
  strips the alpha channel rather than trusting the source.

### Generated set

`favicon.ico` (16/32/48 multi-res), `favicon-96.png`, `icon-192.png`,
`icon-512.png`, `icon-maskable-192.png`, `icon-maskable-512.png`,
`apple-touch-icon.png` (180).

### Manifest and head tags

`public/manifest.webmanifest`: `display: standalone`, `start_url`/`scope` `/`
(the app is at a domain root since the custom-domain cutover), plus **shortcuts**
to Shopping, Plan and Pantry for long-press on the home-screen icon.

`index.html` carries what the manifest cannot: the iOS meta tags, the multi-format
icon links, `color-scheme`, and `viewport-fit=cover`.

**`viewport-fit=cover` is required** for `env(safe-area-inset-*)` to resolve on
notched iPhones. The bottom tab bar (§6) **must** pad itself with
`env(safe-area-inset-bottom)` or it sits under the home indicator.

`apple-mobile-web-app-status-bar-style` is `default` (content below the status
bar). `black-translucent` looks better but requires every top-edge element to
honour `env(safe-area-inset-top)`, and looks broken if one screen forgets.

### theme_color vs. the user's accent

The manifest's `theme_color` and the installed icon are **baked at build time and
cannot follow the user's chosen hue** (§3). So:

- The icon and `theme_color` use the **default brand green** `#1c9b5e`.
- `index.html` ships light/dark `<meta name="theme-color">` defaults, and the
  theme provider **rewrites that meta tag at runtime** to track the chosen accent.
  Browser UI then follows the accent even though the installed icon cannot.
- `background_color` (the splash) is `#ffffff` to match the default light theme —
  a manifest has no dark variant, so dark-mode users get one light splash frame.
  Deliberate: green-on-green would hide the icon's own tile.

## 12. Auth-gated shell states

Added 2026-08-20 after the product owner tested the running app: signed out, the
shell still rendered the full nav and let you walk into every route.

`AppShell` takes a **required** discriminated union. Three states, not two —
signing in is not sufficient, because the app is useless until a workbook exists
(`DESIGN.md` §1: the app creates one, or the user opens a shared one via Picker).

```ts
type ShellState =
  | { kind: "signed-out" }   // branding + "Sign in with Google". Nothing else.
  | { kind: "no-workbook" }  // "Create new meal planner" / "Open existing…" + sign out.
  | { kind: "ready" }        // full shell: nav, workbook switcher, <Outlet />.
```

A union rather than two booleans, so the compiler forces all three cases.

**Gate the route content, not just the nav.** Hiding nav links while `<Outlet />`
still renders is a fake gate — a cold deep link to `/pantry` while signed out must
show the sign-in screen. This is E2E-tested.

**The shell never imports auth** (§7). State arrives as a prop; intent leaves via
`onSignIn` / `onSignOut` / `onCreateWorkbook` / `onPickWorkbook`. WP-20 wires the
real `createGoogleAuth` from `src/sheets/`. This also preserves WP-10's criterion
that no Google API call happens before a user gesture.

The signed-out screen passes axe like every other route.
