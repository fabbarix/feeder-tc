import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { Calendar } from "./Calendar.tsx";
import { makeIsoDate } from "../../../domain/types.ts";

describe("Calendar", () => {
  it("renders a grid, never a native <input type=date>", () => {
    render(<Calendar aria-label="Expiry" value={makeIsoDate("2026-08-20")} onChange={() => {}} />);
    expect(screen.getByRole("grid")).toBeInTheDocument();
    expect(document.querySelector('input[type="date"]')).not.toBeInTheDocument();
  });

  it("calls onChange with an IsoDate (YYYY-MM-DD string) when a day cell is pressed", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Calendar aria-label="Expiry" value={makeIsoDate("2026-08-20")} onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: /15/ }));

    expect(onChange).toHaveBeenCalledWith(expect.stringMatching(/^2026-08-15$/));
  });

  it("has no axe violations", async () => {
    const { container } = render(<Calendar aria-label="Expiry" value={makeIsoDate("2026-08-20")} onChange={() => {}} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
