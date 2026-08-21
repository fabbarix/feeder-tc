import { describe, expect, it } from "vitest";
import type { IngredientCategory } from "../../domain/index.ts";
import { CATEGORY_LABELS, CATEGORY_ORDER, groupByCategory, UNCATEGORISED_LABEL } from "./categories.ts";

interface Entry {
  readonly name: string;
  readonly category?: IngredientCategory;
}

describe("groupByCategory (WP-VC3 shopping-list category subheadings)", () => {
  it("groups entries under their category's label, in CATEGORY_ORDER", () => {
    const entries: readonly Entry[] = [
      { name: "Rice", category: "dry-goods" },
      { name: "Tomatoes", category: "produce" },
      { name: "Basil", category: "produce" },
    ];
    const sections = groupByCategory(entries, (e) => e.category);
    expect(sections.map((s) => s.heading)).toEqual([CATEGORY_LABELS.produce, CATEGORY_LABELS["dry-goods"]]);
    expect(sections[0]!.entries).toEqual([entries[0 + 1], entries[2]]); // Tomatoes, Basil under "Produce"
    expect(sections[1]!.entries).toEqual([entries[0]]); // Rice under "Dry goods"
  });

  it("uncategorised entries land in a trailing 'Other' section, never omitted", () => {
    const entries: readonly Entry[] = [{ name: "Mystery item" }, { name: "Tomatoes", category: "produce" }];
    const sections = groupByCategory(entries, (e) => e.category);
    expect(sections.map((s) => s.heading)).toEqual([CATEGORY_LABELS.produce, UNCATEGORISED_LABEL]);
    expect(sections.at(-1)!.entries).toEqual([entries[0]]);
  });

  it("never produces a section for a category with zero matching entries", () => {
    const entries: readonly Entry[] = [{ name: "Tomatoes", category: "produce" }];
    const sections = groupByCategory(entries, (e) => e.category);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.heading).toBe(CATEGORY_LABELS.produce);
  });

  it("an empty entry list produces no sections at all", () => {
    expect(groupByCategory<Entry>([], (e) => e.category)).toEqual([]);
  });

  it("CATEGORY_ORDER and CATEGORY_LABELS cover exactly the ten catalog categories", () => {
    expect(CATEGORY_ORDER).toHaveLength(10);
    expect(Object.keys(CATEGORY_LABELS).sort()).toEqual([...CATEGORY_ORDER].sort());
  });
});
