import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { ToggleChips } from "./ToggleChips.tsx";

const OPTIONS = [
  { value: "breakfast", label: "Breakfast" },
  { value: "lunch", label: "Lunch" },
  { value: "dinner", label: "Dinner" },
  { value: "snack", label: "Snack" },
] as const;

describe("ToggleChips", () => {
  it("renders each option as a pressable toggle reflecting the selected set", () => {
    render(<ToggleChips aria-label="Meal tags" options={OPTIONS} value={["lunch", "dinner"]} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Lunch" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Dinner" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Breakfast" })).toHaveAttribute("aria-pressed", "false");
  });

  it("adds a value on press when unselected, removes it when selected", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ToggleChips aria-label="Meal tags" options={OPTIONS} value={["lunch"]} onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "Dinner" }));
    expect(onChange).toHaveBeenLastCalledWith(["lunch", "dinner"]);

    await user.click(screen.getByRole("button", { name: "Lunch" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <ToggleChips aria-label="Meal tags" options={OPTIONS} value={["lunch"]} onChange={() => {}} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
