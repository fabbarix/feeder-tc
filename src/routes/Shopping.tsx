import { ShoppingCart } from "../ui/icons";
import { EmptyState } from "../ui/components/EmptyState.tsx";

export function Shopping() {
  return (
    <section>
      <h1>Shopping</h1>
      <EmptyState
        icon={ShoppingCart}
        title="No shopping list yet"
        description="Plan a week first — your list is generated from what it needs, minus what's already in the pantry."
      />
    </section>
  );
}
