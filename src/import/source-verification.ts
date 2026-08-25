/**
 * Recipe import (link path) — proving the reply actually read the page the
 * cook asked for, rather than something merely similarly named.
 *
 * Real evidence (owner's 2026-08-25 report): importing
 * `https://ricette.giallozafferano.it/Spaghetti-alla-Norma.html` produced a
 * `web_search_call` — `action.type: "search"` — with five candidate
 * `sources`, including the requested page and two differently-named near
 * misses ("Pasta alla Norma in bianco", "Pasta alla Norma leggera"). It
 * happened to read the right one, evidenced by the reply's own
 * `url_citation` annotation naming the requested URL — but that was ranking
 * luck, not a guarantee. `buildLinkTools` (`client.ts`) already asks the MCP
 * shape to `open` rather than `search`; OpenAI's native `web_search_preview`
 * offers no such restriction — the model chooses, and here it chose to
 * search. Since we cannot prevent that choice, this module *detects* it from
 * what the reply itself reports, so the cook is told when a returned
 * "Spaghetti alla Norma" might not be the page they meant.
 *
 * Two independent jobs, both pure (no I/O, no React):
 *
 *  1. `extractResponsesProvenance` — reads whatever a Responses-API reply's
 *     `output[]` says about what it did: each `web_search_call`'s
 *     `action.type` (`"search"` / `"open"` / anything else a provider
 *     invents) and, for a search, its candidate `sources`; and every
 *     `url_citation` annotation on the assistant message, which is the
 *     reply's own account of the URL it actually read. Absence is handled
 *     explicitly — a provider that reports none of this is a different,
 *     quieter situation from one that reports a mismatch (see
 *     `classifySourceVerification`).
 *  2. `classifySourceVerification` — compares every cited URL against the
 *     address the cook actually typed, tolerantly (`compareImportedUrls`):
 *     scheme, `www.`, host case, a trailing slash, and tracking parameters
 *     (`utm_*`, `fbclid`, …) never count as a difference — a plain
 *     canonicalising redirect on the same host is normal and benign, and
 *     flagging it would be exactly the noise that trains a household to
 *     stop reading warnings at all. A different path on the same host, or a
 *     different host outright, does count — that is the case the owner's
 *     report is about.
 *
 * `client.ts`'s `importRecipeFromLink` is the only caller — the text and
 * photo import paths have no fetched page to verify at all, and are
 * unaffected by anything here.
 */

/** One `web_search_call` entry, reduced to what a cook (via the diagnostic panel — never the plain review screen) might need to make sense of a puzzling import: what kind of action it was, what it searched for, and what it found. Fields are optional because different providers, and different action types, report different subsets of this. */
export interface ResponsesToolAction {
  readonly type: string;
  readonly query?: string;
  readonly sources?: readonly string[];
}

export interface ResponsesProvenance {
  readonly toolActions: readonly ResponsesToolAction[];
  /** Every `url_citation` annotation's URL, in the order the reply listed them — the reply's own account of what it actually read, as opposed to `toolActions[].sources`, which is only what it considered. */
  readonly citedUrls: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringsFromSources(sources: unknown): readonly string[] | undefined {
  if (!Array.isArray(sources)) return undefined;
  const urls = sources
    .map((source) => (isRecord(source) && typeof source.url === "string" ? source.url : undefined))
    .filter((url): url is string => url !== undefined);
  return urls.length > 0 ? urls : undefined;
}

function extractToolAction(item: Record<string, unknown>): ResponsesToolAction | undefined {
  const action = item.action;
  if (!isRecord(action) || typeof action.type !== "string") return undefined;
  const sources = stringsFromSources(action.sources);
  return {
    type: action.type,
    ...(typeof action.query === "string" ? { query: action.query } : {}),
    ...(sources ? { sources } : {}),
  };
}

function extractCitedUrlsFromMessage(item: Record<string, unknown>): readonly string[] {
  const content = item.content;
  if (!Array.isArray(content)) return [];
  const urls: string[] = [];
  for (const contentItem of content) {
    if (!isRecord(contentItem)) continue;
    const annotations = contentItem.annotations;
    if (!Array.isArray(annotations)) continue;
    for (const annotation of annotations) {
      if (isRecord(annotation) && annotation.type === "url_citation" && typeof annotation.url === "string") {
        urls.push(annotation.url);
      }
    }
  }
  return urls;
}

/**
 * Reads a Responses-API reply's own account of what it did — never throws;
 * a reply that carries none of this (no `output[]` at all, or one with
 * neither `web_search_call` entries nor citation annotations) simply comes
 * back with two empty arrays, which `classifySourceVerification` treats as
 * "couldn't tell," not as a mismatch.
 */
export function extractResponsesProvenance(json: unknown): ResponsesProvenance {
  const toolActions: ResponsesToolAction[] = [];
  const citedUrls: string[] = [];
  if (!isRecord(json) || !Array.isArray(json.output)) return { toolActions, citedUrls };

  for (const item of json.output) {
    if (!isRecord(item)) continue;
    if (item.type === "web_search_call") {
      const action = extractToolAction(item);
      if (action) toolActions.push(action);
    } else if (item.type === "message") {
      citedUrls.push(...extractCitedUrlsFromMessage(item));
    }
  }
  return { toolActions, citedUrls };
}

const TRACKING_PARAM_PATTERN = /^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$|igshid$)/i;

