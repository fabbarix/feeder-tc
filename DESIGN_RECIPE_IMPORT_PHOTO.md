# Design addendum — recipe import from a photo

**Status: PROPOSAL — not yet owner-approved.** Research task, no code changes.
Companion to `DESIGN_PHOTOS.md` (the existing 512px/32KB photo pipeline, which
this addendum extends, not replaces) and to whatever the sibling agent
produces for import-from-a-link — that document owns structured output,
ingredient matching, unit conversion, validation and the review screen in
general; this one states this feature's position on those and defers detail
to it. Read `HANDOVER.md` invariants 3, 6, 7, 8 first; this proposal violates
none of them.

## 0. The recommendation, in one paragraph

Build it as a **pure client-side integration**: the browser encodes a
capture-resolution photo (not the 512px thumbnail — see §2), sends it
directly from the browser to an OpenAI-compatible `/chat/completions`
endpoint the household configures (base URL + API key, entered by the
household and held in `localStorage`, never in `VITE_` env or the repo),
requesting a JSON-Schema-constrained structured output shaped like a draft
`Recipe`/`RecipeIngredient[]`/`RecipeStep[]`. Verified today
(2026-08-24, curl evidence in §3) that OpenAI's API answers CORS preflights
with a reflected `Access-Control-Allow-Origin`, so this is not blocked by
invariant 7 — no proxy is needed for OpenAI itself. The model's draft is never
written to the workbook directly: it lands on the existing recipe-editor
review screen, pre-filled, with every ingredient line run through the same
catalogue-matching/unit-conversion path a human typing "1 cup flour" already
goes through, so a bad model read costs the household one edit, not silent
corruption. This works well for **printed** text (cookbook pages, magazine
clippings) and works *unevenly* for **handwriting** — legible cursive is
usually fine, cramped or faded pencil is not, and the design leans on the
review screen (not the model) to catch that. The single largest residual risk
is a locally-hosted OpenAI-compatible server that does not send CORS headers
at all, which would silently fail in-browser; §3 covers the mitigation.

## 1. Where the key lives, and what happens before there is one

**Invariant 7 (no server-side components) is why this has to be the
household's own key, held client-side.** `VITE_*` build variables are public
— they ship in the bundle read by anyone who loads the site — so the existing
`VITE_GOOGLE_API_KEY` is fine only because it is a referrer-restricted,
Picker-only key (see `CLAUDE.md`). An LLM API key is not that kind of
credential: it is billable and, on OpenAI, has no equivalent to "restrict to
this API and these referrers" for chat completions. It must never be a build
variable, a repo secret, or a GitHub Actions variable.

**Decision: the household enters their own key into a Settings field,
client-side, once per browser.**

- Stored in `localStorage`, alongside the existing sync/cache state (already
  the trust boundary for this app — Sheets tokens and the cached snapshot
  live there too). Not synced to the workbook: a Sheets cell is visible to
  every household member and to anyone the sheet is ever shared with, and
  `HANDOVER.md`'s "human-readable workbook" invariant 6 is exactly the wrong
  property for a secret. Each household member who wants this feature enters
  their own key on their own device.
- A companion field for the base URL, defaulting to
  `https://api.openai.com/v1`, so the same UI works for a local model server.
