import { expect, test } from "@playwright/test";
import { enterReadyShell } from "./support/shell.ts";

// UI_DESIGN.md §2: three-state System/Light/Dark, with a GUARDED dark media
// query (`:root:not([data-theme="light"])`) so an explicit choice can
// override the OS preference in either direction. This spec is the "test
// the guard" proof from the WP-15b definition of done: it emulates a
// system-dark and a system-light device and demonstrates the toggle
// overriding each one explicitly — not just following the OS.
async function readBg(page: import("@playwright/test").Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--bg").trim());
}

async function readDataTheme(page: import("@playwright/test").Page): Promise<string | null> {
  return page.evaluate(() => document.documentElement.getAttribute("data-theme"));
}

test.describe("theme toggle — system-dark device", () => {
  test.use({ colorScheme: "dark" });

  test("System (default) follows the OS: dark background, no data-theme attribute", async ({ page }) => {
    await enterReadyShell(page, "settings");
    expect(await readDataTheme(page)).toBeNull();
    expect(await readBg(page)).toBe("#121316");
  });

  test("THE GUARD: choosing Light overrides a dark OS", async ({ page }) => {
    await enterReadyShell(page, "settings");
    await page.getByRole("radio", { name: "Light" }).click();

    expect(await readDataTheme(page)).toBe("light");
    expect(await readBg(page)).toBe("#f5f4f0");
  });
});

test.describe("theme toggle — system-light device", () => {
  test.use({ colorScheme: "light" });

  test("System (default) follows the OS: light background, no data-theme attribute", async ({ page }) => {
    await enterReadyShell(page, "settings");
    expect(await readDataTheme(page)).toBeNull();
    expect(await readBg(page)).toBe("#f5f4f0");
  });

  test("THE GUARD (other direction): choosing Dark overrides a light OS", async ({ page }) => {
    await enterReadyShell(page, "settings");
    await page.getByRole("radio", { name: "Dark" }).click();

    expect(await readDataTheme(page)).toBe("dark");
    expect(await readBg(page)).toBe("#121316");
  });

  test("returning to System removes the override and follows the OS again", async ({ page }) => {
    await enterReadyShell(page, "settings");
    await page.getByRole("radio", { name: "Dark" }).click();
    expect(await readDataTheme(page)).toBe("dark");

    await page.getByRole("radio", { name: "System" }).click();
    expect(await readDataTheme(page)).toBeNull();
    expect(await readBg(page)).toBe("#f5f4f0");
  });
});

test("choosing an accent hue rewrites the theme-color meta tag to follow it", async ({ page }) => {
  await enterReadyShell(page, "settings");

  const before = await page.locator('meta#theme-color-dynamic').getAttribute("content");
  expect(before).toBeTruthy();

  await page.getByRole("button", { name: "Hue 210 degrees" }).click();
  const after = await page.locator('meta#theme-color-dynamic').getAttribute("content");

  expect(after).toBeTruthy();
  expect(after).not.toBe(before);
});

test("the choice persists across a reload (pre-paint script reads localStorage before first paint)", async ({
  page,
}) => {
  await enterReadyShell(page, "settings");
  await page.getByRole("radio", { name: "Dark" }).click();
  expect(await readDataTheme(page)).toBe("dark");

  await page.reload();
  // No flash-of-wrong-theme to assert directly, but the attribute being
  // correct immediately after reload (before any app JS has necessarily
  // finished) is the observable proof the inline pre-paint script ran.
  expect(await readDataTheme(page)).toBe("dark");
});
