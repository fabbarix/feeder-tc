import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { QuantityInput } from "./QuantityInput.tsx";
import { Plus } from "../icons.ts";

// WP-15 success criterion: "Quantity input rejects unit-less or negative
// entries at the component level" — invariant 3 (HANDOVER §4: one canonical
// unit per ingredient, no conversion logic anywhere). UI_DESIGN.md §5:
// type="text" inputMode="decimal" holding a raw STRING in state — never
// type="number".
describe("QuantityInput", () => {
  it("never renders a unit picker (no <select>, no spinbutton) — the unit is fixed, not chosen", () => {
    render(<QuantityInput label="Amount" unit="g" value={null} onChange={() => {}} />);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
  });

  it("is a text input with inputMode=decimal, not type=number", () => {
    render(<QuantityInput label="Amount" unit="g" value={null} onChange={() => {}} />);
    const input = screen.getByRole("textbox", { name: /amount/i });
    expect(input).toHaveAttribute("type", "text");
    expect(input).toHaveAttribute("inputmode", "decimal");
  });

  it("displays the ingredient's fixed canonical unit", () => {
    render(<QuantityInput label="Amount" unit="g" value={null} onChange={() => {}} />);
    expect(screen.getByText("g", { selector: "span" })).toBeInTheDocument();
  });

  it("reports a valid amount paired with the fixed unit — never an amount alone", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<QuantityInput label="Amount" unit="g" value={null} onChange={onChange} />);

    await user.type(screen.getByRole("textbox", { name: /amount/i }), "400");

    expect(onChange).toHaveBeenLastCalledWith({ amount: 400, unit: "g" });
  });

  it("rejects a negative entry: reports null and shows an error", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<QuantityInput label="Amount" unit="g" value={null} onChange={onChange} />);

    const input = screen.getByRole("textbox", { name: /amount/i });
    await user.type(input, "-5");

    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent(/cannot be negative/i);
  });

  it("rejects scientific notation ('e') the way type=number would silently accept", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<QuantityInput label="Amount" unit="g" value={null} onChange={onChange} />);

    await user.type(screen.getByRole("textbox", { name: /amount/i }), "1e5");

    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole("alert")).toHaveTextContent(/enter a number/i);
  });

  it("allows negative entries when allowNegative is set (signed AdjustEvent deltas)", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<QuantityInput label="Correction" unit="g" value={null} onChange={onChange} allowNegative />);

    await user.type(screen.getByRole("textbox", { name: /correction/i }), "-5");

    expect(onChange).toHaveBeenLastCalledWith({ amount: -5, unit: "g" });
  });

  it("rejects a required-but-empty entry", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<QuantityInput label="Amount" unit="piece" value={0} onChange={onChange} required />);

    const input = screen.getByRole("textbox", { name: /amount/i });
    await user.clear(input);

    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole("alert")).toHaveTextContent(/enter an amount/i);
  });

  it("seeds the raw text from defaultValue when uncontrolled (value=null)", () => {
    render(<QuantityInput label="Amount" unit="piece" value={null} defaultValue="2" onChange={() => {}} />);
    expect(screen.getByRole("textbox", { name: /amount/i })).toHaveValue("2");
  });

  it("shows real touch-target steppers when showSteppers is set, and steps the value", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <QuantityInput label="Count" unit="piece" value={null} defaultValue="2" onChange={onChange} showSteppers />,
    );

    await user.click(screen.getByRole("button", { name: /increase count/i }));
    expect(onChange).toHaveBeenLastCalledWith({ amount: 3, unit: "piece" });

    await user.click(screen.getByRole("button", { name: /decrease count/i }));
    expect(onChange).toHaveBeenLastCalledWith({ amount: 2, unit: "piece" });
  });

  it("does not render steppers unless showSteppers is set", () => {
    render(<QuantityInput label="Amount" unit="g" value={null} onChange={() => {}} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders a prefixIcon/suffixIcon when supplied", () => {
    const { container } = render(
      <QuantityInput label="Amount" unit="piece" value={null} onChange={() => {}} prefixIcon={Plus} />,
    );
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = render(<QuantityInput label="Amount" unit="ml" value={null} onChange={() => {}} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  // WP-17: "Servings (servings)" — the label used to append "(unit)" itself
  // AND the field showed the unit again as its own suffix. The unit belongs
  // in exactly one of those two places; this pins it to the field, so the
  // visible/accessible label text is always exactly the bare `label` prop,
  // for every current and future QuantityInput/Stepper caller across the
  // app (recipe editor, settings, plan, shopping, pantry, scan all share
  // this one component).
  it("never repeats the unit in the label — it shows once, in the field itself", () => {
    render(<QuantityInput label="Servings" unit="servings" unitOne="serving" value={4} onChange={() => {}} />);
    const label = screen.getByText("Servings");
    expect(label.tagName.toLowerCase()).toBe("label");
    expect(label.textContent).toBe("Servings");
    // The unit is still communicated — visibly, as the field's own suffix,
    // and to a screen reader via aria-describedby (checked below) — just
    // not duplicated into the label text.
    expect(screen.getByText("servings", { selector: "span" })).toBeInTheDocument();
  });

  it("still exposes the unit to assistive tech via aria-describedby, even though the label text omits it", () => {
    render(<QuantityInput label="Prep time" unit="min" value={5} onChange={() => {}} />);
    const input = screen.getByRole("textbox", { name: "Prep time" });
    const describedBy = input.getAttribute("aria-describedby");
    expect(describedBy).not.toBeNull();
    const describedText = describedBy!
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ");
    expect(describedText).toContain("min");
  });
});
