import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useWorkbookContext } from "../workbook-context.ts";
import { useToast } from "../ui/components/Toast/useToast.ts";
import { EmptyState, ErrorState, RouteTabs, SearchField, Skeleton } from "../ui/components";
import { PhotoMedia } from "../ui/photo/index.ts";
import { BookOpen, Clock, CookingPot, MagnifyingGlass, Plus, Users } from "../ui/icons";
import type { MealTag, Recipe } from "../domain/index.ts";
import { getPhotoDataUrl } from "../photos/index.ts";
import { SECTION_TABS } from "./section-tabs.ts";
import styles from "./recipes.module.css";
import forms from "./forms.module.css";

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
            title: `${result.warnings.length} ${result.warnings.length === 1 ? "recipe" : "recipes"} skipped`,
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
      {/* One h1 for the whole "Recipes" area (WP-VC4/WP-VC5) — the tab strip
          below is the section header now, so this is visually hidden rather
          than deleted: it still names the area for a screen reader, it just
          no longer repeats "Recipes" on screen right above a tab that says
          the same thing (owner-reported: "the repetition of 'Recipes' at
          the top and 'Ingredients' is a waste of space"). */}
      <h1 className="visually-hidden">Recipes</h1>
      {/* Primary create action (WP-VC5 defect sweep): "Add {noun}", in a
          header row ABOVE the tab strip so it stays in the same place and
          keeps the same label on every sibling tab — see
          Ingredients.tsx / ProductsList.tsx's identical header row. Was
          "New recipe" here and "Add recipe" in this same file's own
          EmptyState action (an owner-reported inconsistency inside one
          file); both are "Add recipe" now. */}
      {!loading && !error && recipes.length > 0 ? (
        <div className={forms.sectionHeaderRow}>
          <Link to="/recipes/new" className={forms.addButton}>
            <Plus size={18} aria-hidden="true" />
            Add recipe
          </Link>
        </div>
      ) : null}
      <RouteTabs aria-label="Recipes section" items={SECTION_TABS} />
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
              <Link to="/recipes/new" className={forms.addButton}>
                <Plus size={18} aria-hidden="true" />
                Add recipe
              </Link>
            }
          />
        ) : null}
        {!loading && !error && recipes.length > 0 ? (
          <>
            <SearchField
              value={query}
              onChange={setQuery}
              placeholder="Search recipes"
              aria-label="Search recipes"
            />
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
                      {/* Icons, not spelled-out "prep"/"cook"/"serves" labels
                          (WP-VC5 defect sweep) — a clock/pot/people glyph
                          beside a value is a well-understood convention that
                          repeats on every card, so it's learnable the way a
                          lone icon button is not (this project's
                          icon-only-is-a-regression rule is about interactive
                          controls, not repeated metadata — see icons.ts's
                          comment). Each `<span>` carries its own `aria-label`
                          with the full word and unit so a screen reader
                          hears "Prep 20 minutes", not a bare "20"; the
                          visible glyph+abbreviation pair is `aria-hidden`
                          so it isn't announced a second time. */}
                      <div className={styles.cardMeta}>
                        <span aria-label={`Prep ${recipe.prepMinutes} minutes`}>
                          <Clock size={14} aria-hidden="true" />
                          <span aria-hidden="true">{recipe.prepMinutes}m</span>
                        </span>
                        <span aria-label={`Cook ${recipe.cookMinutes} minutes`}>
                          <CookingPot size={14} aria-hidden="true" />
                          <span aria-hidden="true">{recipe.cookMinutes}m</span>
                        </span>
                        <span aria-label={`Serves ${recipe.baseServings}`}>
                          <Users size={14} aria-hidden="true" />
                          <span aria-hidden="true">{recipe.baseServings}</span>
                        </span>
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
