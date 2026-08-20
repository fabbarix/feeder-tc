import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { QuantityInput } from "./QuantityInput.tsx";

// WP-15 success criterion: "Quantity input rejects unit-less or negative
// entries at the component level" — invariant 3 (HANDOVER §4: one canonical
// unit per ingredient, no conversion logic anywhere).
describe("QuantityInput", () => {
  it("never renders a unit picker (no <select>) — the unit is fixed, not chosen", () => {
    render(<QuantityInput label="Amount" unit="g" value={null} onChange={() => {}} />);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("displays the ingredient's fixed canonical unit", () => {
    const { container } = render(
      <QuantityInput label="Amount" unit="g" value={null} onChange={() => {}} />,
    );
    expect(container.querySelector(".quantity-input__unit")).toHaveTextContent("g");
  });

  it("reports a valid amount paired with the fixed unit — never an amount alone", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<QuantityInput label="Amount" unit="g" value={null} onChange={onChange} />);

    await user.type(screen.getByRole("spinbutton", { name: /amount/i }), "400");

    expect(onChange).toHaveBeenLastCalledWith({ amount: 400, unit: "g" });
  });

  it("rejects a negative entry: reports null and shows an error", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<QuantityInput label="Amount" unit="g" value={null} onChange={onChange} />);

    const input = screen.getByRole("spinbutton", { name: /amount/i });
    await user.type(input, "-5");

    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent(/cannot be negative/i);
  });

  it("allows negative entries when allowNegative is set (signed AdjustEvent deltas)", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<QuantityInput label="Correction" unit="g" value={null} onChange={onChange} allowNegative />);

    await user.type(screen.getByRole("spinbutton", { name: /correction/i }), "-5");

    expect(onChange).toHaveBeenLastCalledWith({ amount: -5, unit: "g" });
  });

  it("rejects a required-but-empty entry", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<QuantityInput label="Amount" unit="piece" value={0} onChange={onChange} required />);

    const input = screen.getByRole("spinbutton", { name: /amount/i });
    await user.clear(input);

    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole("alert")).toHaveTextContent(/enter an amount/i);
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <QuantityInput label="Amount" unit="ml" value={null} onChange={() => {}} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
