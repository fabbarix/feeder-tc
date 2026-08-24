import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useWorkbookContext } from "../workbook-context.ts";
import { importRecipeFromLink, importRecipeFromPhotos, importRecipeFromText } from "../import/client.ts";
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
import { createBrowserConnectivityMonitor } from "../sync/index.ts";
import { SegmentedControl } from "../ui/components";
import { Camera, Trash } from "../ui/icons";
import styles from "./forms.module.css";

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
      try {
        const today = clock.today();
        const parsed = await importRecipeFromPhotos({
          baseUrl: pending.settings.baseUrl,
          apiKey: pending.settings.apiKey,
          model: pending.settings.model,
          photos: pending.photos,
        });
        recordImportUsed(today);
        const { rows: catalogue } = await store.ingredients.readAll();
        const lines = resolveImportedLines(parsed.ingredients, catalogue);
        clearPendingPhotoImport();
        if (cancelled) return;
        const draft: RecipeImportDraft = { parsed, lines, sourceText: "", photos: pending.photos };
        navigate("/recipes/new", { state: { importedDraft: draft } });
      } catch (err) {
        clearPendingPhotoImport();
        if (!cancelled) setError(describeRecipeImportError(err));
      } finally {
        if (!cancelled) {
          setLoading(false);
          setPendingPhotoImport(undefined);
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
    try {
      const today = clock.today();
      const parsed = usingLink
        ? await importRecipeFromLink({
            baseUrl: settings.baseUrl,
            apiKey: settings.apiKey,
            model: settings.model,
            url: trimmedUrl,
            ...(settings.toolServerUrl.trim() !== "" ? { toolServerUrl: settings.toolServerUrl.trim() } : {}),
          })
        : await importRecipeFromText({
            baseUrl: settings.baseUrl,
            apiKey: settings.apiKey,
            model: settings.model,
            pastedText: text,
            ...(!settings.linkEnabled && trimmedUrl !== "" ? { sourceUrl: trimmedUrl } : {}),
          });
      recordImportUsed(today);
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
      setError(describeRecipeImportError(err));
    } finally {
      setLoading(false);
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
    try {
      const today = clock.today();
      const parsed = await importRecipeFromPhotos({
        baseUrl: settings.baseUrl,
        apiKey: settings.apiKey,
        model: settings.model,
        photos: photoUrls,
      });
      recordImportUsed(today);
      const { rows: catalogue } = await store.ingredients.readAll();
      const lines = resolveImportedLines(parsed.ingredients, catalogue);
      const draft: RecipeImportDraft = { parsed, lines, sourceText: "", photos: photoUrls };
      navigate("/recipes/new", { state: { importedDraft: draft } });
    } catch (err) {
      setError(describeRecipeImportError(err));
    } finally {
      setLoading(false);
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
