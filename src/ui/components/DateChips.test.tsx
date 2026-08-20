import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { DateChips } from "./DateChips.tsx";
import { makeIsoDate } from "../../domain/types.ts";

const TODAY = makeIsoDate("2026-08-20");
const YESTERDAY = makeIsoDate("2026-08-19");

describe("DateChips", () => {
  it("renders one chip per option, none of them a native <input type=date>", () => {
    render(
      <DateChips
        label="Purchase date"
        options={[
          { label: "Today", date: TODAY },
          { label: "Yesterday", date: YESTERDAY },
        ]}
        value={TODAY}
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Today" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Yesterday" })).toHaveAttribute("aria-pressed", "false");
    expect(document.querySelector('input[type="date"]')).not.toBeInTheDocument();
  });

  it("calls onChange with the chip's date when pressed", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <DateChips
        label="Purchase date"
        options={[
          { label: "Today", date: TODAY },
          { label: "Yesterday", date: YESTERDAY },
        ]}
        value={TODAY}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Yesterday" }));
    expect(onChange).toHaveBeenCalledWith(YESTERDAY);
  });

  it("opens the escape-hatch calendar behind a Pick… chip when allowPick is set", async () => {
    const user = userEvent.setup();
    render(
      <DateChips
        label="Expiry override"
        options={[{ label: "+3d", date: YESTERDAY }]}
        value={null}
        onChange={() => {}}
        allowPick
      />,
    );

    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /pick/i }));
    expect(screen.getByRole("grid")).toBeInTheDocument();
  });

  it("does not render a Pick… chip unless allowPick is set", () => {
    render(
      <DateChips label="Week" options={[{ label: "This week", date: TODAY }]} value={TODAY} onChange={() => {}} />,
    );
    expect(screen.queryByRole("button", { name: /pick/i })).not.toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <DateChips
        label="Purchase date"
        options={[
          { label: "Today", date: TODAY },
          { label: "Yesterday", date: YESTERDAY },
        ]}
        value={TODAY}
        onChange={() => {}}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
