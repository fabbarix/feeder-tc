import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useWorkbookContext } from "../workbook-context.ts";
import { useToast } from "../ui/components/Toast/useToast.ts";
import { EmptyState, ErrorState, RouteTabs, Skeleton } from "../ui/components";
import { PhotoMedia } from "../ui/photo/index.ts";
import { BookOpen, MagnifyingGlass, Plus } from "../ui/icons";
import type { MealTag, Recipe } from "../domain/index.ts";
import { getPhotoDataUrl } from "../photos/index.ts";
import { RECIPE_SECTION_TABS } from "./recipe-tabs.ts";
import styles from "./recipes.module.css";

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

interface FilterDef {
  readonly key: string;
  readonly label: string;
  readonly test: (recipe: Recipe) => boolean;
}

const MEAL_TAG_FILTERS: readonly FilterDef[] = (
  ["breakfast", "lunch", "dinner", "snack"] as const satisfies readonly MealTag[]
).map((tag) => ({
  key: tag,
  label: tag[0]!.toUpperCase() + tag.slice(1),
  test: (recipe: Recipe) => recipe.mealTags.includes(tag),
}));

const OTHER_FILTERS: readonly FilterDef[] = [
  { key: "staples", label: "Staples", test: (r) => r.status === "staple" },
  { key: "bought", label: "Bought", test: (r) => r.kind === "bought" },
  { key: "retired", label: "Retired", test: (r) => r.status === "retired" },
];

// Order matches the approved mockup's filter row exactly: meal tags first, then the status/kind facets.
const FILTERS: readonly FilterDef[] = [...MEAL_TAG_FILTERS, ...OTHER_FILTERS];

function tagPills(recipe: Recipe): readonly string[] {
  const pills = recipe.mealTags.map((tag) => tag[0]!.toUpperCase() + tag.slice(1));
  const withKind: string[] = recipe.kind === "bought" ? [...pills, "Bought"] : [...pills];
  if (recipe.status === "staple") withKind.push("Staple");
  if (recipe.status === "retired") withKind.push("Retired");
  return withKind;
}

/**
 * Recipe list — a card grid with search and filter chips (WP-20, rebuilt
 * against the approved screen-catalogue mockup). No per-card vote control:
 * the household flag lives on the recipe's own page (RecipeEditor.tsx),
 * matching the mockup exactly — the list is for browsing/finding a recipe,
 * not for casting a vote at a glance.
 */