/** Normalizes one URL for comparison — lower-cased, `www.`-stripped host; scheme dropped entirely (http/https never counts as a difference); tracking parameters stripped; a single trailing slash on a non-root path ignored. Returns `undefined` for anything that doesn't parse as a URL at all, so a malformed address never crashes the comparison, only makes it inconclusive. */
function normalizeUrlForComparison(raw: string): { readonly host: string; readonly pathAndQuery: string } | undefined {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");

  const params = new URLSearchParams(url.search);
  for (const key of [...params.keys()]) {
    if (TRACKING_PARAM_PATTERN.test(key)) params.delete(key);
  }
  params.sort();
  const search = params.toString();

  let path = url.pathname;
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);

  return { host, pathAndQuery: search ? `${path}?${search}` : path };
}

export type UrlComparison = "same-page" | "same-site" | "different-site" | "incomparable";

/**
 * Compares two URLs the way a cook would judge "is this the page I meant" —
 * see this module's own doc comment for exactly which differences are
 * ignored. `"incomparable"` means at least one side wasn't a parseable URL
 * at all, which `classifySourceVerification` folds into "couldn't tell"
 * rather than either confirming or warning.
 */
export function compareImportedUrls(requestedUrl: string, otherUrl: string): UrlComparison {
  const a = normalizeUrlForComparison(requestedUrl);
  const b = normalizeUrlForComparison(otherUrl);
  if (!a || !b) return "incomparable";
  if (a.host !== b.host) return "different-site";
  return a.pathAndQuery === b.pathAndQuery ? "same-page" : "same-site";
}

export type SourceVerificationStatus =
  /** A cited URL matched the requested address (tolerantly) — say nothing on the review screen; a warning on the normal case is worse than none. */
  | "confirmed"
  /** Every cited URL was on the same host as requested, but at a different path — a real possibility, not a false alarm; the review screen must say so plainly. */
  | "different-page"
  /** At least one cited URL was on a different host entirely. */
  | "different-site"
  /** No citation to compare at all (a provider that reports nothing, or a search with no accompanying citation) — absence of evidence, not evidence of a wrong page. A quieter note, never a warning. */
  | "unconfirmed";

export interface SourceVerification {
  readonly status: SourceVerificationStatus;
  /** The cited URL this classification is based on — absent only for `"unconfirmed"`. */
  readonly citedUrl?: string;
}

/**
 * The one function `client.ts` calls once a link import has succeeded —
 * "honest classification," not a single is-it-fine boolean, because the
 * three non-confirmed outcomes deserve different treatment (this module's
 * own doc comment; DESIGN's owner requirement, 2026-08-25 follow-up: "lumping
 * them together is how a warning becomes noise").
 */
export function classifySourceVerification(requestedUrl: string, provenance: ResponsesProvenance): SourceVerification {
  if (provenance.citedUrls.length === 0) return { status: "unconfirmed" };

  for (const cited of provenance.citedUrls) {
    if (compareImportedUrls(requestedUrl, cited) === "same-page") {
      return { status: "confirmed", citedUrl: cited };
    }
  }

  // Nothing matched exactly — report the first citation. A reply that read
  // multiple pages and cited several is rare and not something the schema
  // captures order-of-importance for anyway; the first is as good a
  // representative as any for "here's what it actually read instead."
  const first = provenance.citedUrls[0]!;
  const comparison = compareImportedUrls(requestedUrl, first);
  if (comparison === "different-site") return { status: "different-site", citedUrl: first };
  if (comparison === "same-site") return { status: "different-page", citedUrl: first };
  return { status: "unconfirmed" };
}

export interface SourceVerificationNotice {
  /** `"warning"` — visible without being alarming, per the owner's requirement: "impossible to miss without being alarming." `"quiet"` — the same muted styling as any other hint on the review screen, never colored like a warning (absence of evidence is not evidence of a wrong page). */
  readonly tone: "warning" | "quiet";
  readonly text: string;
}

/**
 * The review screen's own copy for each non-`"confirmed"` outcome —
 * deliberately plain (CLAUDE.md's jargon rule: `url_citation`,
 * `web_search_call`, `annotation` are diagnostic-panel vocabulary, never
 * cook vocabulary) and, for the two warning cases, always naming both
 * addresses so the cook can judge for themselves rather than just being
 * told "something's off." Returns `undefined` for `"confirmed"` — the
 * owner's own words: "a warning on the normal case is worse than none,
 * because it teaches people to dismiss warnings," so the review screen
 * shows nothing at all rather than a quiet "all good" that nobody reads
 * either.
 */
export function describeSourceVerificationForReview(verification: SourceVerification, requestedUrl: string): SourceVerificationNotice | undefined {
  switch (verification.status) {
    case "confirmed":
      return undefined;
    case "unconfirmed":
      return {
        tone: "quiet",
        text: "Feeder can't confirm exactly which page it read this recipe from — check it against the address you gave before saving.",
      };
    case "different-page":
      return {
        tone: "warning",
        text:
          `Feeder read a different page on the same website than the one you gave. You asked for ${requestedUrl}, ` +
          `but it actually read ${verification.citedUrl}. You can still save this recipe if it's the one you wanted — just check it below first.`,
      };
    case "different-site":
      return {
        tone: "warning",
        text:
          `Feeder read a page on a different website than the one you gave. You asked for ${requestedUrl}, but it ` +
          `actually read ${verification.citedUrl}. You can still save this recipe if it's the one you wanted — just check it below first.`,
      };
  }
}
