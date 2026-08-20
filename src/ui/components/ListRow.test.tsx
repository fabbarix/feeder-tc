import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { ListRow } from "./ListRow.tsx";

describe("ListRow", () => {
  it("renders leading, primary, secondary and trailing slots", () => {
    render(
      <ListRow
        leading={<span aria-hidden="true">🥕</span>}
        primary="Carrot"
        secondary="2 lots"
        trailing={<span>500 g</span>}
      />,
    );
    expect(screen.getByText("Carrot")).toBeInTheDocument();
    expect(screen.getByText("2 lots")).toBeInTheDocument();
    expect(screen.getByText("500 g")).toBeInTheDocument();
  });

  it("shows a 'Failed to sync' notice and offers retry only when failed is set", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<ListRow primary="Milk" failed onRetry={onRetry} />);

    expect(screen.getByText(/failed to sync/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("never shows a failure notice for a normal (non-failed) row — pending is not a failure (UI_DESIGN.md §8)", () => {
    render(<ListRow primary="Milk" />);
    expect(screen.queryByText(/failed to sync/i)).not.toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = render(<ListRow primary="Carrot" secondary="2 lots" trailing="500 g" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
