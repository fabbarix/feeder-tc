import { beforeEach, describe, expect, it } from "vitest";
import { pickWorkbook, type PickedWorkbook, type PickerLauncher } from "./picker.ts";
import { createWorkbookRegistry } from "./registry.ts";
import type { SheetsAuthAdapter } from "./transport.ts";

function fakeLauncher(result: PickedWorkbook | undefined): { launcher: PickerLauncher; openedWithToken: string[] } {
  const openedWithToken: string[] = [];
  return {
    launcher: {
      async open(accessToken) {
        openedWithToken.push(accessToken);
        return result;
      },
    },
    openedWithToken,
  };
}

const AUTH: SheetsAuthAdapter = { getAccessToken: async () => "tok-abc", invalidate: () => {} };

beforeEach(() => {
  localStorage.clear();
});

describe("pickWorkbook", () => {
  it("registers the picked spreadsheet and makes it the active workbook", async () => {
    const { launcher, openedWithToken } = fakeLauncher({ id: "fam-123", name: "Family Meal Planner" });
    const registry = createWorkbookRegistry(localStorage, "feeder.workbookRegistry.picker-test-1");

    const picked = await pickWorkbook(launcher, AUTH, registry);

    expect(picked).toEqual({ id: "fam-123", name: "Family Meal Planner" });
    expect(registry.list()).toEqual([{ id: "fam-123", name: "Family Meal Planner" }]);
    expect(registry.getActive()).toEqual({ id: "fam-123", name: "Family Meal Planner" });
    expect(openedWithToken).toEqual(["tok-abc"]); // opened with the already-authenticated user's token
  });

  it("switches active workbook to the newly picked one even if another was already active", async () => {
    const { launcher } = fakeLauncher({ id: "fam-123", name: "Family Meal Planner" });
    const registry = createWorkbookRegistry(localStorage, "feeder.workbookRegistry.picker-test-2");
    registry.add({ id: "other-456", name: "In-laws Planner" });

    await pickWorkbook(launcher, AUTH, registry);

    expect(registry.getActive()?.id).toBe("fam-123");
  });

  it("leaves the registry untouched when the user cancels the Picker", async () => {
    const { launcher } = fakeLauncher(undefined);
    const registry = createWorkbookRegistry(localStorage, "feeder.workbookRegistry.picker-test-3");

    const picked = await pickWorkbook(launcher, AUTH, registry);

    expect(picked).toBeUndefined();
    expect(registry.list()).toEqual([]);
  });
});
