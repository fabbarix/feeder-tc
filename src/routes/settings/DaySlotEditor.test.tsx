import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DaySlotEditor } from "./DaySlotEditor.tsx";

describe("DaySlotEditor", () => {
  it("shows every meal type as a toggle, pressed when the day has it", () => {
    render(
      <DaySlotEditor
        day="monday"
        slots={["breakfast", "dinner"]}
        onAdd={() => {}}
        onRemove={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Breakfast on Mon" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Lunch on Mon" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: "Dinner on Mon" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Snack on Mon" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("adds a meal the day doesn't have, and removes one it does", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    const onRemove = vi.fn();
    render(
      <DaySlotEditor
        day="monday"
        slots={["breakfast", "dinner"]}
        onAdd={onAdd}
        onRemove={onRemove}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Lunch on Mon" }));
    expect(onAdd).toHaveBeenCalledWith("lunch");

    await user.click(screen.getByRole("button", { name: "Dinner on Mon" }));
    expect(onRemove).toHaveBeenCalledWith(1);
  });

  it("shows a repeated meal's count, and a tap removes only the last one", async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    render(
      <DaySlotEditor
        day="monday"
        slots={["snack", "dinner", "snack"]}
        onAdd={() => {}}
        onRemove={onRemove}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Snack on Mon (2)" }));
    expect(onRemove).toHaveBeenCalledWith(2);
  });
});
