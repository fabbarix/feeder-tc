# Design addendum — recipe import from a link

**Status: PROPOSAL — not built, not owner-approved.** Research only, dispatched to
answer "can this be built at all under invariant 7, and how." Companion to
`DESIGN.md` (authoritative product design), `HANDOVER.md` §4 (invariants), and
`src/domain/units.ts`/`types.ts` (frozen contracts this must land inside). A
sibling document covers the same pipeline starting from a photograph instead of a
link; this one states its own position on the shared back half (structured output,
ingredient matching, unit conversion, validation, review screen) rather than
re-deriving it — reconcile the two before dispatching either.

`DESIGN.md` §6 currently lists "no nutrition or recipe import/scraping" as a
non-goal. Building this needs that non-goal lifted, the same way unit conversion
and cost tracking were each lifted by an explicit owner amendment before their
milestones shipped. That amendment is part of what this proposal asks for.

## 0. Recommendation, up front

**Buildable, without a backend, with one real gap the owner has to accept:** the
app cannot fetch an arbitrary recipe page's content itself (§3). The paste box
therefore has to accept either a link *or* pasted text, and for most sites in
practice it will be pasted text. Everything downstream of "we have the page's text"
— sending it to an OpenAI-compatible endpoint with a JSON-schema response format,
matching ingredients against the household's catalogue, converting units at entry
time, and forcing a review screen before anything is written — fits the existing
architecture cleanly and mostly reuses machinery that already exists (`RecipeEditor`,
`convertEntryToCanonical`, the product-merge confidence pattern). The household
supplies their own key for their own chosen provider; it lives in `localStorage` on
that device, sent only to the endpoint the household configured, never to Google.
That is a real, disclosed risk, not a solved one — see §1.

If the owner wants the app itself to reach out and grab a page by URL with no paste
step, that needs either a server-side fetch proxy (a backend — ruled out by
invariant 7) or the model's own hosted browsing tool, which is real but is not part
of the OpenAI-compatible *Chat Completions* surface this feature is scoped to (§3
explains why) and would tie the feature to specifically OpenAI's Responses API,
contradicting "point it at anything speaking that protocol." Recommendation: build
the paste-text path now; do not promise URL-fetch-by-the-app.

## 1. Where the key lives

**Decision: the household supplies its own key for its own chosen provider. It is
entered in Settings, stored in `localStorage` on that device, and sent only in
requests to the base URL the household configured.**

### Reasoning

A `VITE_`-prefixed build variable is baked into the public GitHub Pages bundle —
every visitor to the site can read it in the served JS. The project's own rule
(`CLAUDE.md`, `HANDOVER.md` §7) is that such variables hold public identifiers only
(a Picker key restricted to one API and one referrer list), never a secret. An
OpenAI-compatible key is a secret: whoever holds it can spend against the
household's account. So it cannot be a build-time value; it has to be something
each household enters for themselves, exactly like they each create their own
Sheets workbook.

There is already a precedent for exactly this trade-off in this codebase.
`src/sheets/auth.ts` persists the Google OAuth **access token** — also a bearer
credential — to `localStorage`, a decision reversed from the original "never
persist" rule after the owner explicitly accepted the cost ("ugly — but makes for
a better user experience," 2026-08-21). That comment also gives the shape of an
honest risk writeup: state what an XSS on this origin gets, and what bounds it.
Applying the same discipline here:

- **What it costs.** Any XSS on `feeder.torchetti.us` can read `localStorage` and
  exfiltrate the key. Unlike the Google token, this credential does **not**
  expire in an hour — an OpenAI-style key is long-lived until the household
  revokes it. That is strictly worse than the Google precedent, not equivalent
  to it, and should be said to the owner in those terms, not glossed over by
  citing the precedent.
- **What bounds the damage.** Provider-side, not app-side, because the app has no
  way to scope the key itself:
  - The household should be told, in the UI, to create a **project-scoped or
    restricted key** where their provider supports it (OpenAI supports
    project API keys with usage limits), not their one account-wide key.
  - The household should be told to set a **spend cap** with their provider —
    this is the actual backstop for a stuck loop or a stolen key (see §7).
  - The app can restrict the key's *use* to one endpoint (only sent to the
    configured base URL, over HTTPS, only on an explicit "Import" action) but
    cannot restrict what the key itself is authorized to do once it leaves the
    browser — that authority lives entirely with the provider.
