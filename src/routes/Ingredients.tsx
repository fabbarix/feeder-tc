import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useWorkbookContext } from "../workbook-context.ts";
import {
  EmptyState,
  ErrorState,
  ListRow,
  ListSection,
  RouteTabs,
  SearchField,
  Skeleton,
} from "../ui/components";
import { PhotoMedia } from "../ui/photo/index.ts";
import { Carrot, Plus } from "../ui/icons";
import type { Ingredient } from "../domain/index.ts";
import { getPhotoDataUrl } from "../photos/index.ts";
import { SECTION_TABS } from "./section-tabs.ts";
import { useIngredientsData } from "./useIngredientsData.ts";
import styles from "./forms.module.css";

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
  const { loading, error, ingredients, retry } = useIngredientsData();
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ingredients;
    return ingredients.filter((i) => i.name.toLowerCase().includes(q));
  }, [ingredients, query]);

  return (
    <>
      {/* One h1 for the whole "Recipes" area (WP-VC4/WP-VC5 — the tab strip
          below is the section header now; see RouteTabs.tsx/section-tabs.ts),
          visually hidden rather than deleted so it still names the area for
          a screen reader without repeating a label already on screen
          (owner-reported: "the repetition of 'Recipes' at the top and
          'Ingredients' is a waste of space"). Text is "Recipes" (the area's
          name, matching Recipes.tsx's own hidden h1) — it used to visibly
          say "Recipes" here too, which read as contradicting the selected
          "Ingredients" tab; hiding it removes the contradiction without
          losing the area name for assistive tech. */}
      <h1 className="visually-hidden">Recipes</h1>
      {/* Primary create action: same placement (header row, above the tab
          strip) and same "Add {noun}" naming as Recipes.tsx's "Add recipe"
          — this used to live inside the tabpanel, below the search field,
          which is why it moved out from under the search box below and up
          here instead. */}
      {!loading && !error && ingredients.length > 0 ? (
        <div className={styles.sectionHeaderRow}>
          <Link to="/recipes/ingredients/new" className={styles.addButton}>
            <Plus size={18} aria-hidden="true" />
            Add ingredient
          </Link>
        </div>
      ) : null}
      <RouteTabs aria-label="Recipes section" items={SECTION_TABS} />
      <section
        role="tabpanel"
        id="ingredients-panel"
        aria-labelledby="ingredients-panel-tab"
        tabIndex={-1}
      >
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="Find an ingredient…"
          aria-label="Search ingredients"
        />

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
            onRetry={retry}
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
          // nothing — see AppShell.tsx's `WIDE_ROUTES` for the matching
          // container-width this needs to have room to show more than one
          // column, at every width from 768px up (not just a tablet band —
          // see both files' 2026-08-23 doc-comment updates). `ListRow`'s
          // `variant="card"` is the paired per-row visual (also live from
          // 768px up).
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
