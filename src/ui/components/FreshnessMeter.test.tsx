import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { FreshnessMeter } from "./FreshnessMeter.tsx";

describe("FreshnessMeter", () => {
  it("renders as a meter with the current value", () => {
    render(<FreshnessMeter fractionRemaining={0.6} />);
    const meter = screen.getByRole("meter");
    expect(meter).toHaveAttribute("aria-valuenow", "60");
    expect(meter).toHaveAttribute("aria-valuemin", "0");
    expect(meter).toHaveAttribute("aria-valuemax", "100");
  });

  it("clamps out-of-range fractions", () => {
    render(<FreshnessMeter fractionRemaining={1.5} />);
    expect(screen.getByRole("meter")).toHaveAttribute("aria-valuenow", "100");
  });

  it("accepts a custom accessible label", () => {
    render(<FreshnessMeter fractionRemaining={0.5} label="3 of 6 days remaining" />);
    expect(screen.getByRole("meter", { name: "3 of 6 days remaining" })).toBeInTheDocument();
  });

  it("has no axe violations at each tone (fresh, warn, crit)", async () => {
    for (const fraction of [1, 0.1, 0]) {
      const { container, unmount } = render(<FreshnessMeter fractionRemaining={fraction} />);
      expect(await axe(container)).toHaveNoViolations();
      unmount();
    }
  });
});
