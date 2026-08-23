import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useWorkbookContext } from "../workbook-context.ts";
import { useToast } from "../ui/components/Toast/useToast.ts";
import {
  EmptyState,
  ErrorState,
  ListRow,
  ListSection,
  RouteTabs,
  Skeleton,
} from "../ui/components";
import { PhotoMedia } from "../ui/photo/index.ts";
import { Carrot, Plus } from "../ui/icons";
import type { Ingredient } from "../domain/index.ts";
import { getPhotoDataUrl } from "../photos/index.ts";
import { RECIPE_SECTION_TABS } from "./recipe-tabs.ts";
import styles from "./forms.module.css";

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const LOCATION_LABEL: Record<Ingredient["defaultLocation"], string> = {
  pantry: "Pantry",
  fridge: "Fridge",
  freezer: "Freezer",
};

/**
 * Ingredients catalog browse (WP-20, tabbed WP-VC) — the master list a
 * recipe's ingredient lines and the pantry (WP-21) both reference. Nested
 * under /recipes since it isn't a top-level primary-nav section, but reached
 * as a proper `RouteTabs` tab of Recipes rather than a standalone link
 * (owner-reported, comparing production to the approved mock: the old
 * `<Link to="/recipes/ingredients">` had no className and rendered in the
 * browser's default purple).
 */
export function Ingredients() {
  const { store } = useWorkbookContext();
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [ingredients, setIngredients] = useState<readonly Ingredient[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    // `loading`/`error` are only ever set from the promise's own
    // resolution below, never synchronously here (react-hooks'
    // set-state-in-effect rule) — their initial `useState` values already
    // cover the first mount.
    let cancelled = false;
    store.ingredients
      .readAll()
      .then((result) => {
        if (cancelled) return;
        setIngredients([...result.rows].sort((a, b) => a.name.localeCompare(b.name)));
        const firstReason = result.warnings[0]?.reason;
        if (result.warnings.length > 0) {
          showToast({
            variant: "warning",
            title: `${result.warnings.length} ${result.warnings.length === 1 ? "ingredient" : "ingredients"} skipped`,
            ...(firstReason !== undefined ? { description: firstReason } : {}),
          });
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(messageOf(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [store, showToast]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ingredients;
    return ingredients.filter((i) => i.name.toLowerCase().includes(q));
  }, [ingredients, query]);

  return (
    <>
      {/* One h1 for the whole "Recipes" area (WP-VC4 — the tab strip below
          is the section header now; see RouteTabs.tsx/recipe-tabs.ts), not
          a per-tab "Ingredients" heading that just repeated the active
          tab's own label back at the reader (owner-reported: "the
          repetition of 'Recipes' at the top and 'Ingredients' is a waste
          of space"). */}
      <h1>Recipes</h1>
      <RouteTabs aria-label="Recipes section" items={RECIPE_SECTION_TABS} />
      <section
        role="tabpanel"
        id="ingredients-panel"
        aria-labelledby="ingredients-panel-tab"
        tabIndex={-1}
      >
        <div className={styles.row}>
          <div className={styles.field}>
            <label htmlFor="ingredient-search">Search</label>
            <input
              id="ingredient-search"
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find an ingredient…"
            />
          </div>
        </div>
        {/* Only one "Add ingredient" control at a time — see Recipes.tsx's
          identical comment on its own "Add recipe" link/EmptyState pair. */}
        {!loading && !error && ingredients.length > 0 ? (
          <p>
            <Link to="/recipes/ingredients/new" className={styles.addButton}>
              <Plus size={18} aria-hidden="true" />
              Add ingredient
            </Link>
          </p>
        ) : null}

        {loading ? (
          <div className={styles.form}>
            <Skeleton />
            <Skeleton />
            <Skeleton />
          </div>
        ) : null}
        {!loading && error ? (
          <ErrorState
            title="Couldn't load the ingredient catalog"
            description={error}
            onRetry={() => window.location.reload()}
          />
        ) : null}
        {!loading && !error && ingredients.length === 0 ? (
          <EmptyState
            icon={Carrot}
            title="No ingredients yet"
            description="A starter list of common ingredients should have loaded when this meal planner was set up — add one by hand if it's missing."
            action={
              <Link to="/recipes/ingredients/new" className={styles.addButton}>
                Add ingredient
              </Link>
            }
          />
        ) : null}
        {!loading && !error && ingredients.length > 0 ? (
          // `layout="grid"` (tablet UI/UX review, finding 3): unlike Pantry/
          // Shopping this catalogue is flat, alphabetical and browsed, not
          // worked through in a scan order, so a reflowing card grid loses
          // nothing — see AppShell.tsx's `TABLET_WIDE_ROUTES` for the
          // matching container-width change this needs to have room to show
          // more than one column. `ListRow`'s `variant="card"` is the
          // paired per-row visual (both only take effect at 768-1439px).
          <ListSection heading={`${filtered.length} of ${ingredients.length}`} layout="grid">
            {filtered.map((ingredient) => (
              <ListRow
                key={ingredient.id}
                variant="card"
                leading={
                  <PhotoMedia
                    kind="ingredient"
                    hasPhoto={ingredient.hasPhoto}
                    size="list"
                    fetchPhoto={() => getPhotoDataUrl(store, "ingredient", ingredient.id)}
                    alt={ingredient.name}
                  />
                }
                primary={
                  <Link to={`/recipes/ingredients/${ingredient.id}`} className={styles.itemLink}>
                    {ingredient.name}
                  </Link>
                }
                secondary={`${ingredient.unit} · shelf life ${ingredient.shelfLifeDays}d (opened ${ingredient.openedShelfLifeDays}d) · ${LOCATION_LABEL[ingredient.defaultLocation]}`}
              />
            ))}
          </ListSection>
        ) : null}
      </section>
    </>
  );
}
