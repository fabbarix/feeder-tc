import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { LeftoversAtRiskCard } from "./LeftoversAtRiskCard.tsx";
import type { LeftoverAtRisk } from "./plan-derive.ts";
import { makeIngredientId, makeIsoDate, makeLotId, makeQuantity } from "../../domain/index.ts";
import type { Ingredient, Lot } from "../../domain/index.ts";

const TODAY = makeIsoDate("2026-08-24");

function entry(name: string, expiry: string, portions = 2): LeftoverAtRisk {
  const ingredient: Ingredient = {
    id: makeIngredientId(name),
    name,
    unit: "portion",
    shelfLifeDays: 4,
    openedShelfLifeDays: 4,
    defaultLocation: "fridge",
  };
  const lot: Lot = {
    id: makeLotId(`${name}-lot`),
    ingredientId: ingredient.id,
    quantity: makeQuantity(portions, "portion"),
    purchaseDate: makeIsoDate("2026-08-22"),
    location: "fridge",
    expiry: makeIsoDate(expiry),
    expiryOverridden: false,
  };
  return { ingredient, lot, totalPortions: portions };
}

function renderCard(items: readonly LeftoverAtRisk[]) {
  return render(
    <MemoryRouter>
      <LeftoversAtRiskCard items={items} today={TODAY} />
    </MemoryRouter>,
  );
}

describe("LeftoversAtRiskCard", () => {
  it("never impersonates a weekday — its own heading names the card, not a day", () => {
    renderCard([]);
    expect(screen.getByRole("heading", { name: "Leftovers" })).toBeVisible();
  });

  it("shows a reassuring empty state, not a blank panel, when nothing is at risk", () => {
    renderCard([]);
    expect(screen.getByText("Nothing at risk this week")).toBeVisible();
    // Reassurance, not an alarm — no leftover link/entry should render.
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("renders at-risk leftovers soonest-expiry-first, as links to the ingredient's pantry detail", () => {
    // Passed already-sorted (deriveLeftoversAtRisk's job), but the card
    // itself must not silently re-order — rendering in whatever order it
    // receives is exactly what a user notices as "soonest first".
    const items = [entry("Leftover: Soup", "2026-08-25"), entry("Leftover: Chili", "2026-08-28")];
    renderCard(items);

    const links = screen.getAllByRole("link", { name: /Leftover:/ });
    expect(links.map((l) => l.textContent)).toEqual([
      expect.stringContaining("Leftover: Soup"),
      expect.stringContaining("Leftover: Chili"),
    ]);
    expect(links[0]).toHaveAttribute("href", `/pantry/${entry("Leftover: Soup", "2026-08-25").ingredient.id}`);
    // Soonest-expiring entry reads as the more urgent one.
    expect(links[0]!.textContent).toMatch(/1 day/);
  });

  it("caps the visible list and links out to Pantry for the rest, rather than growing unbounded", () => {
    const items = [
      entry("Leftover: A", "2026-08-25"),
      entry("Leftover: B", "2026-08-26"),
      entry("Leftover: C", "2026-08-27"),
      entry("Leftover: D", "2026-08-28"),
      entry("Leftover: E", "2026-08-29"),
    ];
    renderCard(items);

    // Only the top LEFTOVERS_AT_RISK_LIMIT (3) entries render as list items.
    expect(screen.getAllByRole("link", { name: /Leftover:/ })).toHaveLength(3);
    expect(screen.getByText("Leftover: A")).toBeVisible();
    expect(screen.getByText("Leftover: B")).toBeVisible();
    expect(screen.getByText("Leftover: C")).toBeVisible();
    expect(screen.queryByText("Leftover: D")).not.toBeInTheDocument();
    expect(screen.queryByText("Leftover: E")).not.toBeInTheDocument();

    const overflowLink = screen.getByRole("link", { name: "+2 more in Pantry" });
    expect(overflowLink).toHaveAttribute("href", "/pantry");
  });
});
