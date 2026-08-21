# Feeder

Feeder is a household meal planner with a pantry-aware shopping list. You plan
meals, track what's actually in your pantry and freezer (with expiry and
FIFO usage), and get a shopping list computed as *what you need minus what
you already have*.

Live site: **https://feeder.torchetti.us**

## What makes it different

Feeder has no server and no database. It's a static site (Vite + React,
hosted on GitHub Pages) that talks directly to the Google Sheets API in your
browser. The "backend" is a Google Sheets workbook — one per household —
that lives in **your own Google Drive**, not on infrastructure someone else
runs.

That's a deliberate feature, not just an implementation detail:

- Your data is yours. Open the spreadsheet any time, read it, edit a cell by
  hand, export it, delete it.
- There's nothing to sign up for beyond your existing Google account. No new
  password, no separate account system.
- The app only ever asks for the non-sensitive `drive.file` OAuth scope,
  which grants access to exactly the files you create with the app or
  explicitly open through the Google Picker — nothing else in your Drive.
- No analytics, no third-party services, no telemetry. See
  [Privacy](#privacy) below.

The trade-off is that Feeder is only as available as Google Sheets is, and
sharing a household's data means sharing a spreadsheet.

## Project status

**Feeder is functional end to end** — sign in, create or open a workbook,
add recipes and pantry stock, generate a week's plan, shop, mark meals
cooked, and track leftovers all work on the live site today. It is still
under active development, so rough edges remain (see below), but nothing in
this README describes a stub or a "coming soon" screen.

As of this writing, shipped and covered by the automated test suite (unit,
BDD, mocked-API, and end-to-end):

- **Recipes**, including bought/pre-prepared meals, a rich step editor with
  per-step photos, markdown detail text, durations and an in-recipe cooking
  timer.
- **Pantry**, with event-sourced lot tracking, FIFO usage, expiry, and a
  freshness meter.
- **Plan**, a weekly meal-slot generator with staples, rotation, reroll/pin,
  manual picks, servings scaling, and mark-cooked (which posts pantry usage
  and turns surplus into a leftover lot).
- **Shopping**, computed as needs minus viable stock, grouped by store
  section, with in-store check-off that creates the purchase lot directly.
- **Photos** on recipes, steps and ingredients (512 px WebP, stored in the
  workbook itself — see [Privacy](#privacy)).
- **Barcode scanning** (camera, with a manual-entry fallback) against a
  Products catalog, for fast pantry check-off and price tracking.
- **Whole-unit purchasing**: the shopping list rounds to something you can
  actually buy (no more "0.5 lasagna") rather than a raw fractional need.
- Installable **offline PWA** with an app-shell cache and a write outbox
  that flushes automatically on reconnect.
- The app **self-heals a workbook created before a newer feature added its
  sheet tab** — opening an older workbook backfills what's missing rather
  than failing to load it.
- Real sign-in and Sheets/Drive access against live Google APIs (not just
  mocks) has been verified by the project owner using their own account and
  workbook.

**Known rough edges:** the ingredient/recipe editors don't yet expose a
dedicated UI for pack sizes and "how you buy it" (the shopping-list rounding
above already works from the existing catalog data; pack-size entry is a
planned enhancement, not a correctness dependency), and there is no
price-history view yet even though barcode scans already record prices.

This section will go stale — it describes a snapshot, not a promise. If
something below doesn't match what you see on the site, trust the site.

## Getting started

Here's the flow, start to finish:

1. Open [feeder.torchetti.us](https://feeder.torchetti.us) and sign in with
   your Google account. Feeder only requests the `drive.file` scope — it
   never asks for broad access to your Drive.
2. On first use you either:
   - **Create a new workbook.** Feeder creates a Google Sheets spreadsheet
     in your Drive and writes its schema (recipes, pantry events, plan
     slots, shopping, and so on) as plain, readable sheets — no JSON blobs
     in cells.
   - **Open a workbook someone shared with you**, via the Google Picker (see
     [Sharing with a household](#sharing-with-a-household) below).
3. A new workbook comes pre-loaded with a seeded catalogue of about 104
   common ingredients (canonical unit, default storage location, shelf-life
   defaults), so you're not starting from a blank ingredient list on day
   one. You still add your own recipes and pantry contents.

## Sharing with a household

Feeder doesn't have its own concept of household membership or invites — it
reuses Google Sheets sharing, which everyone already knows:

1. The person who created the workbook shares the underlying Google Sheets
   spreadsheet the normal way (Sheets' own **Share** button — "Anyone with
   the link can edit," or specific email addresses), exactly as they would
   share any other spreadsheet.
2. Each household member signs into Feeder with their **own** Google
   account, then opens that spreadsheet once via the Google Picker inside
   the app (rather than just clicking the Sheets link).

That Picker step matters and isn't just friction: Feeder only ever holds the
`drive.file` scope, which grants access solely to files a user created with
the app or explicitly opened through the Picker. A Sheets sharing invite by
itself doesn't grant the app anything — opening the file through the Picker
is what tells Google "yes, let this app touch this specific file." It's the
mechanism that keeps Feeder from being able to see anything else in your
Drive, at the cost of one extra click the first time each person opens a
shared workbook.

After that first Picker open, the workbook behaves like any other workbook
the app knows about — Feeder remembers multiple workbooks per device so you
can switch between, e.g., your own household's and one you help manage.

## Self-hosting / forking

Feeder has no backend to deploy — "hosting" means pointing GitHub Pages at
your own fork and provisioning your own Google Cloud project. None of the
values below are secrets (the OAuth client ID and Picker API key are public
identifiers, safe to expose in a built JS bundle), but you still need to
create your own.

### 1. Google Cloud project

1. Create a Google Cloud project.
2. Enable three APIs: **Google Sheets API**, **Google Drive API**, and
   **Google Picker API**. No billing account is required — all three are
   free at this app's usage level.
3. Configure the **OAuth consent screen**: External user type, scopes
   limited to `drive.file` only (do not add broader Drive/Sheets scopes —
   the whole design depends on staying non-sensitive).
4. **Publish the consent screen to Production.** This is the step most
   likely to bite you — see the warning box below.
5. Create an **OAuth 2.0 Client ID** of type "Web application." Add
   Authorized JavaScript origins for every place the app will run:
   `http://localhost:5173` (local dev — see [Development](#development) for
   why this exact port matters) and your GitHub Pages / custom domain
   origin(s), e.g. `https://<you>.github.io` and/or `https://your-domain`.
6. Create an **API key** for the Picker widget. Restrict it two ways:
   HTTP referrer restriction to the same origins as step 5, and API
   restriction to the Picker API only. This key initializes the Picker
   widget only — it is never sent on Sheets or Drive API calls, which
   authenticate with the signed-in user's OAuth token instead.

> **The publishing-status trap.** It's easy to leave the consent screen in
> "Testing" instead of "Production" — the UI doesn't make this obvious, and
> a project can look fully configured while still being in Testing. If it's
> left in Testing, real users hit `Error 403: access_denied` on sign-in
> ("app is currently being tested"), and even approved test users get
> refresh tokens that expire after 7 days, forcing a re-login every week.
> Publishing a `drive.file`-only app to Production needs **no Google
> verification review** — that's specifically why this app only ever
> requests that scope. Don't try to work around a Testing-mode 403 by
> adding test users; publish to Production instead. (This is not
> theoretical: it happened during this project's own setup and cost real
> debugging time before the fix — publish to Production — was found.)

### 2. GitHub repository and Pages

1. Fork or push this repository to your own GitHub account.
2. Enable **GitHub Pages** on the repo with **"GitHub Actions"** as the
   build source (not "deploy from a branch").
3. Add two repository **Actions variables** (Settings → Secrets and
   variables → Actions → **Variables** tab — not Secrets; these are public
   identifiers, not credentials):
   - `VITE_GOOGLE_CLIENT_ID` — the OAuth client ID from step 1.5.
   - `VITE_GOOGLE_API_KEY` — the Picker API key from step 1.6.
4. Push to `main`. `.github/workflows/deploy.yml` builds and deploys to
   Pages on every push to `main`; `.github/workflows/ci.yml` runs lint,
   typecheck, tests, and build on every pull request.

### Custom domain

If you point a custom domain at your Pages site, you need to add its exact
origin (scheme + host, e.g. `https://your-domain`) as an additional
Authorized JavaScript origin on the OAuth client from step 1.5, by hand.
Google provides no public API for managing OAuth clients on personal
(non-Workspace) accounts, so this is a manual step in the Cloud Console
every time the set of origins changes.

## Development

```bash
git clone https://github.com/fabbarix/feeder-tc.git
cd feeder-tc
npm ci
```

Create `.env.local` in the repo root (already in `.gitignore` — never commit
it) with your own values from the provisioning steps above:

```
VITE_GOOGLE_CLIENT_ID=<your OAuth client ID>
VITE_GOOGLE_API_KEY=<your Picker API key>
```

Available scripts (see `package.json`):

| Command | What it does |
|---|---|
| `npm run dev` | Start the Vite dev server on port `5173`. |
| `npm run build` | Type-check (`tsc -b`) and build for production. |
| `npm run preview` | Preview a production build locally. |
| `npm run lint` | ESLint over the whole repo. |
| `npm run format` | Prettier, write mode. |
| `npm run typecheck` | `tsc -b` only. |
| `npm test` | Vitest — unit tests and Gherkin/BDD scenarios. |
| `npm run test:watch` | Vitest in watch mode. |
| `npm run test:e2e` | Playwright end-to-end suite, against mocked Google APIs. |

Port `5173` is reserved for `npm run dev` — it's the origin registered on
the OAuth client, so the real (or mocked, via `verify-google.html`)
Google sign-in flow only works from that exact port. `npm run test:e2e`
deliberately runs its own dev server on a different port (`5273` by
default, override with `E2E_PORT`) so it never collides with a dev server
you might have running for manual testing. See `TESTING.md` for the full
testing conventions, including how BDD feature files, msw mock handlers,
and accessibility checks are organized — read it before adding tests.

CI never calls real Google APIs; every automated test runs against mocked
Sheets/Drive/Picker responses (via `msw`).

## Privacy

Worth stating plainly, because it's genuinely unusual for a web app:

- No analytics, no crash reporting, no third-party scripts of any kind.
- No server Feeder's own team operates — there's nothing for anyone but
  Google to log your usage against.
- The only network calls the app makes are directly from your browser to
  Google's own APIs (Sheets, Drive, Picker, and Google Identity Services for
  sign-in), authenticated as you, on your behalf. Nothing is proxied through
  a third party.
- Your meal-planning data lives entirely in a Google Sheets spreadsheet you
  own and control.

## License

MIT — see [`LICENSE`](LICENSE).
