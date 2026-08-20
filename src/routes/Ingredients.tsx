import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useWorkbookContext } from "../workbook-context.ts";
import { useToast } from "../ui/components/Toast/useToast.ts";
import { EmptyState, ErrorState, ListRow, ListSection, Skeleton } from "../ui/components";
import { Carrot, Plus } from "../ui/icons";
import type { Ingredient } from "../domain/index.ts";
import styles from "./forms.module.css";

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const LOCATION_LABEL: Record<Ingredient["defaultLocation"], string> = {
  pantry: "Pantry",
  fridge: "Fridge",
  freezer: "Freezer",
};

/** Ingredients catalog browse (WP-20) — the master list a recipe's ingredient lines and the pantry (WP-21) both reference. Nested under /recipes since it isn't a top-level nav section (UI_DESIGN.md's screen catalogue has no separate "ingredients" tab). */
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
            title: `${result.warnings.length} ingredient row${result.warnings.length === 1 ? "" : "s"} skipped`,
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
    <section>
      <p>
        <Link to="/recipes">&larr; Recipes</Link>
      </p>
      <h1>Ingredients</h1>
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
          description="The seeded catalog should have loaded when your workbook was created — add one by hand if it's missing."
          action={
            <Link to="/recipes/ingredients/new" className={styles.addButton}>
              Add ingredient
            </Link>
          }
        />
      ) : null}
      {!loading && !error && ingredients.length > 0 ? (
        <ListSection heading={`${filtered.length} of ${ingredients.length}`}>
          {filtered.map((ingredient) => (
            <ListRow
              key={ingredient.id}
              leading={<Carrot size={20} aria-hidden="true" />}
              primary={<Link to={`/recipes/ingredients/${ingredient.id}`}>{ingredient.name}</Link>}
              secondary={`${ingredient.unit} · shelf life ${ingredient.shelfLifeDays}d (opened ${ingredient.openedShelfLifeDays}d) · ${LOCATION_LABEL[ingredient.defaultLocation]}`}
            />
          ))}
        </ListSection>
      ) : null}
    </section>
  );
}
