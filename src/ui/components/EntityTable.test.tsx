import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { EntityTable } from "./EntityTable.tsx";

interface Row {
  readonly id: string;
  readonly name: string;
  readonly amount: string;
}

const ROWS: readonly Row[] = [
  { id: "1", name: "Rice", amount: "700 g" },
  { id: "2", name: "Milk", amount: "500 ml" },
];

const COLUMNS = [
  { key: "name", header: "Ingredient", render: (row: Row) => row.name },
  { key: "amount", header: "Amount", render: (row: Row) => row.amount, align: "end" as const },
];

describe("EntityTable", () => {
  it("renders a semantic table with a row per entity", () => {
    render(
      <EntityTable caption="Pantry" columns={COLUMNS} rows={ROWS} getRowKey={(r) => r.id} />,
    );

    expect(screen.getByRole("table", { name: "Pantry" })).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(3); // header + 2 data rows
    expect(screen.getByRole("cell", { name: "Rice" })).toBeInTheDocument();
  });

  it("shows the empty message when there are no rows", () => {
    render(
      <EntityTable
        caption="Pantry"
        columns={COLUMNS}
        rows={[]}
        getRowKey={(r) => r.id}
        emptyMessage="No lots yet."
      />,
    );

    expect(screen.getByText("No lots yet.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <EntityTable caption="Pantry" columns={COLUMNS} rows={ROWS} getRowKey={(r) => r.id} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
