# Feeder — agent notes

Project-specific operational notes. The authoritative documents are
`HANDOVER.md` (context + the nine invariants), `DESIGN.md` (product design),
`IMPLEMENTATION_PLAN.md` (work packages), `UI_DESIGN.md` (design system),
`STATUS.md` (current state), and `TESTING.md` (test conventions + port table).
Read those for anything substantive; this file is just the things that are
easy to get wrong because they are not discoverable from the code.

## Google Cloud CLI

**`gcloud` is NOT on `PATH`.** It lives at:

```
~/google-cloud-sdk/bin/gcloud
```

So invoke it by full path, e.g.:

```bash
~/google-cloud-sdk/bin/gcloud config get-value project
```

Already authenticated and configured — do not re-run `gcloud init` or
`gcloud auth login`:

- **Account:** `fabbari@gmail.com`
- **Project:** `feeder-tc` (project number `360506420836`)

### Useful reads

```bash
G=~/google-cloud-sdk/bin/gcloud

# API keys and their referrer restrictions
$G services api-keys list \
  --format='table(uid,displayName,restrictions.browserKeyRestrictions.allowedReferrers)'

# Full restriction state for one key (do this BEFORE any update — see below)
$G services api-keys describe <UID> --format=yaml
```

### The Picker API keys — production and dev are now SEPARATE

Split on 2026-08-21. Both are restricted to `picker.googleapis.com` only:

| Key | uid | Allowed referrers |
|---|---|---|
| `feeder-tc web (Picker)` | `be2d2e1a-04c0-4975-970e-5aebe4dbb8be` | `https://feeder.torchetti.us/*`, `https://fabbarix.github.io/feeder-tc/*` |
| `feeder-tc web (Picker) — dev` | `7fe988c3-2e6f-4cd6-88c8-f02cc05a6350` | `http://localhost:5173/*` |

Local dev uses the **dev** key via `.env.local`'s `VITE_GOOGLE_API_KEY`; the
production key lives in the GitHub Actions secret. Do not put `localhost` back
on the production key — that was the point of the split.

Fetch a key's string with
`gcloud services api-keys get-key-string <UID>`. Browser keys are public by
design (they ship in the JS bundle), but there is still no reason to paste one
into a transcript — have the user run it.

**`api-keys update` REPLACES the whole restriction set**, it does not merge.
Restate every restriction you want to keep — including `--api-target` — or you
will silently widen the key to every API in the project. Always `describe`
first.

**Do NOT pass `--clear-restrictions` alongside the restriction flags** —
gcloud rejects the combination as mutually exclusive, and you do not need it,
because the update replaces the set anyway. The working shape is:

```bash
$G services api-keys update <UID> \
  --api-target=service=picker.googleapis.com \
  --allowed-referrers="https://feeder.torchetti.us/*,https://fabbarix.github.io/feeder-tc/*"
```

Referrer restrictions limit quota abuse, not data access — the OAuth
`drive.file` scope is what gates actual data.

### Write operations may be blocked

Read commands run fine. **Mutating commands** (`api-keys create`,
`api-keys update`, …) can be refused by the permission classifier. Do not try
to work around a refusal. Stop, explain what you were trying to do and why,
and offer the user the exact command to run themselves — in this CLI they can
run it inline by prefixing with `!`.

### Provisioning

OAuth client, consent screen, scopes and the Pages/custom-domain setup are all
documented in `HANDOVER.md` §7. Invariant 8: only the `drive.file` scope is
ever permitted — never widen it.

## Environment gotchas that have cost real time

- **Never use `pkill -f`.** It has matched and killed the wrong process twice
  here, including another agent's dev server and a shell. Find the specific
  PID, or move to a different port.
- **Port 5173 is reserved** for `npm run dev` — it is the registered OAuth
  origin. Every parallel agent gets its own `E2E_PORT`; see `TESTING.md`.
- **CI only runs on `pull_request`.** There is no check on `main`, so a PR
  that is green on its branch can still break the merge. Always re-verify
  `main` locally after merging.
- **A red local result can be environmental.** A `typecheck` failure on `main`
  once turned out to be a stale `node_modules` missing a newly added
  dependency. Run `npm ci` before believing a fresh failure.
- **`rem` is a trap** — root font-size is 18px, so `rem` runs ~15% oversized
  versus the mock. Use px.
- **DNS:** the owner's LAN dnsmasq wildcards `torchetti.us`, so `dig` lies
  about the production domain. Verify with DNS-over-HTTPS or
  `curl --resolve feeder.torchetti.us:443:185.199.108.153`.
