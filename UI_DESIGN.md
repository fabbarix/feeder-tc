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

Pinning lightness per role and rotating only the hue **greatly reduces** contrast
variance across accents — but it does **not** eliminate it, and an earlier version of
this section wrongly claimed it did.

OKLCH `L` is *perceptual* lightness; WCAG contrast is computed from *relative
luminance*, which is not the same function. At a fixed `L`, yellows and greens carry
more relative luminance than blues, so the contrast ratio still moves with hue and
chroma. WP-15b's axe checks caught exactly this: the constants originally written here
bottomed out at **3.73:1 around hue 189** — a real failure against the 4.5:1 threshold.

**So: sweep all 360 hues and pick constants whose *worst case* passes.** Do not test one
hue and assume the rest follow. The corrected light-mode accent is
`oklch(0.45 0.18 H)` (worst case now 5.95:1); dark mode's original values already
passed. Dark mode redefines the same tokens with different `L`.

The mechanism is still right — one hue variable drives everything, and a user cannot
produce an unreadable accent. What was wrong was the claim that it needs testing once.

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
  | { kind: "signed-out" }
  | { kind: "no-workbook"; user: ShellUser }
  | { kind: "ready"; user: ShellUser; workbookName: string }

type ShellUser = { name: string; email: string; pictureUrl?: string }
```

**Amended 2026-08-20** after the owner tested the shell. The signed-in variants now
carry the user, because the header had nowhere to get one from and fell back to a
hardcoded string.

### The header derives from state — no state-blind placeholders

The first version rendered `AuthStatusSlot` with a hardcoded `"Signed out"` and
`WorkbookSwitcherSlot` with `"No workbook"` whenever no slot was injected, *regardless
of `ShellState`*. The result: in `no-workbook` the user is signed in, the body offers
"Sign out", and the header simultaneously claims "Signed out". Three contradictory
statements on one screen.

- **`signed-out`** — no sign-out action anywhere, no workbook label. Offering to sign
  out of nothing is the tell that the header is not reading state.
- **`no-workbook` / `ready`** — show the user's **name and avatar** (initials when
  `pictureUrl` is absent), not the word "Signed out". `ready` also shows the workbook
  name in the switcher.

A default that renders plausible-looking text without consulting state is worse than
no default: it looks correct and is wrong.

### Brand

**The top bar shows the mark AND the "Feeder" wordmark together.**

History, because this flipped twice and the next agent will otherwise flip it again:
an earlier version of this section said "mark alone", on the reasoning that the word
repeats what the tab title, manifest and URL already say. **The owner authorized
mark + wordmark directly (2026-08-20)**, matching the approved mockup, whose `.brand`
is mark + text. That decision supersedes the reasoning above.

**Do not "restore" mark-alone by citing this section's history.** If the bar ever
needs the horizontal space back, that is a new decision for the owner, not a revert.

A union rather than two booleans, so the compiler forces all three cases.

**Gate the route content, not just the nav.** Hiding nav links while `<Outlet />`
still renders is a fake gate — a cold deep link to `/pantry` while signed out must
show the sign-in screen. This is E2E-tested.

**The shell never imports auth** (§7). State arrives as a prop; intent leaves via
`onSignIn` / `onSignOut` / `onCreateWorkbook` / `onPickWorkbook`. WP-20 wires the
real `createGoogleAuth` from `src/sheets/`. This also preserves WP-10's criterion
that no Google API call happens before a user gesture.

The signed-out screen passes axe like every other route.

## 13. Visual language — approved 2026-08-20

The owner approved the interface direction and screen catalogue. What follows is
what those add beyond §1–§12; where they differ, this section wins.

### Elevation

Three surface levels, not one flat plane. The merged WP-15 shell shared a single
near-black between background, content and nav, which is why it read as a void.

| Token | Use |
|---|---|
| `--paper` | the page ground |
| `--surface` | cards, sheets, the tab bar |
| `--surface-2` | inset wells, segmented-control troughs, hover |

Plus `--line` / `--line-soft` for borders, and two shadow tokens. Shadows are for
things that genuinely float (sheets, dialogs, the FAB) — not for cards.

### Colour: only exceptions get colour

**Fresh is neutral. Amber means expiring. Red means expired.** A pantry of thirty
items stays calm instead of becoming a fruit salad, and attention goes where it is
needed.

**Semantic colours are fixed hues and must never derive from `--accent-hue`.** The
accent is user-selectable (§3): if "expiring" were accent-derived and someone chose
amber, the warning would vanish into the interface. `--warn` ≈ hue 72, `--crit` ≈
hue 27, both fixed.

### Motion

Colour and opacity only. **Never animate layout or position** — it feels cheap on
the low-end phone this is designed for, and it thrashes on a long list.

| Tier | Duration | Examples |
|---|---|---|
| Micro | 160 ms | hover, press, focus ring |
| State | 220 ms | check-off, toggle, badge change |
| Entry | 260–300 ms | tab indicator, checkmark draw, sheet rise |

Easing `cubic-bezier(0.22, 0.61, 0.36, 1)` throughout. Everything inside
`prefers-reduced-motion`.

The check-off is the one moment worth animating properly: the tick draws via
`stroke-dashoffset` while the row's label strikes through. It is the single most
repeated interaction in the app.

### Type

**Fraunces** for headings (variable, optical size), **Archivo** for UI and body.
`font-variant-numeric: tabular-nums` everywhere digits align — quantities, dates,
prices, counts.

**Self-host both as subset `woff2`. Do not link Google Fonts.** This is an
offline-first PWA: a CDN stylesheet is a third-party request that fails in a shop
with no signal, and it leaks visitors to a third party. Subset to latin and only
the weights used.

### Freshness as a visual cue

A pantry lot shows a thin meter of remaining shelf life beneath it, coloured by the
rule above. It makes "use this first" legible at a glance rather than requiring the
user to compare dates.

### Desktop

- **The nav belongs in the DOM before `<main>`.** WP-15's bug was ordering, not CSS:
  it correctly set `position: static` at ≥768 px, but rendered the nav after a
  full-height main, so it fell to the bottom of the page.
- Content sits in a real container with a measure — never stranded top-left.
- **Width buys information, not padding.** The shopping screen gains a right rail
  answering *"why is this on my list?"* from `ShoppingListLine.sources`, which the
  engine already computes and the current UI discards.
- The week planner is the screen that justifies desktop: seven columns, whole week
  visible, pinned/leftover/empty slots each visually distinct.

### Empty states

Every route gets a real one: an icon, a sentence naming what is missing, and the
action that fixes it. No developer text ever reaches a user — "Stub route — see
WP-23" shipped to the owner and must not recur.

### Reference

The approved mockups: interface direction and the full screen catalogue (Home,
Recipes, a recipe, Pantry, a pantry item, Plan, Shopping, barcode scan, Settings,
and the control gallery). Build to those patterns.
