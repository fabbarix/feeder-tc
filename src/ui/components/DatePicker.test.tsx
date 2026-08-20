import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { makeIsoDate } from "../../domain/types.ts";
import { DatePicker } from "./DatePicker.tsx";

// Date inputs don't support realistic key-by-key typing under jsdom (no
// native picker UI), so these use fireEvent.change directly on the
// underlying `value` — see MDN's note that <input type="date">'s IDL value
// is always the ISO string regardless of locale display.
describe("DatePicker", () => {
  it("reports a valid IsoDate", () => {
    const onChange = vi.fn();
    render(<DatePicker label="Expiry" value={null} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("Expiry"), { target: { value: "2026-03-04" } });

    expect(onChange).toHaveBeenLastCalledWith("2026-03-04");
  });

  it("reports null and an error when cleared while required", () => {
    const onChange = vi.fn();
    render(<DatePicker label="Expiry" value={makeIsoDate("2026-03-04")} onChange={onChange} required />);

    fireEvent.change(screen.getByLabelText("Expiry"), { target: { value: "" } });

    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole("alert")).toHaveTextContent(/choose a date/i);
  });

  it("has no axe violations", async () => {
    const { container } = render(<DatePicker label="Expiry" value={null} onChange={() => {}} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