- **What the app does before a key is configured.** The paste-a-link screen is
  reachable but the "Import" action is disabled with plain text explaining a
  provider needs to be set up first (linking to Settings), rather than the field
  silently existing and failing on first use. Recipes can still be entered by
  hand exactly as today — this feature is additive, never a gate on recipe entry.
- **Entry UI.** A masked text field in Settings (`src/routes/Settings.tsx`),
  labelled in the household's language ("the address to send recipes to" /
  "the password for that", see §8 for exact copy), with the base URL and key as
  two separate fields — defaulting the base URL to nothing (not
  `https://api.openai.com/v1`), so picking a provider is an explicit act, not an
  implied default that quietly bills OpenAI. A "Remove" action clears both from
  `localStorage` and is the only thing this document asks to be easy to find.

### Rejected

- **Bake a household-wide shared key at build time.** Same class of mistake as
  putting a Sheets service-account credential in the bundle — every visitor to a
  public GitHub Pages site gets it. Rejected outright, not a close call.
- **A serverless proxy (Cloudflare Worker / Vercel function) to hide the key.**
  This is in fact the standard answer to "browser app, third-party paid API" in
  general — but it is a backend, and invariant 7 says adding one is not a
  decision this document may make. Flagging it here because it is the honest
  answer to "how would you normally solve this" and the owner should know it
  was considered and set aside, not missed.
- **IndexedDB instead of localStorage.** No meaningful security difference for
  this threat model (both are origin-scoped, both readable by same-origin
  script); not worth the added code path.

## 2. Can a browser reach an OpenAI-compatible endpoint at all? (CORS)

**Yes, for OpenAI itself and for the two most likely self-hosted alternatives —
verified against current behaviour, not assumed.**

Tested directly against the live endpoint from this research session (2026-08-24):

```
$ curl -i -X OPTIONS https://api.openai.com/v1/chat/completions \
    -H "Origin: http://localhost:6500" \
    -H "Access-Control-Request-Method: POST" \
    -H "Access-Control-Request-Headers: authorization,content-type"

HTTP/2 200
access-control-allow-origin: http://localhost:6500
access-control-allow-headers: authorization,content-type
access-control-allow-methods: GET, OPTIONS, POST
access-control-max-age: 86400
```

```
$ curl -i -X POST https://api.openai.com/v1/chat/completions \
    -H "Origin: http://localhost:6500" -H "Content-Type: application/json" \
    -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hi"}]}'

HTTP/2 401
access-control-allow-origin: *
vary: Origin
```

`api.openai.com` answers the preflight, reflects the requesting origin (and sends
`*` on the real request), and explicitly allows the `authorization` header —
i.e. a direct `fetch()` from `feeder.torchetti.us` with `Authorization: Bearer
<key>` reaches it and gets a real response, not a browser-level CORS failure. This
is Cloudflare-fronted and consistent with OpenAI intending browser clients to be
able to call it directly (their own docs, fetched via Context7 this session,
separately confirm the API supports project-scoped keys precisely for
lower-trust callers — "API keys must be kept secret and should never be exposed
in client-side code," which is a warning about *this exact use case*, not a
technical block on it).

For the "or anything speaking that protocol" half of the requirement:

- **Ollama** (`localhost:11434`, OpenAI-compatible `/v1/chat/completions`):
  allows `127.0.0.1`/`0.0.0.0` origins by default; a page served from
  `feeder.torchetti.us` needs `OLLAMA_ORIGINS` set to include that origin (or
  `*`) — one environment variable, well documented, not a code change here.
  Ollama itself only listens on localhost by default regardless, so this is
  inherently a same-machine setup unless the household exposes it further.
