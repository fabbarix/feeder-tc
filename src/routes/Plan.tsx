import { CalendarBlank } from "../ui/icons";
import { EmptyState } from "../ui/components/EmptyState.tsx";

export function Plan() {
  return (
    <section>
      <h1>Plan</h1>
      <EmptyState
        icon={CalendarBlank}
        title="Nothing planned yet"
        description="Once you have a few recipes in rotation, generate a week to fill in the meal slots."
      />
    </section>
  );
}
