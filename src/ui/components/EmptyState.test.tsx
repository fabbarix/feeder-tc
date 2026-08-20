import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { EmptyState } from "./EmptyState.tsx";

describe("EmptyState", () => {
  it("renders title, description and action", () => {
    render(<EmptyState title="No recipes yet" description="Add your first recipe." action={<button>Add</button>} />);
    expect(screen.getByText("No recipes yet")).toBeInTheDocument();
    expect(screen.getByText("Add your first recipe.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = render(<EmptyState title="No recipes yet" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