- **llama.cpp's built-in server**: reflects any `Origin` by default (`--cors-origins`
  defaults to `*`), so it works with zero configuration for the plain chat
  endpoint. (Its `--tools`/`--agent` modes narrow this to localhost-only for
  their own good reasons — irrelevant here, this feature never enables those.)
- **A provider that does not send CORS headers at all** (some smaller/older
  OpenAI-compatible wrappers): the browser blocks the request outright, with no
  workaround available from the page itself. This is a genuine per-provider gap,
  not a Feeder-side bug, and the failure has to be surfaced honestly (§8) rather
  than silently retried.

**Conclusion: CORS does not kill this design.** It does mean the settings screen
should say plainly that a self-hosted server may need "browser access" (their
term, not "CORS") turned on, with a link to that provider's own docs, and that the
error state for a CORS failure has to say "this address didn't answer the way
Feeder expects" rather than a raw browser console error, because a cook has no way
to diagnose a blocked preflight.

## 3. Can a browser fetch the recipe page's content?

**No, not reliably, and this is the hard limit of the whole feature.** Enumerated
honestly, as asked:

1. **The app fetches the URL itself with `fetch()`.** Blocked by the target
   site's CORS policy in the overwhelming majority of cases — recipe blogs have
   no reason to send `Access-Control-Allow-Origin` headers permitting
   cross-origin reads, and most don't. Rejected: this is exactly the "will
   usually fail" case the work order already anticipated, confirmed rather than
   assumed.
