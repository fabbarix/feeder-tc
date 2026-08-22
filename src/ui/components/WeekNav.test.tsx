import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { WeekNav } from "./WeekNav.tsx";

describe("WeekNav", () => {
  it("renders the week label and both chevrons — no picker (UI_DESIGN.md §5)", () => {
    render(<WeekNav label="Aug 17 – Aug 23" onPrevious={() => {}} onNext={() => {}} />);
    expect(screen.getByText("Aug 17 – Aug 23")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous week" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next week" })).toBeInTheDocument();
    expect(document.querySelector('input[type="date"]')).not.toBeInTheDocument();
  });

  it("calls onPrevious/onNext", async () => {
    const user = userEvent.setup();
    const onPrevious = vi.fn();
    const onNext = vi.fn();
    render(<WeekNav label="Aug 17 – Aug 23" onPrevious={onPrevious} onNext={onNext} />);

    await user.click(screen.getByRole("button", { name: "Previous week" }));
    expect(onPrevious).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "Next week" }));
    expect(onNext).toHaveBeenCalledOnce();
  });

  it("has no axe violations", async () => {
    const { container } = render(<WeekNav label="Aug 17 – Aug 23" onPrevious={() => {}} onNext={() => {}} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("omits the Today button entirely when onToday isn't supplied", () => {
    render(<WeekNav label="Aug 17 – Aug 23" onPrevious={() => {}} onNext={() => {}} />);
    expect(screen.queryByRole("button", { name: "Today" })).not.toBeInTheDocument();
  });

  it("renders and wires up a Today button when onToday is supplied", async () => {
    const user = userEvent.setup();
    const onToday = vi.fn();
    render(<WeekNav label="Aug 17 – Aug 23" onPrevious={() => {}} onNext={() => {}} onToday={onToday} />);
    const button = screen.getByRole("button", { name: "Today" });
    await user.click(button);
    expect(onToday).toHaveBeenCalledOnce();
  });
});
