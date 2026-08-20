import { describe, expect, it } from "vitest";
import { deriveShellState } from "./shell-state.ts";
import type { ShellUser } from "./ui/AppShell.tsx";
import type { WorkbookRegistryEntry } from "./sheets/registry.ts";

const USER: ShellUser = { name: "Fabio Torchetti", email: "fabbari@gmail.com" };
const WORKBOOK: WorkbookRegistryEntry = { id: "sheet-1", name: "Household planner" };

describe("deriveShellState", () => {
  it("is signed-out when the auth state machine is signed-out, even with a stale user/workbook", () => {
    expect(deriveShellState("signed-out", USER, WORKBOOK)).toEqual({ kind: "signed-out" });
  });

  it("is signed-out when signed in but the user identity hasn't resolved (or failed) yet", () => {
    expect(deriveShellState("signed-in", undefined, WORKBOOK)).toEqual({ kind: "signed-out" });
  });

  it("is no-workbook when signed in with a user but no active workbook", () => {
    expect(deriveShellState("signed-in", USER, undefined)).toEqual({ kind: "no-workbook", user: USER });
  });

  it("is ready when signed in with both a user and an active workbook", () => {
    expect(deriveShellState("signed-in", USER, WORKBOOK)).toEqual({
      kind: "ready",
      user: USER,
      workbookName: "Household planner",
    });
  });
});
