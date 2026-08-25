import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useWorkbookContext } from "../workbook-context.ts";
import { RecipeImportError, importRecipeFromLink, importRecipeFromPhotos, importRecipeFromText } from "../import/client.ts";
import { describeRecipeImportError } from "../import/error-messages.ts";
import { getImportUsage, isRecipeImportConfigured, readRecipeImportSettings, recordImportUsed } from "../import/settings.ts";
import { resolveImportedLines, type ParsedRecipeDraft, type ResolvedIngredientLine } from "../import/match.ts";
import { assessPhotoQualityFromBlob, encodePhotoForModelDataUrl, type PhotoQualityAdvisory } from "../import/photo-encode.ts";
import {
  clearPendingPhotoImport,
  enqueuePendingPhotoImport,
  readPendingPhotoImport,
  type PendingPhotoImport,
} from "../import/photo-queue.ts";
import {
  clearImportHistory,
  formatDiagnosticForClipboard,
  IMPORT_FAILURE_CAUSE_LABEL,
  IMPORT_PROGRESS_LABEL,
  readImportHistory,
  recordImportAttempt,
  type ImportProgressStage,
  type RecipeImportDiagnostic,
} from "../import/diagnostics.ts";
import { createBrowserConnectivityMonitor } from "../sync/index.ts";
import { SegmentedControl } from "../ui/components";
import { Camera, Trash } from "../ui/icons";
import styles from "./forms.module.css";

/** "3s" / "42s" — the progress line's own elapsed-time readout. Not routed through `date-format.ts` (that module formats calendar dates, not a running stopwatch), and deliberately whole seconds only — a live request has nothing more precise worth showing. */
function formatElapsedSeconds(elapsedMs: number): string {
  return `${Math.max(0, Math.round(elapsedMs / 1000))}s`;
}

/** Records one failed attempt to the small capped history and re-reads it back — the diagnostic disclosure and the "recent attempts" list are the same data, so a failure just seen and a failure from ten minutes ago render identically. */
function recordAndRefreshHistory(diagnostic: RecipeImportDiagnostic, setHistory: (history: readonly RecipeImportDiagnostic[]) => void): void {
  recordImportAttempt(diagnostic);
  setHistory(readImportHistory());
}

/** Handed to `RecipeEditor` via router `state` — never persisted, discarded the moment the editor unmounts or the household navigates away without saving. */
export interface RecipeImportDraft {
  readonly parsed: ParsedRecipeDraft;
  readonly lines: readonly ResolvedIngredientLine[];
  readonly sourceText: string;
  readonly sourceUrl?: string;
  /**
   * The model-input-encoded photo(s) used for a photo import (1-3 data
   * URLs) — kept only in memory/router state, same lifetime as the rest of
   * this draft, never persisted to the workbook. `RecipeEditor.tsx` renders
   * these beside the ingredient lines so quantities can be checked against
   * the source image (DESIGN_RECIPE_IMPORT_PHOTO.md: "the review screen is
   * the only real backstop").
   */
  readonly photos?: readonly string[];
}

const MAX_PHOTOS = 3;

interface CapturedPhoto {
  readonly id: string;
  /** The model-input-encoded JPEG data URL — used both for the thumbnail and for the request itself. */
  readonly dataUrl: string;
  readonly advisory: PhotoQualityAdvisory;
}

type ImportMode = "paste" | "link" | "photo";

/**
 * The paste/link/photo screen (DESIGN_RECIPE_IMPORT.md §11,
 * DESIGN_RECIPE_IMPORT_PHOTO.md §14) — "Add from a recipe you found online."
 * Paste-text is the floor and always available, never conditional on
 * anything; the photo mode is always offered too (it depends on no setting);
 * the link mode only appears once the household has turned it on.
 *
 * The "where did this come from" field is a single field whose behaviour
 * follows the household's Settings toggle — never a second box that also
 * takes a URL but silently does something else (owner's own framing of the
 * defect this replaces). With the toggle off, it is exactly what it always
 * was: a provenance note saved with the recipe, never fetched. With the
 * toggle on and something typed into it, it becomes the real thing: the
 * page Feeder opens itself, via `importRecipeFromLink` (the Responses API,
 * with the browser tool enabled) — and in that case the pasted text above,
 * even if present, is not sent for that request. The copy next to the field
 * says which of the two is about to happen before the household taps
 * anything.
 */
