import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { ListSection } from "./ListSection.tsx";
import { ListRow } from "./ListRow.tsx";

describe("ListSection", () => {
  it("renders a heading and its row children", () => {
    render(
      <ListSection heading="Fridge">
        <ListRow primary="Milk" />
        <ListRow primary="Eggs" />
      </ListSection>
    );
    expect(screen.getByRole("heading", { name: "Fridge" })).toBeInTheDocument();
    expect(screen.getByText("Milk")).toBeInTheDocument();
    expect(screen.getByText("Eggs")).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <ListSection heading="Fridge">
        <ListRow primary="Milk" />
      </ListSection>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
