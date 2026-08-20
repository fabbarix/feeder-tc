# Design reference — the approved mock

**These files are the target. The app is wrong when it differs from them.**

| File | What it is |
|---|---|
| `mock-screens.html` | The approved screen catalogue: Home, Recipes, a recipe, Pantry, a pantry item, Plan, Shopping, barcode scan, Settings, and the control gallery — each shown phone **and** desktop. |
| `mock-direction.html` | The interface direction: diagnosis of the old shell, the elevation/motion/colour system, and the desktop rationale. |
| `mock-reference.css` | Tokens and layout rules extracted verbatim from `mock-screens.html`, so you can diff values without reading the whole page. |

## Why these exist

The owner approved the mock, then compared it against production and said **"not even close"**. Every UI package until now built to the *prose* in `UI_DESIGN.md`. Prose cannot convey a green-tinted neutral or a four-column grid, and WP-15b said so explicitly in its report: no mock assets existed in the repo, so it built to the written rules. That was the gap.

## How to use them

Open them in a browser, or render them with Playwright next to the running app and compare directly:

```js
await page.goto("file:///…/design/mock-screens.html");   // target
await page.goto("http://localhost:<port>/recipes");      // actual
```

Both are self-contained: no build step, no network beyond Google Fonts. They are **live** — the accent-hue swatches and the theme toggle work, so you can confirm a token change behaves the same in both.

## Known deliberate divergences

The app wins over the mock on exactly one thing: **accent contrast**. WP-15b swept all 360 hues and found the mock's constants bottomed out at 3.73:1. The app's `--accent` values are the swept, accessible ones. **Contrast beats fidelity** — do not "restore" the mock's accent numbers.

Everything else: match the mock.
