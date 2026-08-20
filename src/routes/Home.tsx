import { House } from "../ui/icons";
import { EmptyState } from "../ui/components/EmptyState.tsx";

export function Home() {
  return (
    <section>
      <h1>Feeder</h1>
      <EmptyState
        icon={House}
        title="Your dashboard is empty for now"
        description="Once you've added a few recipes and planned a week, this is where you'll see what's coming up."
      />
    </section>
  );
}
