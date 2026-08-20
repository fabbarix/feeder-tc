import { GearSix } from "../ui/icons";
import { EmptyState } from "../ui/components/EmptyState.tsx";
import { ThemeControl } from "../ui/theme/ThemeControl";

export function Settings() {
  return (
    <section>
      <h1>Settings</h1>
      <EmptyState
        icon={GearSix}
        title="Household settings are coming soon"
        description="Household size, meal-slot layout and the repeat window will live here."
      />
      <h2>Appearance</h2>
      <ThemeControl />
    </section>
  );
}
