import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { SelectSheet } from "./SelectSheet.tsx";

const OPTIONS = [
  { value: "rice", label: "Rice" },
  { value: "milk", label: "Milk" },
  { value: "eggs", label: "Eggs" },
];

describe("SelectSheet", () => {
  it("renders a trigger button showing the placeholder, never a native <select>", () => {
    render(<SelectSheet label="Ingredient" options={OPTIONS} value={null} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: /ingredient/i })).toHaveTextContent("Select…");
    expect(document.querySelector("select")).not.toBeInTheDocument();
  });

  it("shows the selected option's label on the trigger", () => {
    render(<SelectSheet label="Ingredient" options={OPTIONS} value="milk" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: /ingredient/i })).toHaveTextContent("Milk");
  });

  it("opens a searchable listbox and selects an option, closing afterwards", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SelectSheet label="Ingredient" options={OPTIONS} value={null} onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: /ingredient/i }));
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    await user.click(screen.getByRole("option", { name: "Eggs" }));

    expect(onChange).toHaveBeenCalledWith("eggs");
  });

  it("filters options via the search field", async () => {
    const user = userEvent.setup();
    render(<SelectSheet label="Ingredient" options={OPTIONS} value={null} onChange={() => {}} />);

    await user.click(screen.getByRole("button", { name: /ingredient/i }));
    await user.type(screen.getByRole("textbox", { name: /search ingredient/i }), "ri");

    expect(screen.getByRole("option", { name: "Rice" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Milk" })).not.toBeInTheDocument();
  });

  it("has no axe violations when open", async () => {
    const user = userEvent.setup();
    const { container } = render(<SelectSheet label="Ingredient" options={OPTIONS} value={null} onChange={() => {}} />);
    await user.click(screen.getByRole("button", { name: /ingredient/i }));
    expect(await axe(container)).toHaveNoViolations();
  });
});
