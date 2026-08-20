import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { ErrorState } from "./ErrorState.tsx";

describe("ErrorState", () => {
  it("renders as an alert with a retry action", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<ErrorState title="Couldn't load the pantry" onRetry={onRetry} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load the pantry");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("has no axe violations", async () => {
    const { container } = render(<ErrorState title="Couldn't load the pantry" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
