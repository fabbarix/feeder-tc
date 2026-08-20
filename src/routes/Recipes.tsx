import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useWorkbookContext } from "../workbook-context.ts";
import { useToast } from "../ui/components/Toast/useToast.ts";
import { EmptyState, ErrorState, ListRow, ListSection, SegmentedControl, Skeleton } from "../ui/components";
import { BookOpen, BowlFood, CookingPot, Plus } from "../ui/icons";
import type { Recipe, RecipeStatus } from "../domain/index.ts";
import { STATUS_OPTIONS, statusLabel } from "./recipe-options.ts";
import styles from "./forms.module.css";

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function summarize(recipe: Recipe): string {
  const time = recipe.kind === "bought" ? `${recipe.cookMinutes} min to heat` : `${recipe.prepMinutes + recipe.cookMinutes} min total`;
  const tags = recipe.mealTags.length > 0 ? recipe.mealTags.join(", ") : "no meal tags";
  return `${recipe.kind === "bought" ? "Store-bought" : "Cooked"} · serves ${recipe.baseServings} · ${time} · ${tags}`;
}

/** Recipe list + the household's 3-state vote control on each card (WP-20). */
export function Recipes() {
  const { store } = useWorkbookContext();
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [recipes, setRecipes] = useState<readonly Recipe[]>([]);

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

  async function handleStatusChange(recipe: Recipe, status: RecipeStatus): Promise<void> {
    const previous = recipe;
    const updated: Recipe = { ...recipe, status };
    setRecipes((current) => current.map((r) => (r.id === recipe.id ? updated : r)));
    try {
      await store.recipes.upsert(updated);
      showToast({ variant: "success", title: `"${recipe.name}" is now ${statusLabel(status)}`, durationMs: 4000 });
    } catch (err) {
      setRecipes((current) => current.map((r) => (r.id === recipe.id ? previous : r)));
      showToast({ variant: "error", title: "Couldn't update status", description: messageOf(err) });
    }
  }

  return (
    <section>
      <h1>Recipes</h1>
      <p>
        <Link to="/recipes/ingredients">Ingredients catalog &rarr;</Link>
      </p>
      {/* Only one "Add recipe" control at a time: this persistent one once
          there's a list to add alongside, or EmptyState's own action below
          while there's nothing yet — never both (two links with the same
          accessible name is confusing, for a screen-reader user most of all). */}
      {!loading && !error && recipes.length > 0 ? (
        <p>
          <Link to="/recipes/new" className={styles.addButton}>
            <Plus size={18} aria-hidden="true" />
            Add recipe
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
            <Link to="/recipes/new" className={styles.addButton}>
              Add recipe
            </Link>
          }
        />
      ) : null}
      {!loading && !error && recipes.length > 0 ? (
        <ListSection heading={`${recipes.length} recipe${recipes.length === 1 ? "" : "s"}`}>
          {recipes.map((recipe) => (
            <ListRow
              key={recipe.id}
              leading={
                recipe.kind === "bought" ? (
                  <BowlFood size={20} aria-hidden="true" />
                ) : (
                  <CookingPot size={20} aria-hidden="true" />
                )
              }
              primary={<Link to={`/recipes/${recipe.id}`}>{recipe.name}</Link>}
              secondary={summarize(recipe)}
              trailing={
                <SegmentedControl<RecipeStatus>
                  aria-label={`"${recipe.name}" rotation status`}
                  options={STATUS_OPTIONS}
                  value={recipe.status}
                  onChange={(status) => void handleStatusChange(recipe, status)}
                />
              }
            />
          ))}
        </ListSection>
      ) : null}
    </section>
  );
}
