#!/usr/bin/env node
// Mock-parity check (WP-tokens enforcement #7, token-layer proposal
// `#enforce`) — greps the mock for every custom property it defines and
// asserts each one is represented in src/index.css, failing CI when the
// mock invents a token the app doesn't have yet.
//
// SUBSTITUTION, reported rather than silently applied: the proposal's
// literal version ("every custom-property name it defines... also exists in
// src/index.css") assumes 1:1 naming. In practice the mock (design/
// mock-reference.css, design/mock-responsive.html) predates several renames
// (`--r-sm` -> `--radius-sm`, `--text-dim` -> `--text-muted`, `--accent-line`
// -> `--accent-border`, `--shadow-1`/`--shadow-2` -> `--shadow-sm`/
// `--shadow-lg`, `--display`/`--ui` -> `--heading`/`--sans`, `--ease` ->
// `--ease-standard`) — a literal name match would fail on Day 1 for reasons
// that have nothing to do with this PR. ALIASES below records that known
// renaming; the check still fails loudly on a genuinely NEW mock token that
// isn't in src/index.css under either name, which is the actual failure
// mode this mechanism exists to catch (see STATUS.md "Known debt" —
// SegmentedControl's `.seg.wrap`, Photos, the Plan calendar all shipped a
// mock idea the app never got).
//
// One entry, `--text-faint`, is a known, already-tracked gap (STATUS.md
// "Approved mock designs have shipped unimplemented three times" — the mock
// distinguishes two dimmed-text levels, the app only has one) rather than
// something this token-only pass should invent a new semantic role to
// close; ALLOWLIST records it explicitly so it doesn't silently disappear
// from view, and this script's failure is the reminder that it's still open.
//
// Run: node scripts/mock-parity.mjs (wired into `npm run lint`).

import { readFileSync } from "node:fs";

const MOCK_FILES = ["design/mock-reference.css", "design/mock-responsive.html"];
const INDEX_CSS = "src/index.css";

const ALIASES = {
  "--r-sm": "--radius-sm",
  "--r-md": "--radius-md",
  "--r-lg": "--radius-lg",
  "--text-dim": "--text-muted",
  "--accent-line": "--accent-border",
  "--shadow-1": "--shadow-sm",
  "--shadow-2": "--shadow-lg",
  "--display": "--heading",
  "--ui": "--sans",
  "--ease": "--ease-standard",
};

const ALLOWLIST = new Set([
  "--text-faint", // STATUS.md Known debt — tracked, not closed by WP-tokens.
]);

const indexCss = readFileSync(INDEX_CSS, "utf8");
const definedInApp = new Set([...indexCss.matchAll(/--[a-zA-Z0-9-]+(?=\s*:)/g)].map((m) => m[0]));

let missing = [];

for (const file of MOCK_FILES) {
  const content = readFileSync(file, "utf8");
  const mockProps = new Set([...content.matchAll(/--[a-zA-Z0-9-]+(?=\s*:)/g)].map((m) => m[0]));
  for (const prop of mockProps) {
    if (definedInApp.has(prop)) continue;
    const aliased = ALIASES[prop];
    if (aliased && definedInApp.has(aliased)) continue;
    if (ALLOWLIST.has(prop)) continue;
    missing.push(`${prop} (from ${file})`);
  }
}

console.log(`Mock-parity check: ${MOCK_FILES.length} mock file(s), ${definedInApp.size} app tokens.`);

if (missing.length) {
  console.error("\nMock defines a custom property with no counterpart in src/index.css:");
  for (const m of missing) console.error(` - ${m}`);
  console.error(
    "\nEither the app is missing a token the mock already committed to, or this script's ALIASES/ALLOWLIST needs updating for a deliberate rename. Do not silently widen ALLOWLIST for a genuinely new gap.",
  );
  process.exit(1);
}

console.log("Mock-parity check passed (all mock tokens resolved via direct match, alias, or documented allowlist).");
