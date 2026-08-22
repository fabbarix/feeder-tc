import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { SegmentedControl } from "./SegmentedControl.tsx";
import styles from "./SegmentedControl.module.css";

const OPTIONS = [
  { value: "pantry", label: "Pantry" },
  { value: "fridge", label: "Fridge" },
  { value: "freezer", label: "Freezer" },
] as const;

describe("SegmentedControl", () => {
  it("renders as a radiogroup with one radio per option, the current value checked", () => {
    render(<SegmentedControl aria-label="Location" options={OPTIONS} value="fridge" onChange={() => {}} />);
    expect(screen.getByRole("radiogroup", { name: "Location" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Fridge" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Pantry" })).not.toBeChecked();
  });

  it("calls onChange with the newly selected value", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SegmentedControl aria-label="Location" options={OPTIONS} value="pantry" onChange={onChange} />);

    await user.click(screen.getByRole("radio", { name: "Freezer" }));

    expect(onChange).toHaveBeenCalledWith("freezer");
  });

  it("supports arrow-key navigation (real radiogroup keyboard semantics)", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SegmentedControl aria-label="Location" options={OPTIONS} value="pantry" onChange={onChange} />);

    screen.getByRole("radio", { name: "Pantry" }).focus();
    await user.keyboard("{ArrowRight}");

    expect(onChange).toHaveBeenCalledWith("fridge");
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <SegmentedControl aria-label="Location" options={OPTIONS} value="pantry" onChange={() => {}} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  // Owner decision (UX review round 2 follow-up): 999px pill by default,
  // `--radius-md`/`--radius-sm` only for a control opted into `wraps`
  // (SegmentedControl.module.css's `.group.wrap` comment). The e2e visual-
  // conformance suite pins the actual computed radii on live consumers;
  // this unit test pins the narrower, faster-to-run claim that the prop
  // itself toggles the modifier class.
  it("does not carry the wrap modifier class by default (999px pill)", () => {
    // `noUncheckedIndexedAccess` widens the CSS-module import's index
    // signature to `string | undefined`; the class is always present at
    // runtime (Vite/PostCSS emits it for every rule this file declares).
    render(<SegmentedControl aria-label="Location" options={OPTIONS} value="pantry" onChange={() => {}} />);
    expect(screen.getByRole("radiogroup", { name: "Location" })).not.toHaveClass(styles.wrap!);
  });

  it("carries the wrap modifier class when `wraps` is set", () => {
    render(
      <SegmentedControl aria-label="Location" options={OPTIONS} value="pantry" onChange={() => {}} wraps />,
    );
    expect(screen.getByRole("radiogroup", { name: "Location" })).toHaveClass(styles.wrap!);
  });
});
