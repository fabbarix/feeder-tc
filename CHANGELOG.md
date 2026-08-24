# Changelog

## v1.0.0 — unreleased

Feeder is a household meal planner: a catalogue of what you cook, a pantry that
knows what you have, a week you can plan, and a shopping list that subtracts one
from the other. It runs entirely in the browser, stores everything in a Google
Sheet you own, and installs to a phone.

### What it does

- **Recipes** — ingredients, steps and photos, with quantities that scale live to
  the number of servings you pick.
- **Pantry** — event-sourced stock with FIFO consumption, per-lot expiry, and
  corrections that append to the history rather than editing it.
- **Plan** — a week, month and quarter view. Generation prefers leftovers, spaces
  repeats as far apart as it can, and fills the week rather than explaining why
  it could not.
- **Shopping** — needs derived from the plan, netted against the pantry, rounded
  to real pack sizes, and grouped by aisle. Every row explains its own arithmetic.
- **Scan** — barcode lookup with a manual fallback when there is no camera;
  products carry several barcodes, because the same jar has a different code in
  each shop.
- **Prices** — per product, viewable overall, per shop, or averaged across shops.
- **Offline** — an outbox queues writes and reconciles when the connection
  returns. Installable as a PWA.

### Notes for anyone reading the history

Three rounds of usability review shaped the last week of this release. The most
productive round was the one given no access to the design documents: reviewers
who could only see the screen found a first-run message that leaked the database
("Creating the spreadsheet and writing the seeded ingredient catalog"), a
framework crash page addressed to "developer", and a planning flow that failed
twice over for reasons the app never stated. Four earlier reviews had walked past
all of it, because everyone who had read the docs already knew what the screens
meant.

Two defects were found by measurement rather than by anyone reporting them: a
destructive-action button failing WCAG AA at 2.62:1 in dark mode, having only
ever been checked in light; and a segmented control that shipped as a wrapped
pill for a day, past a conformance test that pinned three specific consumers
instead of the invariant.

Four confidently-reported defects turned out not to exist. All four came from
reading screenshots. Eyes found what measurement could not; measurement stopped
what eyes got wrong.

### Known limitations

- **Tablet vertical density.** The approved layout work covered desktop. Tablet
  screens still leave more empty height than they should.
- **No stale-save protection on most routes.** Two people editing the same recipe
  or week can still overwrite each other; only the recipe editor refreshes first.
- **Home's "mark cooked" shortcut** flips a leftover slot's state without running
  the full cook flow, so it records no event.
- **Picking a leftover directly from the meal picker** is drawn in the mock and
  not implemented; the planner places leftovers itself, but you cannot choose one
  by hand.
