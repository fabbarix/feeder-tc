import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useWorkbookContext } from "../workbook-context.ts";
import { importRecipeFromText } from "../import/client.ts";
import { describeRecipeImportError } from "../import/error-messages.ts";
import { getImportUsage, isRecipeImportConfigured, readRecipeImportSettings, recordImportUsed } from "../import/settings.ts";
import { resolveImportedLines, type ParsedRecipeDraft, type ResolvedIngredientLine } from "../import/match.ts";
import { createBrowserConnectivityMonitor } from "../sync/index.ts";
import styles from "./forms.module.css";

/** Handed to `RecipeEditor` via router `state` — never persisted, discarded the moment the editor unmounts or the household navigates away without saving. */
export interface RecipeImportDraft {
  readonly parsed: ParsedRecipeDraft;
  readonly lines: readonly ResolvedIngredientLine[];
  readonly sourceText: string;
  readonly sourceUrl?: string;
}

/**
 * The paste screen (DESIGN_RECIPE_IMPORT.md §11) — "Add from a recipe you
 * found online." Paste-text is the floor and always available; the link
 * field only appears once the household has declared, in Settings, that
 * their configured address can actually open one (decisions §3 — a feature
 * that silently disappears depending on a setting is worse than one that's
 * simply always there).
 */
export function RecipeImport() {
  const navigate = useNavigate();
  const { store, clock } = useWorkbookContext();
  const [settings] = useState(() => readRecipeImportSettings());
  const [text, setText] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [online, setOnline] = useState(() => createBrowserConnectivityMonitor().isOnline());

  useEffect(() => {
    const monitor = createBrowserConnectivityMonitor();
    return monitor.subscribe(setOnline);
  }, []);

  const configured = isRecipeImportConfigured(settings);
  // A snapshot, not live-recomputed on every keystroke — the count only
  // actually changes once an import is sent, and re-reading localStorage on
  // every render would be pointless work for a value that can't move
  // between them.
  const usage = useMemo(() => getImportUsage(clock.today(), settings), [settings, clock]);

  const disabledReason = !configured
    ? "not-configured"
    : !online
      ? "offline"
      : usage.atLimit
        ? "daily-limit"
        : text.trim() === ""
          ? "empty"
          : undefined;

  async function handleImport(): Promise<void> {
    if (disabledReason !== undefined || loading) return;
    setLoading(true);
    setError(undefined);
    try {
      const today = clock.today();
      const parsed = await importRecipeFromText({
        baseUrl: settings.baseUrl,
        apiKey: settings.apiKey,
        model: settings.model,
        pastedText: text,
        ...(sourceUrl.trim() !== "" ? { sourceUrl: sourceUrl.trim() } : {}),
      });
      recordImportUsed(today);
      const { rows: catalogue } = await store.ingredients.readAll();
      const lines = resolveImportedLines(parsed.ingredients, catalogue);
      const draft: RecipeImportDraft = {
        parsed,
        lines,
        sourceText: text,
        ...(sourceUrl.trim() !== "" ? { sourceUrl: sourceUrl.trim() } : {}),
      };
      navigate("/recipes/new", { state: { importedDraft: draft } });
    } catch (err) {
      setError(describeRecipeImportError(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section>
      <p>
        <Link to="/recipes" className={styles.backLink}>
          &larr; Recipes
        </Link>
      </p>
      <h1>Add from a recipe you found online</h1>
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
          saved. Nothing else about your kitchen is sent.
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

        {settings.linkEnabled ? (
          <div className={styles.field}>
            <label htmlFor="recipe-import-source">Where did this come from? (optional)</label>
            <input
              id="recipe-import-source"
              type="text"
              value={sourceUrl}
              onChange={(event) => setSourceUrl(event.target.value)}
              placeholder="https://…"
            />
          </div>
        ) : null}

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
            {loading ? "Reading the recipe…" : "Read this recipe"}
          </button>
        </div>
      </form>
    </section>
  );
}
