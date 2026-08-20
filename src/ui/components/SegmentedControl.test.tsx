import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { SegmentedControl } from "./SegmentedControl.tsx";

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
});
