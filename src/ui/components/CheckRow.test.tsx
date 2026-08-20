import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { CheckRow } from "./CheckRow.tsx";

describe("CheckRow", () => {
  it("renders a checkbox whose whole row (the label) is the tap target", () => {
    render(<CheckRow label="Rice" secondary="400 g needed" checked={false} onChange={() => {}} trailing="400 g" />);
    const checkbox = screen.getByRole("checkbox", { name: /rice/i });
    expect(checkbox).not.toBeChecked();
    expect(screen.getByText("400 g needed")).toBeInTheDocument();
  });

  it("calls onChange when toggled", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<CheckRow label="Rice" checked={false} onChange={onChange} />);

    await user.click(screen.getByRole("checkbox", { name: /rice/i }));

    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("shows a failed notice with a retry action that does not toggle the checkbox", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onRetry = vi.fn();
    render(<CheckRow label="Rice" checked={false} onChange={onChange} failed onRetry={onRetry} />);

    await user.click(screen.getByRole("button", { name: /retry/i }));

    expect(onRetry).toHaveBeenCalledOnce();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <CheckRow label="Rice" secondary="400 g needed" checked={false} onChange={() => {}} trailing="400 g" />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
