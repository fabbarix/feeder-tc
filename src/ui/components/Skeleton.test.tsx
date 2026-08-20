import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { Skeleton } from "./Skeleton.tsx";

describe("Skeleton", () => {
  it("announces as a status region for assistive tech", () => {
    render(<Skeleton label="Loading recipe" />);
    expect(screen.getByRole("status", { name: "Loading recipe" })).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = render(<Skeleton />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