export function RecipeImport() {
  const navigate = useNavigate();
  const { store, clock } = useWorkbookContext();
  const [settings] = useState(() => readRecipeImportSettings());
  const [searchParams] = useSearchParams();
  const [mode, setMode] = useState<ImportMode>(() => (searchParams.get("mode") === "photo" ? "photo" : "paste"));
  const [text, setText] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [online, setOnline] = useState(() => createBrowserConnectivityMonitor().isOnline());

  // Progress (owner's 2026-08-25 report: "a person watching a spinner for
  // twenty seconds with no idea whether it is stuck deserves better").
  // `progressStage` moves through the same four steps `client.ts`'s
  // `onProgress` reports; `nowMs` ticks independently so the elapsed-time
  // readout keeps moving during the long "waiting for a reply" stretch,
  // not just at the four stage transitions themselves.
  const [progressStage, setProgressStage] = useState<ImportProgressStage | undefined>(undefined);
  const [requestStartedAtMs, setRequestStartedAtMs] = useState<number | undefined>(undefined);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!loading) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [loading]);

  const progressElapsedMs = requestStartedAtMs !== undefined ? nowMs - requestStartedAtMs : 0;

  // Diagnostics, behind a disclosure (owner's 2026-08-25 report): the plain
  // headline above stays the only thing a cook has to read, but a household
  // debugging their own server gets the actual request/response one tap
  // away. `history` IS the disclosure's content — the attempt that just
  // failed is simply its newest entry, so there is only one list to build,
  // not a "current failure" panel plus a separate "past failures" panel.
  const [history, setHistory] = useState<readonly RecipeImportDiagnostic[]>(() => readImportHistory());
  const [detailsOpen, setDetailsOpen] = useState(false);

  const [photos, setPhotos] = useState<readonly CapturedPhoto[]>([]);
  const [photoProcessing, setPhotoProcessing] = useState(false);
  const photoIdCounter = useRef(0);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const [pendingPhotoImport, setPendingPhotoImport] = useState<PendingPhotoImport | undefined>(() => readPendingPhotoImport());

  useEffect(() => {
    const monitor = createBrowserConnectivityMonitor();
    return monitor.subscribe(setOnline);
  }, []);

  // Fires a queued photo import the moment connectivity is (or becomes)
  // available — DESIGN_RECIPE_IMPORT_PHOTO.md §12: "Once the response comes
  // back, it lands on the review screen exactly as if it had been sent
  // live." Also runs on first mount if already online and something was
  // queued from an earlier, offline session (the app reloaded meanwhile) —
  // not just on the online/offline transition itself.
  useEffect(() => {
    if (!online) return;
    const pending = readPendingPhotoImport();
    if (!pending) return;
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      setPendingPhotoImport(pending);
      setLoading(true);
      setRequestStartedAtMs(Date.now());
      setProgressStage(undefined);
      try {
        const today = clock.today();
        const parsed = await importRecipeFromPhotos(
          {
            baseUrl: pending.settings.baseUrl,
            apiKey: pending.settings.apiKey,
            model: pending.settings.model,
            photos: pending.photos,
          },
          undefined,
          setProgressStage,
        );
        recordImportUsed(today);
        const { rows: catalogue } = await store.ingredients.readAll();
        const lines = resolveImportedLines(parsed.ingredients, catalogue);
        clearPendingPhotoImport();
        if (cancelled) return;
        const draft: RecipeImportDraft = { parsed, lines, sourceText: "", photos: pending.photos };
        navigate("/recipes/new", { state: { importedDraft: draft } });
      } catch (err) {
        clearPendingPhotoImport();
        if (err instanceof RecipeImportError && err.diagnostic) recordAndRefreshHistory(err.diagnostic, setHistory);
        if (!cancelled) setError(describeRecipeImportError(err));
      } finally {
        if (!cancelled) {
          setLoading(false);
          setPendingPhotoImport(undefined);
          setRequestStartedAtMs(undefined);
          setProgressStage(undefined);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // Deliberately scoped to `online` alone (same pattern as PhotoMedia.tsx's
    // fetch effect): `store`/`clock`/`navigate` are stable for this route's
    // lifetime, and re-running this on every render of those would refire
    // the same queued request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  const configured = isRecipeImportConfigured(settings);
  // A snapshot, not live-recomputed on every keystroke — the count only
  // actually changes once an import is sent, and re-reading localStorage on
  // every render would be pointless work for a value that can't move
  // between them.
  const usage = useMemo(() => getImportUsage(clock.today(), settings), [settings, clock]);

  const trimmedUrl = sourceUrl.trim();
  // One field, two jobs, chosen by the household's own Settings toggle
  // (RecipeImportSettings.tsx) — never two boxes that both take a URL and
  // silently do different things. Off: the address is a provenance note,
  // never fetched. On, with something typed: the address IS what gets
  // fetched, via the Responses API's browser tool, and the pasted text
  // below is not sent for this particular import. Unchanged from before the
  // photo mode existed — deliberately NOT gated on `mode`, since "paste" and
  // "link" share the exact same panel/logic below; the mode selector's only
  // real branch is "photo" vs. everything else.
  const usingLink = settings.linkEnabled && trimmedUrl !== "";

  const modeOptions = [
    { value: "paste" as const, label: "Paste text" },
    ...(settings.linkEnabled ? [{ value: "link" as const, label: "From a link" }] : []),
    { value: "photo" as const, label: "From a photo" },
  ];

  const disabledReason =
    mode === "photo"
      ? !configured
        ? "not-configured"
        : usage.atLimit
          ? "daily-limit"
          : photos.length === 0
            ? "empty"
            : undefined
      : !configured
        ? "not-configured"
        : !online
          ? "offline"
          : usage.atLimit
            ? "daily-limit"
            : usingLink
              ? undefined
              : text.trim() === ""
                ? "empty"
                : undefined;

  async function handleImport(): Promise<void> {
    if (disabledReason !== undefined || loading) return;
    setLoading(true);
    setError(undefined);
    setRequestStartedAtMs(Date.now());
    setProgressStage(undefined);
    try {
      const today = clock.today();
      const parsed = usingLink
        ? await importRecipeFromLink(
            {
              baseUrl: settings.baseUrl,
              apiKey: settings.apiKey,
              model: settings.model,
              url: trimmedUrl,
              ...(settings.toolServerUrl.trim() !== "" ? { toolServerUrl: settings.toolServerUrl.trim() } : {}),
            },
            undefined,
            setProgressStage,
          )
        : await importRecipeFromText(
            {
              baseUrl: settings.baseUrl,
              apiKey: settings.apiKey,
              model: settings.model,
              pastedText: text,
              ...(!settings.linkEnabled && trimmedUrl !== "" ? { sourceUrl: trimmedUrl } : {}),
            },
            undefined,
            setProgressStage,
          );
      recordImportUsed(today);
      // Make link import prove it read the page the cook asked for
      // (owner's 2026-08-25 report): a link import's own diagnostic is
      // recorded here even on success — the mismatch this feature exists to
      // catch is not a `RecipeImportError` (the draft still comes back
      // usable), so it would otherwise never reach "Show details" at all.
      if (parsed.diagnostic) recordAndRefreshHistory(parsed.diagnostic, setHistory);
      const { rows: catalogue } = await store.ingredients.readAll();
      const lines = resolveImportedLines(parsed.ingredients, catalogue);
      const draft: RecipeImportDraft = {
        parsed,
        lines,
        sourceText: usingLink ? "" : text,
        ...(trimmedUrl !== "" ? { sourceUrl: trimmedUrl } : {}),
      };
      navigate("/recipes/new", { state: { importedDraft: draft } });
    } catch (err) {
      if (err instanceof RecipeImportError && err.diagnostic) recordAndRefreshHistory(err.diagnostic, setHistory);
      setError(describeRecipeImportError(err));
    } finally {
      setLoading(false);
      setRequestStartedAtMs(undefined);
      setProgressStage(undefined);
    }
  }

  async function handlePhotoFileChosen(file: File): Promise<void> {
    if (photos.length >= MAX_PHOTOS) return;
    setPhotoProcessing(true);
    setError(undefined);
    try {
      const [dataUrl, advisory] = await Promise.all([
        encodePhotoForModelDataUrl(file),
        assessPhotoQualityFromBlob(file),
      ]);
      photoIdCounter.current += 1;
      setPhotos((current) => [...current, { id: `photo-${photoIdCounter.current}`, dataUrl, advisory }]);
    } catch (err) {
      setError(describeRecipeImportError(err));
    } finally {
      setPhotoProcessing(false);
    }
  }

  function removePhoto(id: string): void {
    setPhotos((current) => current.filter((p) => p.id !== id));
  }

  async function handlePhotoImport(): Promise<void> {
    if (disabledReason !== undefined || loading) return;
    setError(undefined);
    const photoUrls = photos.map((p) => p.dataUrl);

    // Capture and encoding already happened fully offline (photo-encode.ts
    // is pure client-side canvas work). Only the SEND needs a connection —
    // if there isn't one, queue rather than fail outright
    // (DESIGN_RECIPE_IMPORT_PHOTO.md §12, a deliberate divergence from the
    // text/link paths, which do not queue).
    if (!online) {
      const id = `photo-import-${clock.today()}-${Date.now()}`;
      const queued = enqueuePendingPhotoImport({
        id,
        photos: photoUrls,
        settings: { baseUrl: settings.baseUrl, apiKey: settings.apiKey, model: settings.model },
      });
      setPendingPhotoImport(queued);
      return;
    }

    setLoading(true);
    setRequestStartedAtMs(Date.now());
    setProgressStage(undefined);
    try {
      const today = clock.today();
      const parsed = await importRecipeFromPhotos(
        {
          baseUrl: settings.baseUrl,
          apiKey: settings.apiKey,
          model: settings.model,
          photos: photoUrls,
        },
        undefined,
        setProgressStage,
      );
      recordImportUsed(today);
      const { rows: catalogue } = await store.ingredients.readAll();
      const lines = resolveImportedLines(parsed.ingredients, catalogue);
      const draft: RecipeImportDraft = { parsed, lines, sourceText: "", photos: photoUrls };
      navigate("/recipes/new", { state: { importedDraft: draft } });
    } catch (err) {
      if (err instanceof RecipeImportError && err.diagnostic) recordAndRefreshHistory(err.diagnostic, setHistory);
      setError(describeRecipeImportError(err));
    } finally {
      setLoading(false);
      setRequestStartedAtMs(undefined);
      setProgressStage(undefined);
    }
  }

  const submitLabel =
    mode === "photo"
      ? pendingPhotoImport !== undefined
        ? "Waiting to reach the address you set up…"
        : loading
          ? "Reading the recipe…"
          : "Read this recipe"
      : loading
        ? "Reading the recipe…"
        : "Read this recipe";

  // Sending/waiting/reading/checking, with a running elapsed time — a
  // request here can easily take fifteen seconds, longer with photos, and a
  // silent spinner leaves no way to tell "working" from "stuck".
  const progressLine = loading ? (
    <p className={styles.hint} role="status">
      {IMPORT_PROGRESS_LABEL[progressStage ?? "sending"]} ({formatElapsedSeconds(progressElapsedMs)})
    </p>
  ) : null;

  // Diagnostics, behind a disclosure (owner's 2026-08-25 report): the plain
  // sentence above stays the headline; this is the "Show details" a
  // household debugging their own server actually needs — which address
  // and model, the HTTP status, the response body, which of the six causes
  // this was, and (for a schema mismatch) which field/expected/received.
  // Never the API key (`redactHeaders`, already applied before a
  // diagnostic is ever built) and never a raw photo payload
  // (`summarizeRequestBody`, same guarantee).
  const diagnosticsPanel =
    history.length > 0 ? (
      <div className={styles.sectionCard}>
        <button
          type="button"
          className={styles.importSourceToggle}
          onClick={() => setDetailsOpen((open) => !open)}
          aria-expanded={detailsOpen}
        >
          <span className={styles.sectionCardHead} style={{ borderBottom: "none" }}>
            {detailsOpen ? "Hide details" : "Show details"}
          </span>
        </button>
        {detailsOpen ? (
          <div className={styles.sectionCardBody}>
            <p className={styles.hint}>
              What Feeder actually sent and got back, most recent first — never your password, never a photo&rsquo;s
              raw data.
            </p>
            {history.map((entry, index) => (
              <div key={`${entry.startedAt}-${index}`} className={styles.line} style={{ flexDirection: "column", alignItems: "stretch" }}>
                <p className={styles.importSourceText} style={{ fontFamily: "var(--mono)", fontSize: "var(--fs-body-sm)" }}>
                  {entry.request.method} {entry.request.url} — model {entry.request.model}
                  <br />
                  {entry.httpStatus !== undefined ? `Status ${entry.httpStatus}${entry.httpStatusText ? ` ${entry.httpStatusText}` : ""} — ` : ""}
                  {entry.cause ? IMPORT_FAILURE_CAUSE_LABEL[entry.cause] : "No further detail recorded."}
                  {entry.validation?.field ? (
                    <>
                      <br />
                      Field: {entry.validation.field}
                      {entry.validation.expected ? ` — expected ${entry.validation.expected}` : ""}
                      {entry.validation.received ? `, received ${entry.validation.received}` : ""}
                    </>
                  ) : null}
                  {entry.toolActions && entry.toolActions.length > 0 ? (
                    <>
                      <br />
                      {entry.toolActions.map((action, actionIndex) => (
                        <span key={actionIndex}>
                          {actionIndex > 0 ? <br /> : null}
                          Action: {action.type}
                          {action.query ? ` — searched "${action.query}"` : ""}
                          {action.sources && action.sources.length > 0 ? ` — ${action.sources.length} candidate page(s)` : ""}
                        </span>
                      ))}
                    </>
                  ) : null}
                  {entry.citedUrls && entry.citedUrls.length > 0 ? (
                    <>
                      <br />
                      Actually read: {entry.citedUrls.join(", ")}
                    </>
                  ) : null}
                  <br />
                  Took {(entry.elapsedMs / 1000).toFixed(1)}s, at {entry.startedAt}
                  <br />
                  Authorization header: {entry.request.headers.Authorization ?? "(none sent)"}
                </p>
                <details>
                  <summary className={styles.hint}>Request body</summary>
                  <pre className={styles.importSourceText} style={{ fontFamily: "var(--mono)", fontSize: "var(--fs-body-sm)", overflowX: "auto" }}>
                    {JSON.stringify(entry.request.body, null, 2)}
                  </pre>
                </details>
                {entry.responseBodyPreview !== undefined ? (
                  <details>
                    <summary className={styles.hint}>Response body</summary>
                    <pre className={styles.importSourceText} style={{ fontFamily: "var(--mono)", fontSize: "var(--fs-body-sm)", overflowX: "auto" }}>
                      {entry.responseBodyPreview}
                    </pre>
                  </details>
                ) : null}
                <button
                  type="button"
                  className={styles.addButton}
                  onClick={() => void navigator.clipboard.writeText(formatDiagnosticForClipboard(entry))}
                >
                  Copy to clipboard
                </button>
              </div>
            ))}
            <button
              type="button"
              className={styles.cancelButton}
              onClick={() => {
                clearImportHistory();
                setHistory([]);
              }}
            >
              Clear this history
            </button>
          </div>
        ) : null}
      </div>
    ) : null;

  return (
    <section>
      <p>
        <Link to="/recipes" className={styles.backLink}>
          &larr; Recipes
        </Link>
      </p>
      <h1>Add from a recipe you found online</h1>

      <div className={styles.field}>
        <span className={styles.fieldLabel}>How are you adding this recipe?</span>
        <SegmentedControl<ImportMode>
          aria-label="How are you adding this recipe?"
          options={modeOptions}
          value={mode}
          onChange={setMode}
        />
      </div>

      {mode !== "photo" ? (
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            void handleImport();
          }}
        >
          <p className={styles.hint}>
            Paste the recipe&rsquo;s text below — the ingredients and steps, copied from the page. Feeder sends this
            text to the address you set up in Settings so it can turn it into a draft you review before anything is
            saved.
            {settings.linkEnabled
              ? " Or, further down, give it the page's address instead and it will open the page itself."
              : ""}{" "}
            Nothing else about your kitchen is sent.
          </p>

          {!configured ? (
            <p className={styles.hint} role="alert">
              You&rsquo;ll need to set up an address for reading recipes first — see{" "}
              <Link to="/settings" className={styles.itemLink}>
                Settings
              </Link>
              .
            </p>
          ) : null}

          <div className={styles.field}>
            <label htmlFor="recipe-import-text">Paste the recipe here</label>
            <textarea
              id="recipe-import-text"
              rows={12}
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Paste the ingredients and steps here…"
            />
          </div>

          <div className={styles.field}>
            <label htmlFor="recipe-import-source">
              {settings.linkEnabled ? "Or, the web address to read this recipe from" : "Where did this come from? (optional)"}
            </label>
            <input
              id="recipe-import-source"
              type="text"
              value={sourceUrl}
              onChange={(event) => setSourceUrl(event.target.value)}
              placeholder="https://…"
            />
            <p className={styles.hint}>
              {settings.linkEnabled
                ? usingLink
                  ? "Feeder will open this page itself and read the recipe from it — the text pasted above won't be sent."
                  : "Fill this in instead of pasting, and Feeder opens the page itself and reads the recipe from it. Leave it blank to use what you pasted above."
                : "Stored as a note with the recipe. Feeder does not open this address itself — paste the recipe's text above."}
            </p>
          </div>

          {!online ? (
            <p className={styles.hint} role="alert">
              Feeder needs to be online to read a recipe this way — try again once you&rsquo;re connected.
            </p>
          ) : null}
          {online && usage.atLimit ? (
            <p className={styles.hint} role="alert">
              You&rsquo;ve read {usage.limit} recipe{usage.limit === 1 ? "" : "s"} today, which is today&rsquo;s limit
              — this resets at midnight, or you can raise the limit in Settings.
            </p>
          ) : null}
          {error ? (
            <p className={styles.hint} role="alert">
              {error}
            </p>
          ) : null}
          {progressLine}
          {diagnosticsPanel}

          <div className={styles.actions}>
            <button type="submit" className={styles.saveButton} disabled={disabledReason !== undefined || loading}>
              {submitLabel}
            </button>
          </div>
        </form>
      ) : (
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            void handlePhotoImport();
          }}
        >
          <p className={styles.hint}>
            Works best on printed recipes. For handwriting, it does a reasonable job with clear writing but can
            struggle with faded or cramped handwriting — always check the numbers before saving.
          </p>
          <p className={styles.hint}>
            Feeder will send your photo{photos.length === 1 ? "" : "s"} to the address you set up in Settings
            (currently: {configured ? settings.baseUrl : "not set up yet"}) so it can be read into a recipe you
            review before anything is saved. If this is a photo of a family recipe card, that&rsquo;s still what
            happens — nothing else about your kitchen is sent.
          </p>

          {!configured ? (
            <p className={styles.hint} role="alert">
              You&rsquo;ll need to set up an address for reading recipes first — see{" "}
              <Link to="/settings" className={styles.itemLink}>
                Settings
              </Link>
              .
            </p>
          ) : null}

          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="visually-hidden"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void handlePhotoFileChosen(file);
            }}
          />

          <div className={styles.field}>
            <span className={styles.fieldLabel}>Photos of the recipe</span>
            {photos.length === 0 ? <p className={styles.hint}>No photos added yet.</p> : null}
            <div className={styles.photoThumbStrip}>
              {photos.map((photo, index) => (
                <div key={photo.id} className={styles.photoThumb}>
                  <div className={styles.photoThumbImgWrap}>
                    <img src={photo.dataUrl} alt={`Page ${index + 1} of the recipe`} className={styles.photoThumbImg} />
                    <button
                      type="button"
                      className={styles.photoThumbRemove}
                      onClick={() => removePhoto(photo.id)}
                      aria-label={`Remove page ${index + 1}`}
                    >
                      <Trash size={16} aria-hidden="true" />
                    </button>
                  </div>
                  {photo.advisory.flagged ? (
                    <p className={styles.photoAdvisory} role="status">
                      {photo.advisory.reason === "glare"
                        ? "This photo looks like it has some glare or shadow — you can try again, or send it anyway."
                        : "This photo looks a little flat or dim — you can try again, or send it anyway."}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
            <button
              type="button"
              className={styles.addButton}
              onClick={() => photoInputRef.current?.click()}
              disabled={photos.length >= MAX_PHOTOS || photoProcessing}
            >
              <Camera size={18} aria-hidden="true" />
              {photoProcessing
                ? "Processing…"
                : photos.length === 0
                  ? "Add a photo"
                  : photos.length >= MAX_PHOTOS
                    ? "Up to 3 pages"
                    : "+ Add another page"}
            </button>
          </div>

          {pendingPhotoImport !== undefined ? (
            <p className={styles.hint} role="status">
              Waiting to reach the address you set up — this will try again once you&rsquo;re back online.
            </p>
          ) : null}
          {online && usage.atLimit ? (
            <p className={styles.hint} role="alert">
              You&rsquo;ve read {usage.limit} recipe{usage.limit === 1 ? "" : "s"} today, which is today&rsquo;s limit
              — this resets at midnight, or you can raise the limit in Settings.
            </p>
          ) : null}
          {error ? (
            <p className={styles.hint} role="alert">
              {error}
            </p>
          ) : null}
          {progressLine}
          {diagnosticsPanel}

          <div className={styles.actions}>
            <button
              type="submit"
              className={styles.saveButton}
              disabled={disabledReason !== undefined || loading || pendingPhotoImport !== undefined}
            >
              {submitLabel}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