2. **The model fetches the URL itself**, via a hosted browsing/web-search tool.
   Real capability — but it is a **Responses API** feature (OpenAI's own docs,
   fetched this session: "The Responses API... provides built-in tools such as
   web search... "), not part of Chat Completions. A generic "OpenAI-compatible"
   third-party endpoint — a local model, most alternate vendors — implements
   Chat Completions, not OpenAI's Responses API and certainly not OpenAI's
   *hosted* web-search execution, which runs on OpenAI's own infrastructure and
   is meaningless to point at a different base URL. Building on it would
   silently narrow "any OpenAI-compatible endpoint" to "OpenAI itself, on the
   Responses API," contradicting the requirement. Rejected for that reason, not
   because the capability doesn't exist.
3. **Chat Completions "function calling" with a browser-executed fetch tool.**
   Tempting, but function/tool calls in Chat Completions execute wherever the
   *caller* runs them — here, the browser — so the tool's implementation would
   itself be `fetch(recipeUrl)` from the page, hitting the identical CORS wall
   as option 1. This adds a round trip and complexity for zero new capability.
   Rejected.
4. **The user pastes the page's text instead of its link.** Always works,
   costs nothing architecturally, and matches how a cook already behaves with a
   recipe blog today (copy the ingredient list into a notes app to skip the ads
   and the life story). **This is the recommended primary path.**
5. **A share-target flow** (PWA `share_target`, or a bookmarklet the household
   installs once): the *browser itself* has already loaded and rendered the
   page when the user taps "share," so its DOM/text is available client-side
   with no cross-origin fetch involved. This is the honest way to get "paste a
   link" to feel like pasting a link rather than pasting text — worth building
   as a fast-follow, out of scope for a first cut because a PWA share target
   needs its own registration/manifest work and testing across the household's
   actual phones, and a bookmarklet needs to be explained to non-technical
   users. Noted here so it isn't lost.
6. **A public CORS-proxy service** (`corsproxy.io` and similar) to fetch the raw
   HTML server-side, then hand it to the model. Rejected: it is itself a
   third-party backend the app would depend on, defeats "no server-side
   components" in spirit even though the code lives outside this repo, and
   leaks every recipe URL a household ever imports to an operator with no
   relationship to them.

**What ships: the paste box takes a URL *or* pasted page text, with the URL field
optional/informational** ("what recipe is this, in case the ingredient list needs a
source note") **and the text field required to actually run an import.** The
model never receives a bare URL expecting it to go fetch it — that would silently
hallucinate a recipe from the URL's words alone, which is worse than an honest
"paste the text" requirement. Copy for this is in §8.

## 4. Ingredient matching

**Position, stated briefly per the work order (the sibling photo-import document
owns the shared depth here — this is my agreement, not a re-derivation).**

Reuse the confidence-banded, human-confirmed matching pattern this codebase
already ships for `suggestProductMerges` (`src/domain/products.ts`,
`DESIGN_PRODUCTS.md` §8): token-Jaccard name similarity against the household's
`Ingredients` catalogue, biased toward **under-**matching. Concretely for import:

- **High confidence** (near-exact name match, e.g. model said "garlic" and the
  catalogue has "Garlic"): pre-fill the ingredient line, shown with a visibly
  different state (still editable, not locked) — not silently confirmed.
- **Medium/low confidence or no match**: leave the ingredient line unlinked, the
  same `ingredientId: null` state `RecipeEditor`'s `LineDraft` already models for
  a line the user hasn't picked yet, so the reviewer must actively choose an
  existing ingredient or create a new one via the catalogue's own "add
  ingredient" flow (out of scope here, already exists). **Nothing writes an
  ingredient row on the model's say-so alone.**
- The match runs entirely client-side, over the already-loaded `Ingredients`
  catalogue, and touches no new data — the model is asked for a *name string* per
  ingredient line, never for an `IngredientId`, which it cannot know and should
  never be asked to invent (see §6's schema).

A near-miss is therefore never "silently wrong" — it is either an editable
pre-fill the cook can see is a fill-in, not a confirmation, or an explicit blank
the cook must fill. This mirrors the product-merge rule's own stated reasoning
almost exactly ("a wrong confident merge prompt shown against the owner's real
data is worse than a missed one") — the same logic applies to a wrong confident
ingredient match corrupting the shopping list, which the work order calls out
directly.

## 5. Units

**Position: entry-time conversion only, via the one sanctioned module, exactly as
the product editor already does it — no new conversion path.**

The model is asked to return each ingredient line as `{ amount: number, unit:
EntryUnit }` — the same shape (`EnteredQuantity`) `src/domain/units.ts` already
accepts, using the household-facing unit vocabulary (`kg`, `g`, `lb`, `oz`, `l`,
`ml`, `fl oz`, `piece`, `cup`, `tbsp`, `tsp`) rather than inventing a new one, so
the schema in §6 constrains `unit` to exactly that enum. Once an ingredient line
is matched or chosen (§4), `convertEntryToCanonical(entered, ingredient.unit,
{ gramsPerMl: ingredient.gramsPerMl, gramsPerPiece: ingredient.gramsPerPiece })`
runs — literally the same call `RecipeEditor` already makes for a hand-typed
line (`RecipeEditor.tsx`, the `convertEntryToCanonical` import) — producing the
canonical `Quantity` invariant 3 requires, plus `displayQuantity`/`displayUnit`
for provenance exactly like a hand-entered line.

**What happens when it cannot convert** (mass ↔ volume with no density on that
ingredient, e.g. "1 cup flour" against an ingredient with no `gramsPerMl`):
`convertEntryToCanonical` already throws in this case by design (§10.1's own
rule: never guess a density). The import review screen catches that per-line, not
per-import — one unconvertible line does not block the other nine — and shows the
line with its **raw parsed amount and unit as free text**, unlinked from any
canonical `Quantity`, forcing the cook to either enter it manually (in the
ingredient's own unit) or set the ingredient's density once in the catalogue
(existing screen) and retry that line. Never a silent guess, never a default
density of `1.0` — same rule already established for the product editor,
unchanged here.

This is a genuinely narrow, already-solved-by-the-codebase problem — the
model's only job is to parse "2 cloves garlic" into a number, an
`EntryUnit`-shaped unit if there is one ("clove" is not in `EntryUnit`, so it
comes back as `piece` with the display text carrying "clove" — see §6), and a
name string. Everything after that is code this repository already has.

## 6. Prompt and schema

One request per import. No multi-turn conversation, no tool calls, no streaming
needed — a single Chat Completions call with a strict `json_schema` response
format (current OpenAI docs, fetched this session: "Structured Outputs can be
enabled by setting `response_format` to `json_schema`... When using strict
schema adherence, the model is guaranteed to follow the defined schema exactly").
An endpoint that does not support `response_format: json_schema` (some
older/smaller OpenAI-compatible servers) falls back to a plain-text prompt asking
for JSON and a best-effort `JSON.parse` — flagged in §9 as a real compatibility
gap, not silently patched over.

**Request shape:**

```jsonc
POST {baseUrl}/chat/completions
Authorization: Bearer {key}
Content-Type: application/json

{
  "model": "{household-configured model name}",
  "messages": [
    { "role": "system", "content": "<SYSTEM_PROMPT, below>" },
    { "role": "user", "content": "<pasted recipe text, verbatim, plus the optional source URL as a labelled line>" }
  ],
  "response_format": {
    "type": "json_schema",
    "json_schema": {
      "name": "recipe_import",
      "strict": true,
      "schema": { /* RECIPE_IMPORT_SCHEMA, below */ }
    }
  }
}
```

**System prompt** (plain-language constraints, matching what the codebase can
actually use — nothing here asks the model for an id it cannot know):

> You are extracting a recipe from text a home cook pasted from a webpage. Return
> only what the schema asks for. Use the ingredient's most common household name
> ("garlic", not "garlic cloves, minced"). If an amount has no clear unit (e.g.
> "a pinch", "to taste"), set unit to null and put the original words in note. If
> the pasted text is not a recipe at all (an article, an ad, an unrelated page),
> set isRecipe to false and leave everything else empty. Never invent
> ingredients, steps, or amounts that are not in the text. If servings aren't
> stated, leave servings null rather than guessing.

**Schema** (a subset of JSON Schema, matching Structured Outputs' documented
constraints — every field required, `additionalProperties: false`, optionality
expressed as nullable rather than omitted, per OpenAI's strict-mode rules):

```jsonc
{
  "type": "object",
  "additionalProperties": false,
  "required": ["isRecipe", "name", "servings", "prepMinutes", "cookMinutes", "ingredients", "steps"],
  "properties": {
    "isRecipe": { "type": "boolean" },
    "name": { "type": "string" },
    "servings": { "type": ["integer", "null"] },
    "prepMinutes": { "type": ["integer", "null"] },
    "cookMinutes": { "type": ["integer", "null"] },
    "ingredients": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["name", "amount", "unit", "note"],
        "properties": {
          "name": { "type": "string" },
          "amount": { "type": ["number", "null"] },
          "unit": {
            "type": ["string", "null"],
            "enum": ["kg", "g", "lb", "oz", "l", "ml", "fl oz", "piece", "cup", "tbsp", "tsp", null]
          },
          "note": { "type": "string" }
        }
      }
    },
    "steps": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["description"],
        "properties": { "description": { "type": "string" } }
      }
    }
  }
}
```

Deliberately absent from the schema: `IngredientId`, `RecipeId`, `StepId`,
`kind`, `mealTags`, `status`, category, photo — every one of those is either an
id the model cannot know (§4/§5) or a household judgement call (bought vs.
cooked, staple vs. in-rotation, which meal it's for) that belongs to the cook at
review time, in the existing `RecipeEditor` fields, not to the model. The schema
asks for exactly the words on the page, structured; nothing more.

## 7. Cost, rate limits, and what stops a stuck loop

One import = one request, no retries built in beyond a single automatic retry on
a transport-level failure (not on a bad/empty result — that surfaces as an error,
§8, rather than silently re-spending). Rough cost at today's OpenAI pricing for a
typical recipe page (a few hundred words in, a few hundred tokens of structured
JSON out) is a small fraction of a cent per import on a model like GPT-4o-mini —
immaterial for a household's actual import volume (a handful a week, not a
per-second loop). The real risk this section has to answer is not "is one import
expensive" but "what stops a *runaway* bill":

- **No polling, no background jobs, no retries-on-failure.** One user gesture
  (tap Import) makes exactly one request. There is no code path that calls the
  endpoint without a fresh tap.
- **A hard client-side timeout** (e.g. 30s) on the fetch, after which the UI
  shows a failure rather than hanging — bounds a single request's cost even
  against a misbehaving endpoint, though it cannot stop billing that already
  happened server-side by the time the timeout fires.
- **The actual backstop is provider-side, not app-side**, same conclusion as
  §1: a spend cap or usage limit set on the key at the provider. The app cannot
  enforce a budget on infrastructure it doesn't run — this has to be said to
  the owner plainly rather than implied to be handled.
- A local model (Ollama, llama.cpp) has no "cost" in the billing sense — the
  runaway-cost risk is specific to a paid provider, and disappears entirely for
  a household that self-hosts.

## 8. Privacy and offline

**Privacy.** Importing sends the pasted recipe text (and, if present, the source
URL) to whichever base URL the household configured — a third party, by design,
since that is the whole feature. This has to be disclosed at the point of use,
not buried in a settings screen the cook never opens: the Import button's
adjacent text should say plainly, in the cook's own words, something like *"This
sends the recipe text to [the address you set up in Settings] so it can be turned
into ingredients and steps. Nothing else about your kitchen is sent."* — true,
because the request body is exactly the pasted text plus the fixed system
prompt, never the household's pantry, plan, or Sheets data. No recipe text is
sent anywhere until that specific tap.

**Offline.** This feature requires a live connection to the configured endpoint —
it is not a queued write and does not belong in the outbox. With no connection,
the Import button is disabled with plain text ("Feeder needs to be online to read
a recipe this way — try again once you're connected"), exactly like any other
network-dependent action already is elsewhere in the app; there is nothing to
queue, because unlike an inventory event or a plan edit, "import this text" isn't
a fact about the household's kitchen that can be replayed later — it's a request
to a paid third party the app shouldn't fire off unsupervised the moment
connectivity returns. Once the model responds and the cook has reviewed and
edited the draft, **saving it** is the same recipe-write path that already works
offline today (no change needed there).

## 9. Model choice

The task is short-document extraction into a fixed schema — not reasoning, not
multi-step planning, not vision (that's the sibling document's problem). This
does not need a frontier model. A small, cheap model with reliable JSON-schema
adherence (OpenAI's "mini"/"nano" tier, or a comparably small local model served
by Ollama/llama.cpp) should do this well; the household's own model picker (a
plain text field for the model name, §1) is exactly right because "which model"
is a cost/quality trade-off only the household can make for themselves, and it
varies by provider. What actually matters more than model size is whether the
chosen model/server **honestly supports strict `json_schema` response
formatting** — a model that doesn't will either refuse the request or produce
JSON that doesn't validate, and §9's fallback (plain-text-JSON + best-effort
parse) is materially worse (no shape guarantee at all). This should be called
out in the Settings copy near the model field: "works best with a model that
supports structured output" — plain enough, and true.

## 10. Validation before anything is written

**Never trust model output — three layers, none skippable:**

1. **Schema/parse validation.** The response must parse as JSON and match the
   requested shape (`isRecipe`, `name`, `ingredients[]`, `steps[]` with the
   right primitive types). A response that fails this — malformed JSON, a
   provider that ignored `response_format` entirely, `isRecipe: false` — never
   reaches the review screen; it surfaces as an error (§11).
2. **Domain construction.** Every field is run through the frozen validating
   constructors in `src/domain/types.ts` (`makeQuantity`, the `RecipeStep`
   shape, etc.) and `convertEntryToCanonical` (§5) exactly as hand-entered data
   already is. A quantity that fails `Number.isFinite` (the model returned
   `"a lot"` as a number, or `NaN` from a bad parse) is caught here, not
   assumed away by the schema alone — schemas constrain shape, not sanity.
3. **Human review — mandatory, not optional.** The import result never writes
   to the workbook directly. It lands in the existing `RecipeEditor` as a
   pre-filled draft — same component, same Save button, same "nothing persists
   until Save" contract every hand-typed recipe already has. This is the
   single most important design choice in this document: it means every
   failure mode below is *recoverable by looking at the screen and fixing it*,
   never a silent corruption of the shopping list.

**Failure modes, named plainly, each with where it's caught:**

| Failure | Caught by | What the cook sees |
|---|---|---|
| Page wasn't a recipe at all | `isRecipe: false` from the model (§6) | "That doesn't look like a recipe — try pasting just the ingredients and steps." |
| Hallucinated ingredient (not on the page) | Nothing automated — this is the one real residual risk | Reviewed against the pasted text on the same screen (§11 keeps the source text visible) |
| Wrong quantity (e.g. misread "1/2" as "12") | Nothing automated beyond finite-number checks | Same — visible, editable, requires a look before Save |
| Missing steps / truncated output | Steps array simply short — no automated detection | Cook notices a 2-step recipe that should have 6; the source text stays on-screen to compare |
| Unmatched or ambiguous ingredient | §4's confidence banding | Blank ingredient line, cannot Save until picked |
| Unconvertible unit | §5's per-line catch | Raw text shown, cannot Save until resolved |
| Endpoint/network failure, bad key, CORS block | HTTP-level (§8/§2) | Plain-language error (§11), nothing written, retry available |

The two failures with no automated backstop (hallucinated ingredient, wrong
quantity) are why §11's review screen keeps the original pasted text visible
side-by-side with the draft, rather than only showing the structured result —
the cook's own read of the source is the actual check for those two, and hiding
the source would remove it.

## 11. What this looks like on screen

No new route needed — this extends the existing recipe creation flow rather than
adding a parallel one.

- **Entry point:** on the Recipes list, alongside "New recipe," a second action:
  **"Add from a recipe you found online."**
- **The paste screen:** one large text box — *"Paste the recipe here — the
  ingredients and steps, copied from the page"* — with an optional second,
  smaller field below it, *"Where did this come from? (optional)"* for the
  source URL, stored only as a note, never fetched. A single button: **"Read
  this recipe."** Disabled with inline text if no provider is set up yet
  (§1), linking to Settings.
- **While waiting:** a short, honest wait state — *"Reading the recipe…"* — no
  spinner longer than the actual request; the 30s timeout (§7) surfaces as
  *"That took too long — try again, or check the address in Settings."*
- **The review screen** is the existing `RecipeEditor`, pre-filled, with two
  additions:
  - A collapsible **"What you pasted"** panel holding the original text,
    visible by default the first time, so the cook can compare without leaving
    the screen (§10).
  - Each pre-filled ingredient line that was auto-matched (§4, high
    confidence) is shown with a small "matched" indicator distinct from a line
    the cook picked themselves — never implying more certainty than it has.
  - Everything else (name, servings, prep/cook time, meal tags, kind, status,
    steps, ingredient lines) is the same editable form a hand-typed recipe
    uses, including the same Save button — no separate "confirm import" step
    to build, because the editor's existing Save already is that step.
- **Errors** (§10's table) render as plain sentences in the same place the
  paste screen's other inline errors already show, never a raw HTTP status or
  a stack trace. No occurrence of "endpoint," "token," "model," or "API" in any
  of this screen's copy — "the address you set up in Settings," "the password
  for that address," "reading the recipe," "the recipe you're using to answer"
  (if a model-name field needs a label at all — it may not; see §9, a sensible
  default model name per common provider could avoid asking at all for
  OpenAI/Ollama's own defaults, leaving the field for households who know they
  want something else).

## 12. What I could not determine

- **Whether the household's actual chosen provider (if not OpenAI itself) sends
  CORS headers.** §2 verified OpenAI, Ollama's documented default, and
  llama.cpp's documented default; it did not and could not test every
  "OpenAI-compatible" wrapper in the wild. The Settings screen's error copy
  (§11) has to assume this will sometimes fail for a reason the app cannot
  diagnose, and say so honestly rather than guessing at a fix.
- **Real-world adherence to strict `json_schema` across non-OpenAI servers.**
  OpenAI's own strict mode is well-documented and was verified via Context7
  this session; Ollama/llama.cpp's OpenAI-compatibility layers claim support
  but weren't exercised end-to-end here (no live key/model was used — this was
  a research task, not an implementation, and no key was ever near this repo).
  Worth a small spike before committing to the schema exactly as drafted.
- **Exact per-token pricing at build time** — figures in §7 are order-of-magnitude
  from current public OpenAI pricing, not a guarantee; a local model has none of
  this concern.
- **Whether the owner wants the share-target flow (§3.5) as part of this
  milestone or a deliberate fast-follow.** I recommended fast-follow to keep the
  first cut small, but it's the difference between "paste text" and "actually
  paste a link" from the cook's point of view, and that gap might matter enough
  to the owner to reorder it.

---

# Decisions (owner, 2026-08-24)

Both research documents — this one and `DESIGN_RECIPE_IMPORT_PHOTO.md` — are
now settled by the following. Where they disagree with anything above, these win.

## 1. CORS is not a blocker, and it was measured

Verified by preflight from this repo, not assumed:

```
OPTIONS https://api.openai.com/v1/chat/completions
Origin: https://feeder.torchetti.us
→ HTTP 200
  access-control-allow-origin: https://feeder.torchetti.us
  access-control-allow-headers: authorization,content-type
  access-control-allow-methods: GET, OPTIONS, POST
```

Note the origin is **reflected**, not `*` — one research pass reported a
wildcard, which is wrong. Immaterial to the design, but the record should be
accurate.

## 2. Link import is possible beyond OpenAI — the earlier conclusion was too narrow

`DESIGN_RECIPE_IMPORT.md` concluded that fetching a page server-side meant
OpenAI only. That is not so. vLLM takes a `--tool-server` argument, opt-in and
off by default, exposing built-in `browser` and `python` tools through the
**Responses API**, with MCP tool servers supported and `allowed_tools`
filtering. So the real requirement is *"an endpoint implementing the Responses
API with a tool server enabled"* — OpenAI, or a deliberately configured vLLM.
Not stock Ollama, not stock LM Studio, not vLLM out of the box.

**Open question, to be settled by a spike before the link path is built:** the
vLLM path visible in its docs calls `call_tool("search", …)`. Whether that
browser tool can *open a specific URL* or only *search the web* is the
difference between "import this recipe" and "find me something like it". Do not
assume; prove it.

## 3. Both inputs, with paste-text as the floor

- Offer the **link** box when the configured endpoint exposes a browser tool.
- Offer **paste-the-text** always, on every endpoint, as the guaranteed path.
- The photo path is independent of both and works anywhere the endpoint accepts
  images.

A feature that silently disappears depending on a setting is worse than one
that is simply always there, so text is the floor and the link is the bonus.

## 4. Spend is guarded twice, independently

- **In the app:** a per-day import counter with a limit the household sets,
  refusing further imports with a plain-language message that says when it
  resets.
- **At the provider:** a hard spend cap, which is the only thing that can
  genuinely stop money leaving.

Neither relies on the other. The app-side counter exists because a stuck retry
loop can otherwise burn an entire monthly cap before anyone notices; the
provider cap exists because app-side counters live in the same browser storage
as the key and are no defence against a stolen one.

## 5. Timing

In scope for **v1.0.0**, at the owner's explicit direction, accepting that this
moves the tag out by a build-and-review cycle.

## 6. Unchanged from the research, and binding

- The key is the household's own, entered in Settings, stored in `localStorage`
  — **never** in the workbook, which the whole household shares, and never a
  `VITE_` variable, which ships in the public bundle.
- The model returns **free-text names and units only** — never an
  `IngredientId`, never a canonical `Unit`. Resolution happens client-side
  through the catalogue matcher and `src/domain/units.ts` (invariant 3).
- **Nothing is written until a person has reviewed it.** The dangerous failure
  is not a hallucinated ingredient but a misread quantity — 500 g for 50 g is
  plausible, easy to miss, and corrupts the shopping list. The review screen is
  the only real backstop, and no model can be relied on to flag itself as
  confidently wrong.
- The 512 px / 32 KB stored-photo pipeline is for storage and display. Reading
  text needs a **separate, larger encode used only as model input and
  discarded** — the stored-photo path is untouched.
- One shared matcher module serves both input paths. Two implementations of
  ingredient resolution would drift, and drift here means a wrong shopping list.
