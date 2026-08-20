import { Package } from "../ui/icons";
import { EmptyState } from "../ui/components/EmptyState.tsx";

export function Pantry() {
  return (
    <section>
      <h1>Pantry</h1>
      <EmptyState
        icon={Package}
        title="Your pantry is empty"
        description="Add what's already in your kitchen to start tracking quantities and expiry."
      />
    </section>
  );
}