- **The risk, stated plainly:** anyone with access to that browser profile
  (shared family computer, browser extension, XSS in a dependency) can read
  `localStorage` and exfiltrate the key. This is a real, accepted risk, not a
  hidden one — it should be said in the Settings UI in plain language ("this
  key is stored only on this device and is never sent anywhere except the
  address above"), and the field should mask the value like a password input
  with a reveal toggle, matching how the Google client ID/API key are already
  documented as public-but-not-broadcast in `CLAUDE.md`.
- **Before a key exists:** the capture entry point (camera/gallery button on
  the recipe list, see §7) is not hidden — hiding a feature behind an unset
  precondition confuses more than it protects — but tapping it opens directly
  to a one-screen explanation ("To read a recipe from a photo, Feeder needs
  to send it to an AI service you choose and pay for.") with the two fields
  and a link to how to get an OpenAI key. No capture happens until both
  fields are filled in and a trivial reachability check succeeds (a cheap
  models-list or 1-token completion call) — cheaper than confusing the
  household mid-flow with a raw 401 after they already took the photo.

## 2. Can a browser reach the endpoint? Yes for OpenAI itself — verified

This is the question the brief called "close to fatal" if the answer were no,
so it was checked directly rather than assumed, with a throwaway curl spike
(no code left behind):

```
$ curl -s -i -X OPTIONS https://api.openai.com/v1/chat/completions \
  -H "Origin: https://feeder.torchetti.us" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: authorization,content-type"

access-control-allow-origin: https://feeder.torchetti.us
access-control-allow-headers: authorization,content-type
access-control-allow-methods: GET, OPTIONS, POST
access-control-max-age: 86400
```

Repeated with `Origin: http://localhost:5173` — same reflected-origin result.
**OpenAI's API answers CORS preflights by reflecting whatever `Origin` it is
sent, for both GET/POST, and allows the `authorization` header** — the
`Bearer <key>` header the SDK/fetch call needs. So a direct
`fetch("https://api.openai.com/v1/chat/completions", { headers: {
Authorization: ... } })` from `feeder.torchetti.us` or `localhost:5173` is not
blocked. This is real evidence from the live endpoint today
(2026-08-24), not an inference from documentation, because CORS behavior is
determined by the server's response headers, not documented API behavior.

**"OpenAI-compatible" is a protocol shape, not a CORS guarantee.** The brief
asks for a configurable base URL specifically so the household can point this
at a self-hosted server (Ollama, LM Studio, llama.cpp's server, vLLM). None of
those are guaranteed to send CORS headers by default — some do (Ollama's
server has shipped permissive CORS for browser use), some don't. **This is
the feature's real single point of failure for the "any OpenAI-compatible
endpoint" promise**, and it should be handled as data, not silently:

- The reachability check from §1 is exactly the moment this surfaces. A CORS
  failure looks like a generic network error to `fetch` (the browser refuses
  to expose the real reason to JS) — so the app cannot distinguish "wrong URL"
  from "server unreachable" from "server reachable but blocking browser
  origins" by the error alone. The plain-language message has to cover all
  three: *"Feeder couldn't reach that address from your browser. If this is
  your own server, check it's running and that it allows requests from
  `feeder.torchetti.us` (some server software needs to be told to allow
  browser requests — this is called 'CORS')."*
- Do not attempt a workaround (no-cors mode, a public CORS-proxy, JSONP-style
  tricks) — a no-cors request cannot read the response, and routing a
  household's photo and API key through a third-party proxy is a worse
  privacy posture than the thing being avoided. State the limitation and stop.

## 3. Capture resolution: send bigger than we store

**The existing 512px/32KB pipeline is for storage and display, and is the
wrong asset for reading a recipe's text — reusing it as-is was the most
likely way to make this feature fail quietly.** A cookbook page's body copy
is commonly 8–10pt; at 512px longest side, a full US Letter or A4 page photo
puts each character at a handful of physical pixels, well below what OCR-style
reading needs. `DESIGN_PRODUCTS.md`'s own measurements table shows *why* the
budget is tight (a noisy 512px photo already fights to stay under 32KB) — and
that table was tuned for "does this look like a recognisable product," a much
lower bar than "read every digit in '2 tbsp' vs '3 tbsp'."

**Decision: two different encodes of the same capture, for two different
purposes.**

1. **Model input** (new, this feature only): resize to a **longest side of
   1600–2000px**, JPEG (not WebP — see below) at a quality that keeps the
   file comfortably under the documented 50 MiB per-file API ceiling — trivial
   at this resolution; a 1600px photo compresses to a few hundred KB at
   q80–q85. This is never written to a Sheets cell and never touches the
   32KB budget — it lives only in memory/IndexedDB for the duration of the
   import, then is discarded once the recipe is saved or abandoned.
2. **Stored thumbnail** (unchanged): if the household wants a photo attached
   to the saved recipe, run the *same* capture through the existing
   `src/photos/encode.ts` pipeline exactly as today (512px/32KB WebP) — this
   is a separate, optional step, not a resize-down of the model input, since
   the encoder already takes a `Blob` and doesn't care what it's for.

Why 1600–2000px rather than "as large as possible": OpenAI's own vision
guidance describes images above a resolution threshold being downscaled and
tiled internally regardless of what's uploaded (the `detail: "high"` path
processes in ~512px tiles up to a capped input size) — sending 4000px does
not buy proportionally more legibility, only more upload time and cost, and
model providers commonly cap or resample well below full camera resolution
anyway. 1600–2000px is the point past which more resolution stops helping and
starts costing.

**Format: JPEG for the model input, not WebP.** The stored-thumbnail pipeline
picked WebP for its storage-density win, which doesn't matter here since
nothing is stored; JPEG is the more conservatively-supported format across
"any OpenAI-compatible endpoint," including smaller local servers that may
not decode WebP. The API docs confirm PNG/JPEG/WebP are all accepted by
OpenAI itself, but a third-party or local server implementing "OpenAI
compatible" is exactly where relying on the least common format bites.

**Is this the same capture path as the stored photo?** Same *source*
(camera/file input), forked *encode*. Concretely: the capture component reads
one `File`/`Blob` from `<input type="file" accept="image/*" capture>`, then
runs it through two independent async encodes — the new "model input" encoder
(simple resize+JPEG, no byte-budget search loop needed since there's no hard
ceiling to hit) and, optionally, the existing `encodePhotoDataUrl`. Nothing in
`src/photos/` needs to change; this feature adds a sibling encoder, not a
modification to the frozen 512px pipeline.

## 4. Encoding and limits — real numbers, not memory

From OpenAI's current API documentation (Context7, fetched 2026-08-24):

- **Data URI input is directly supported**: `{"type": "image_url",
  "image_url": {"url": "data:image/jpeg;base64,<...>"}}` on
  `/v1/chat/completions`, or `{"type": "input_image", "image_url":
  "data:image/jpeg;base64,<...>"}` on `/v1/responses`. **A hosted URL is not
  required** — which matters because, per the brief, Feeder has nowhere to
  host one. This resolves that concern cleanly.
- **Per-file size ceiling: 50 MiB.** A 1600px JPEG is 2–3 orders of magnitude
  under this; no practical cookbook photo approaches it.
- **Supported formats**: PNG, JPEG, WebP (and non-animated GIF, per the wider
  vision guide). JPEG is the safe common denominator for arbitrary
  "compatible" servers, per §3.
- **Multiple images per request are supported** — the `content` array simply
  takes more than one `image_url`/`input_image` part alongside the text part.
  Relevant directly to §5.
- **Detail levels** (`detail: "low" | "high" | "auto"`) trade token cost for
  resolution fidelity; `"high"` (or `"auto"`, which the model picks) is the
  right default for reading dense text — `"low"` downsamples aggressively and
  is meant for "what's roughly in this picture," not transcription.
- **Images are billed as prompt tokens**, computed from resolution/tiling
  (the token-counting endpoint documented above can quote this per-image
  before sending, which the app is not proposing to call live, but is useful
  to know exists for a future "estimate cost before sending" affordance).

None of this is provider-universal — a local server's real limits are
whatever it chooses to enforce — but these are the numbers to design the
happy path against, with the encoder from §3 keeping every real request far
under them regardless of provider.

## 5. Multi-page recipes: yes, one request, several images

A recipe spanning a verso/recto spread or continuing overleaf is common
enough (per the brief) to design for directly, and §4 confirms the protocol
supports it natively — no client-side stitching needed, which would risk
introducing seams or losing resolution.

**Decision: let the household add up to 3 photos per import**, each run
through the §3 model-input encoder independently, all placed as separate
`image_url` parts in one message alongside one text part with the extraction
instructions. Reasons for a cap rather than unlimited:

- Token cost scales per image (§4) — unbounded pages is an unbounded bill.
- Three covers the realistic cases named in the brief (a two-page spread; a
  card with a method continued on the back) with one spare.
- The capture UI (§7) shows added photos as a small strip with a delete
  button and an explicit "add another page" affordance, not an auto-multi-shot
  flow — the household decides page count, not the app guessing burst
  photography meant multiple pages.

The prompt should tell the model explicitly that multiple images may be one
continuous recipe (title/ingredients on page 1, method on page 2) so it
doesn't treat them as unrelated and produce two partial recipes — see the
schema/prompt sketch in §9.

## 6. Photograph quality: what fails, and what the app does about it

Named failure modes, from how vision-language OCR-style transcription
degrades in practice, cross-checked against what the review screen (§8, owned
jointly with the sibling agent's document) can plausibly catch:

| Failure | What actually happens | Mitigation |
|---|---|---|
| **Glare / glossy page reflection** | A reflected light source can wash out a rectangular patch of text; the model either guesses plausible-sounding text for the blown-out region or, in the affected line only, misreads digits (a `9` losing its bowl reads as `1`). | Client-side heuristic before sending: warn if the encoded photo is either very low in tonal variance (flat wash) or has a small saturated-white blob covering a large fraction of frame — a cheap canvas histogram check, not a model call. Phrase it as *"This photo has a bright glare spot — try tilting the page or the camera slightly."* Advisory, not blocking: let the household send anyway. |
| **Curvature (book spine bend)** | Text near the spine compresses/curves; the model still reads most of it (it's used to this from scanned-book training data) but can drop or merge words on the most curved lines. | No reliable client-side check; rely on the review screen catching an implausible line, and prompt guidance below telling the model to flag low-confidence lines rather than silently guess. |
| **Perspective skew** | A photo taken at an angle rather than square-on. Vision models tolerate moderate skew well; severe skew (>~20°) increases misreads especially on numbers. | Same client-side heuristic family: a cheap edge-detection-free check is not reliable enough to gate on; instead, show a capture-time framing guide (a rectangle overlay suggesting "fill the frame, hold the camera flat") — a UI nudge, not a validator. |
| **Shadow (phone/hand blocking light)** | Localized darkening, same failure shape as glare but darker. | Same histogram-style advisory as glare. |
| **Low light / motion blur** | Genuinely the hardest case — blur destroys fine strokes distinctly from the failures above, and is not just a contrast problem. | A client-side blur heuristic (Laplacian-variance-style sharpness check on a downscaled copy) is worth adding if this turns out common in practice; flagged here as a nice-to-have, not required for v1, since it adds real complexity for a failure mode the review screen also catches (implausible/garbled text is visibly wrong). |

**Design stance: never block sending.** Every check above is advisory —
a warning banner with a "retake" and a "send anyway" button, never a hard
gate. The household knows their own recipe card; a false-positive block on a
photo that would actually have worked is worse than an occasional bad read
that the review screen catches. This mirrors the "never trust model output"
instruction from the brief: the safety net is validation-before-save, not
photo gatekeeping.

## 7. Handwriting: honest assessment

**Uneven, and should be described to the household as uneven, not as a
solved capability.**

- **Clear, well-spaced cursive or print handwriting** (the common case for a
  card written carefully to be kept) — current-generation vision-language
  models read this comparably to typed serif text in a mediocre-quality scan.
  Ingredient lists (short lines, familiar vocabulary — "flour," "sugar,"
  "tsp") are the easiest part; the method prose is harder because it's longer
  and more idiosyncratic.
- **Faded pencil, cramped margin notes, family shorthand/abbreviations, and
  numbers written with personal quirks** (a European "7" with a crossbar, a
  "1" that looks like a "7", a fraction written as a stacked hand-scrawl) are
  the genuine failure zone — this is exactly where the brief's warning about
  "misread 500g instead of 50g" is most likely to originate, because a
  handwritten quantity has no font to disambiguate it.
- **There is no special-case handling to add for handwriting** beyond what
  already exists for print: same encoder, same prompt, same review screen.
  What changes is the messaging: when import completes, if the model itself
  reports low confidence on any field (see the schema's `confidence`/`notes`
  affordance in §9), the review screen should surface that plainly —
  *"Not sure about this quantity — check the original,"* — rather than
  presenting a handwritten-card import with the same unqualified confidence
  as a printed cookbook page. This is a strictly better experience for the
  emotionally important case the brief names, without inventing new
  infrastructure.
- **What this means for the recommendation**: this is good enough to be
  useful — it will get most of a grandmother's recipe card right, faster than
  retyping it — but it is not good enough to auto-save. That is precisely
  what a mandatory review-before-save already achieves, and is why this
  design does not treat handwriting as needing its own separate, more
  cautious code path: the one review screen has to be cautious enough for the
  harder case anyway.

## 8. The output contract: this feature's position (shared ground, kept short)

This is co-owned with the import-from-a-link document; stating the position
rather than re-deriving it:

- **Ingredient matching.** The prompt (§9) instructs the model to return
  free-text ingredient names, never invent an `IngredientId`. Client-side,
  each returned name is matched against the household's real catalogue via
  case-insensitive exact match first, then a simple normalized/fuzzy pass
  (strip plurals/punctuation, substring/edit-distance) reusing whatever
  matcher the link-import path builds (do not fork a second implementation —
  if it lands first, this feature imports it; if this lands first, keep the
  matcher in a shared, non-photo-specific module from the start). Three
  outcomes surface on the review screen, one row per parsed ingredient line:
  **confident match** (pre-selected, editable dropdown), **near-miss**
  (top 2–3 candidates shown, none pre-selected — the household picks or
  types), **no match** (offered as "add '<name>' as a new ingredient,"
  which routes through the existing ingredient-creation flow, never a silent
  catalogue write). Nothing is written to `RecipeIngredients` until every row
  resolves to a real `IngredientId`.
- **Units.** The model is asked for amount + a human unit string (whatever
  the recipe says — "cup," "g," "tbsp," "clove"), never a canonical `Unit`.
  That string is mapped to `EntryUnit` (rejecting/flagging anything outside
  `kg|g|lb|oz|l|ml|"fl oz"|piece|cup|tbsp|tsp`) and run through the existing,
  frozen `src/domain/units.ts` `convertEntryToCanonical` exactly once, exactly
  as a human typing the same values into the recipe editor already does today
  — this feature adds no new conversion path, it feeds the existing one from
  a different data source. When conversion needs a density
  (`gramsPerMl`/`gramsPerPiece`) the catalogue ingredient doesn't have, it
  fails exactly the way manual entry fails today: the row is flagged
  unresolved on the review screen, amount left for the household to enter
  directly in the ingredient's canonical unit. No new "guess a density"
  behavior is introduced anywhere.
- **Validation.** Every draft field is re-validated against the real `make*`
  constructors in `src/domain/types.ts` (non-empty strings, finite quantities,
  valid `MealTag`s, etc.) before the review screen ever renders it as
  editable — a model hallucinating `mealTags: ["brunch"]` fails validation and
  the field renders empty/unset for the household to fill in, not silently
  coerced to something plausible-looking.
- **The review screen** is the existing recipe editor (`RecipeEditor.tsx`),
  pre-filled from the parsed draft rather than blank — not a new screen. This
  reuses the exact combobox-based ingredient picker and `EntryUnit` input
  already in place (confirmed by reading `RecipeEditor.tsx`: ingredients are
  already chosen from `ingredientsCatalog.find(...)` against a typed
  amount+`EntryUnit`), so the only new UI is the capture flow that feeds it
  and the per-line confidence/match affordances above.

## 9. Prompt and schema sketch

Concrete, not a paragraph. One request, 1–3 images, `response_format:
json_schema` with `strict: true` so the shape is enforced server-side as well
as client-side.

**Request shape** (`/v1/chat/completions`, OpenAI-compatible):

```jsonc
{
  "model": "<household-configured, default gpt-5.6 class or local equivalent>",
  "messages": [
    {
      "role": "system",
      "content": "You transcribe a recipe from one or more photographs of a cookbook page, recipe card, or clipping into structured data. Read exactly what is written — do not invent, complete, or improve a recipe. If a quantity or word is unclear or illegible, set its `confidence` to \"low\" and put your best literal reading in the field anyway plus a note in `notes`; never silently guess a plausible-sounding value instead of what's actually written. If multiple images are provided, treat them as one recipe (e.g. ingredients on one page, method continued on another) unless they are clearly unrelated."
    },
    {
      "role": "user",
      "content": [
        { "type": "text", "text": "Transcribe this recipe." },
        { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,<page-1>", "detail": "high" } },
        { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,<page-2>", "detail": "high" } }
      ]
    }
  ],
  "response_format": {
    "type": "json_schema",
    "json_schema": {
      "name": "recipe_draft",
      "strict": true,
      "schema": {
        "type": "object",
        "additionalProperties": false,
        "required": ["name", "servings", "prepMinutes", "cookMinutes", "ingredients", "steps", "confidence"],
        "properties": {
          "name": { "type": "string" },
          "servings": { "type": "integer" },
          "prepMinutes": { "type": "integer" },
          "cookMinutes": { "type": "integer" },
          "ingredients": {
            "type": "array",
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": ["rawText", "amount", "unit", "ingredientName", "confidence"],
              "properties": {
                "rawText": { "type": "string", "description": "The line exactly as written, e.g. '2 cloves garlic, minced'" },
                "amount": { "type": "number" },
                "unit": { "type": "string", "description": "Unit as written: cup, tbsp, tsp, g, kg, oz, lb, ml, l, piece, clove, etc." },
                "ingredientName": { "type": "string", "description": "Bare ingredient name only, no quantity/prep notes" },
                "preparationNote": { "type": ["string", "null"], "description": "e.g. 'minced', 'room temperature'" },
                "confidence": { "type": "string", "enum": ["high", "low"] }
              }
            }
          },
          "steps": {
            "type": "array",
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": ["stepNumber", "description", "confidence"],
              "properties": {
                "stepNumber": { "type": "integer" },
                "description": { "type": "string" },
                "confidence": { "type": "string", "enum": ["high", "low"] }
              }
            }
          },
          "confidence": { "type": "string", "enum": ["high", "low"], "description": "Overall confidence in this transcription" },
          "notes": { "type": ["string", "null"], "description": "Anything illegible, ambiguous, or uncertain that the household should double-check" }
        }
      }
    }
  }
}
```

Notes on the sketch:

- **`rawText`/`ingredientName`/`unit` split** deliberately keeps the model's
  literal parse separate from the client-side matching-and-conversion step in
  §8 — the model never sees the household's catalogue and never picks an
  `IngredientId` or canonical `Unit`; that stays entirely client-side against
  real data.
- **Per-line `confidence`**, not just an overall one, is what powers the
  "not sure about this quantity" affordance in §6/§7 — a recipe can be mostly
  clear with one smudged line, and the review screen should flag that one
  line, not the whole import.
- This is a sketch to hand to implementation, not a final contract — the
  implementer should pressure-test the schema against a handful of real
  photos before locking it, and reconcile field names with whatever the
  sibling link-import document lands on for the shared draft shape (both
  features should probably produce the *same* intermediate "parsed recipe
  draft" type, feeding the same review screen).

## 10. Cost, rate limits, and runaway spend

- **Rough cost per import**: dominated by image tokens. At `detail: "high"`
  and ~1600–2000px, OpenAI's tiling produces on the order of ~1,000–1,700
  input tokens per image (documented tiling formula: a fixed base cost plus
  ~170 tokens per 512px tile after an initial resize/tiling pass); 1–3 images
  plus a short text response puts one import at roughly the cost of a
  paragraph or two of GPT text generation — a small fraction of a US cent to
  low-single-digit cents on current OpenAI pricing for a GPT-5-class model,
  reasonable for an occasional household action. Exact pricing is
  provider/model-specific and changes; the app should not hardcode a cost
  estimate into copy that will go stale, but *can* surface the provider's
  actual `usage.prompt_tokens`/`completion_tokens` from the response after
  the fact ("this import used about N tokens") if that's judged useful.
- **What stops a stuck loop billing the household**: this is a single
  request-response action initiated by an explicit household tap, not a
  background/retry loop — there is no automatic retry-on-failure (a failed
  parse surfaces the raw error and a manual "try again" button), no polling,
  and no server-side component that could retry unsupervised (invariant 7
  again: there's nothing running when the household isn't looking). The one
  loop-shaped risk is a household retrying the same photo repeatedly hoping
  for a better read — mitigated by nothing more than the same manual-action
  friction already gating it; a client-side "you've sent this 3 times,
  are you sure?" nudge is cheap to add if this proves to matter in practice
  but isn't required for v1.
- **Rate limits** are the provider's own (OpenAI enforces per-account
  RPM/TPM tiers); a 429 should surface as a plain-language "try again in a
  moment" rather than a raw status code, same treatment as any other network
  error in this app.

## 11. Privacy

- **What is actually sent**: the 1–3 model-input images (§3, 1600–2000px
  JPEG — not the stored thumbnail, not the full-resolution original) plus the
  system/user prompt text (§9). Nothing else — no household data, no other
  recipes, no pantry contents, no account identifiers beyond what the
  provider's own API auth requires.
- **Where it goes**: whatever base URL the household configured — by default
  OpenAI's API (a third party, per OpenAI's own terms **not** used to train
  models by default for API traffic, but this is the provider's policy, not
  something Feeder can enforce or verify), or a self-hosted endpoint the
  household controls entirely, in which case nothing leaves their network.
- **Before it happens**: the one-screen explainer from §1 ("Feeder needs to
  send it to an AI service you choose") is the disclosure moment — it should
  say plainly *which* address the photo is going to (render the configured
  base URL back to the household right there: "This will be sent to
  api.openai.com" or "This will be sent to your own server at
  <configured-url>"), not bury it in a settings page the household filled in
  once and forgot. A family recipe card is exactly the kind of personal
  content the brief is right to flag — the disclosure should name the
  destination, not just describe the mechanism abstractly.

## 12. Offline

- **A photo taken offline is a real queue candidate, unlike a pasted link**,
  per the brief — capturing a photo needs no network at all, only *sending*
  it does. Decision: **capture and encode work fully offline** (camera/file
  picker and the §3 resize both run client-side); the send step queues if
  offline and fires once connectivity returns, surfaced as a pending item
  ("Waiting to read this photo — will try when back online") rather than
  failing outright.
- **This is deliberately not the `InventoryEvents` outbox** (invariant 9:
  offline writes there are events, append-only, no in-place edits) — a queued
  photo-import is not an inventory write at all, and more importantly it
  isn't idempotent or append-safe the way an event is: replaying it twice
  means two API calls and two drafts, not two harmless facts. It should be
  its own small queue (one pending item per photo-import-in-progress, keyed
  so a second attempt at the same item doesn't double-fire), separate from
  `src/sync/outbox.ts`, more like "one deferred action" than "an event log."
  Once the response comes back, it lands on the review screen exactly as if
  it had been sent live — nothing about being queued changes the
  save-after-review contract from §8.
- **What does NOT queue**: the actual `Recipe`/`RecipeIngredients`/
  `RecipeSteps` write to the workbook. That only happens after the household
  reviews and confirms, exactly like every other recipe save today, and reuses
  whatever write path already exists (which does participate in the ordinary
  online/offline handling other writes get — this feature adds nothing new
  there).

## 13. Model choice

- **What's genuinely needed**: a model with real vision *and* structured
  (JSON-Schema-constrained) output support together — not every "vision
  model" supports both cleanly, and requesting `strict: true` JSON schema
  alongside image input is the actual capability bar, not raw OCR. Current
  frontier multimodal chat models (the GPT-5 family and comparable-tier
  models from other providers reachable through an OpenAI-compatible shim)
  clear this bar comfortably.
- **Local models are realistic for the "reads reasonably clear print"
  case, honestly weaker for handwriting and structured-output strictness.**
  A locally-hosted vision-capable model (served through something exposing an
  OpenAI-compatible `/v1/chat/completions`) can do this, at real hardware
  cost (a capable open vision-language model is not a laptop-CPU workload)
  and generally weaker handwriting performance and less reliable schema
  adherence than a hosted frontier model — some local serving stacks support
  grammar-constrained/JSON-mode output, some don't, which is precisely why
  the household-configured base URL matters rather than assuming OpenAI. This
  design does not depend on any specific provider working well; it depends on
  the protocol (image input + JSON schema output over
  `/chat/completions`-shaped HTTP) being what's configured, and degrades
  gracefully (worse transcription quality, still caught by review) rather
  than breaking when pointed at a weaker local model.
- **Not recommended for v1**: trying to auto-detect or auto-select a "best"
  model per request — the household picks a model name as part of the same
  settings entry as the base URL/key; getting that right is out of scope for
  the household to reason about per-import.

## 14. What this looks like on screen

Four jargon sweeps have run on this codebase already; none of the words
"endpoint," "token," "vision model," or "API" belong in this UI copy.

- **Entry point**: a camera icon alongside the existing "add recipe"
  affordance on the recipe list — "Add from a photo." Tapping it, with no
  service configured yet, goes straight to the one-screen explainer from §1
  rather than a dead end.
- **Capture screen**: camera/gallery picker, a light framing guide ("hold the
  camera flat, fill the frame"), a thumbnail strip of added pages with an
  "add another page" button (capped at 3, §5), and a single "Read this
  recipe" action. Any of the advisory quality warnings from §6 appear here as
  a calm inline banner under the relevant photo, never a modal block.
- **In flight**: "Reading your recipe…" with the photo(s) visible behind a
  light overlay — this can take several seconds to ~half a minute depending
  on provider/model, so it needs a real waiting state, not a spinner that
  looks stuck.
- **Review screen**: the existing recipe editor, pre-filled. Each ingredient
  line shows its matched ingredient (or the near-miss/no-match affordances
  from §8) inline, not as a separate pass. Any line the model flagged
  low-confidence carries a small "double-check this — the photo wasn't
  totally clear" note next to the field, in the same visual language the kit
  already uses for warnings. Saving is the same "Save recipe" action that
  exists today; nothing is written before that tap.
- **Errors, in plain language**:
  - Unreachable/CORS-blocked server: *"Feeder couldn't reach that address
    from your browser. If this is your own server, make sure it's running and
    set up to allow requests from this website."*
  - Wrong/expired key: *"That key wasn't accepted — check it's typed
    correctly, or that it hasn't expired."*
  - Rate limited: *"The AI service is busy right now — try again in a
    moment."*
  - Model returned something unusable (schema violation, empty): *"Feeder
    couldn't make sense of what came back. You can try again, or add this
    recipe by hand."* — always leave a working escape hatch to the ordinary
    blank recipe editor.

## 15. Top risks and open questions (for the owner)

1. **CORS is confirmed for OpenAI, unconfirmed in general.** The whole
   "point it at anything OpenAI-compatible" promise rests on the target
   server sending CORS headers, which is a per-server choice this project
   doesn't control. Settled for OpenAI itself (§3, curl evidence); would need
   spot-checking against whichever local-model server the household actually
   picks (Ollama and LM Studio are the common ones and are worth a real check
   before promising them by name).
2. **Handwriting quality is a real, not cosmetic, limitation** (§7) — this
   should be set as the household's expectation up front ("works well for
   printed recipes, best-effort for handwriting — always check before
   saving"), not discovered by them on their grandmother's card.
3. **A misread quantity is the dangerous failure and the review screen is the
   only backstop** — there is no way to make the model reliably self-report
   "500 vs 50" type errors (a per-field `confidence` flag helps but is not a
   guarantee: the model can be confidently wrong). This is inherent to the
   approach, not a gap in this design specifically, and is exactly why
   nothing here proposes auto-save or a lighter-touch review for
   "high-confidence" imports.

**What would settle the open question**: a short manual spike once
implementation starts — point the sketch in §9 at 5–10 real photos (a couple
of printed cookbook pages, a magazine clipping, a clearly-written recipe card,
a genuinely messy one) and at Ollama/LM Studio running a small vision model
locally, and record actual CORS behavior and transcription quality. That is
implementation-phase validation, not something to block this proposal on.
