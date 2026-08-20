import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { UpdatePrompt } from "./UpdatePrompt.tsx";

describe("UpdatePrompt (UI_DESIGN.md §8/§13, WP-24)", () => {
  it("announces the new version via role=status/aria-live=polite", () => {
    render(<UpdatePrompt onReload={() => undefined} />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent(/new version/i);
  });

  it("calls onReload only when its own button is pressed — never on mount", async () => {
    const user = userEvent.setup();
    const onReload = vi.fn();
    render(<UpdatePrompt onReload={onReload} />);

    expect(onReload).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /reload/i }));
    expect(onReload).toHaveBeenCalledOnce();
  });

  it("has no axe violations", async () => {
    const { container } = render(<UpdatePrompt onReload={() => undefined} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