export function Recipes() {
  const { store } = useWorkbookContext();
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [recipes, setRecipes] = useState<readonly Recipe[]>([]);
  const [query, setQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<string | null>(null);

  useEffect(() => {
    // `loading`/`error` are only ever set from the promise's own
    // resolution below, never synchronously here (react-hooks'
    // set-state-in-effect rule) — their initial `useState` values already
    // cover the first mount.
    let cancelled = false;
    store.recipes
      .readAll()
      .then((result) => {
        if (cancelled) return;
        setRecipes([...result.rows].sort((a, b) => a.name.localeCompare(b.name)));
        const firstReason = result.warnings[0]?.reason;
        if (result.warnings.length > 0) {
          showToast({
            variant: "warning",
            title: `${result.warnings.length} recipe row${result.warnings.length === 1 ? "" : "s"} skipped`,
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
    const activeTest = FILTERS.find((f) => f.key === activeFilter)?.test;
    return recipes.filter((recipe) => {
      if (q && !recipe.name.toLowerCase().includes(q)) return false;
      if (activeTest && !activeTest(recipe)) return false;
      return true;
    });
  }, [recipes, query, activeFilter]);

  const staplesCount = recipes.filter((r) => r.status === "staple").length;
  const retiredCount = recipes.filter((r) => r.status === "retired").length;

  return (
    <>
      <div className={styles.headerRow}>
        {/* One h1 for the whole "Recipes" area (WP-VC4) — the tab strip
            below is the section header now; a second "Recipes" label
            immediately under an "Recipes" h1 was exactly the redundancy
            the owner flagged ("the repetition of 'Recipes' at the top and
            'Ingredients' is a waste of space"). */}
        <h1>Recipes</h1>
        {!loading && !error && recipes.length > 0 ? (
          <Link to="/recipes/new" className={styles.newButton}>
            <Plus size={16} aria-hidden="true" />
            New recipe
          </Link>
        ) : null}
      </div>
      <RouteTabs aria-label="Recipes section" items={RECIPE_SECTION_TABS} />
      <section role="tabpanel" id="recipes-panel" aria-labelledby="recipes-panel-tab" tabIndex={-1}>
        {!loading && !error && recipes.length > 0 ? (
          <p className={styles.subtitle}>
            {recipes.length} recipe{recipes.length === 1 ? "" : "s"} · {staplesCount} staple
            {staplesCount === 1 ? "" : "s"} · {retiredCount} retired
          </p>
        ) : null}

        {loading ? (
          <div className={styles.grid}>
            <Skeleton height="7em" />
            <Skeleton height="7em" />
            <Skeleton height="7em" />
          </div>
        ) : null}
        {!loading && error ? (
          <ErrorState
            title="Couldn't load your recipes"
            description={error}
            onRetry={() => window.location.reload()}
          />
        ) : null}
        {!loading && !error && recipes.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title="No recipes yet"
            description="Add your first recipe — cooked or store-bought — to start building a rotation."
            action={
              <Link to="/recipes/new" className={styles.newButton}>
                Add recipe
              </Link>
            }
          />
        ) : null}
        {!loading && !error && recipes.length > 0 ? (
          <>
            <div className={styles.search}>
              <MagnifyingGlass size={16} aria-hidden="true" />
              <input
                type="text"
                className={styles.searchInput}
                placeholder="Search recipes"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-label="Search recipes"
              />
            </div>
            <div className={styles.filters}>
              <button
                type="button"
                className={`${styles.fchip}${activeFilter === null ? ` ${styles.fchipActive}` : ""}`}
                aria-pressed={activeFilter === null}
                onClick={() => setActiveFilter(null)}
              >
                All
              </button>
              {FILTERS.map((filter) => (
                <button
                  key={filter.key}
                  type="button"
                  className={`${styles.fchip}${activeFilter === filter.key ? ` ${styles.fchipActive}` : ""}`}
                  aria-pressed={activeFilter === filter.key}
                  onClick={() =>
                    setActiveFilter((current) => (current === filter.key ? null : filter.key))
                  }
                >
                  {filter.label}
                </button>
              ))}
            </div>

            {filtered.length === 0 ? (
              <EmptyState
                icon={MagnifyingGlass}
                title="No recipes match"
                description="Try a different search or filter."
              />
            ) : (
              <div className={styles.grid}>
                {filtered.map((recipe) => (
                  <Link key={recipe.id} to={`/recipes/${recipe.id}`} className={styles.card}>
                    {/* Leading thumbnail, not a banner — a square crop
                        tolerates any food photo, and it stops the image
                        competing with the tag row for height
                        (mock-responsive.html's own "Recipes" note). */}
                    <PhotoMedia
                      kind="recipe"
                      hasPhoto={recipe.hasPhoto}
                      size="grid"
                      fetchPhoto={() => getPhotoDataUrl(store, "recipe", recipe.id)}
                      alt={recipe.name}
                    />
                    <div className={styles.cardBody}>
                      <p className={styles.cardTitle}>{recipe.name}</p>
                      <div className={styles.cardMeta}>
                        <span>{recipe.prepMinutes} prep</span>
                        <span>{recipe.cookMinutes} cook</span>
                        <span>serves {recipe.baseServings}</span>
                      </div>
                      <div className={styles.tagRow}>
                        {tagPills(recipe).map((tag) => (
                          <span key={tag} className={styles.tagPill}>
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </>
        ) : null}
      </section>
    </>
  );
}
