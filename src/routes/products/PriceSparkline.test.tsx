import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { PriceSparkline } from "./PriceSparkline.tsx";

describe("PriceSparkline", () => {
  it("renders nothing for a single point — no trend/shape is computable from one observation", () => {
    const { container } = render(<PriceSparkline values={[0.24]} label="single point" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for zero points", () => {
    const { container } = render(<PriceSparkline values={[]} label="no points" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders an accessible image with the given label for two or more points", () => {
    render(<PriceSparkline values={[0.2, 0.3, 0.25]} label="Price shape over 3 observations" />);
    expect(screen.getByRole("img", { name: "Price shape over 3 observations" })).toBeInTheDocument();
  });

  it("draws a level line (no divide-by-zero) when every value is identical", () => {
    const { container } = render(<PriceSparkline values={[0.5, 0.5, 0.5]} label="flat" />);
    const polyline = container.querySelector("polyline");
    expect(polyline).not.toBeNull();
    expect(polyline?.getAttribute("points")).not.toContain("NaN");
  });

  it("has no axe violations", async () => {
    const { container } = render(<PriceSparkline values={[0.2, 0.4, 0.3]} label="Price shape over 3 observations" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
