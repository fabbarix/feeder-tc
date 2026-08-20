import { BookOpen } from "../ui/icons";
import { EmptyState } from "../ui/components/EmptyState.tsx";

export function Recipes() {
  return (
    <section>
      <h1>Recipes</h1>
      <EmptyState
        icon={BookOpen}
        title="No recipes yet"
        description="Add your first recipe — cooked or store-bought — to start building a rotation."
      />
    </section>
  );
}
