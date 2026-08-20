import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { ConfirmDialog } from "./ConfirmDialog.tsx";

describe("ConfirmDialog", () => {
  it("renders title and description when open, labelled for assistive tech", () => {
    render(
      <ConfirmDialog
        open
        title="Mark cooked?"
        description="This will deduct ingredients from the pantry."
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "Mark cooked?" });
    expect(dialog).toHaveAccessibleDescription("This will deduct ingredients from the pantry.");
  });

  it("calls onConfirm when the confirm button is clicked", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Delete lot?"
        confirmLabel="Delete"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("calls onCancel when the cancel button is clicked", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<ConfirmDialog open title="Delete lot?" onConfirm={() => {}} onCancel={onCancel} />);

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("has no axe violations while open", async () => {
    const { container } = render(
      <ConfirmDialog
        open
        title="Mark cooked?"
        description="This will deduct ingredients from the pantry."
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
