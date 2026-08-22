import { expect, test } from "@playwright/test";
import { enterReadyShell } from "./support/shell.ts";

// Mobile UX review, BROKEN: on `/shopping` at 390px, a visible toast painted
// squarely over the scan FAB. Both are `position: fixed` to the viewport
// bottom (Toast.module.css's old `.viewport` / shopping.module.css's `.fab`),
// one spacing step apart — `elementFromPoint` at the FAB's centre resolved to
// the toast, not the FAB, and a toast fires on every Shopping check-off, so
// the scanner was untappable any time one was visible.
//
// Fixed by moving the whole toast stack to the TOP of the screen on phone
// (owner's explicit call, Toast.module.css) rather than reserving room next
// to the FAB — top and bottom no longer share an edge at all, so this
// resolves the collision unconditionally rather than just for this one FAB.
//
// The toast used here ("Fill in every field before saving.", IngredientEditor)
// is deliberately NOT a Shopping check-off toast: that one is being dropped
// as redundant with the checked row's own visible "bought …" text (see the
// round-2 report). `ToastProvider` is mounted above the router (main.tsx),
// so a toast fired on one route survives a client-side navigation to
// another — this triggers a toast where it's trivial to force
// deterministically, then navigates to Shopping while it's still up.
//
// Confirmed to FAIL on `origin/main` (07aa2ea) and pass once the toast moves
// to the top on phone.
test("Shopping: a visible toast does not cover the scan FAB at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await enterReadyShell(page, "recipes/ingredients/new");

  // A single space: satisfies the Name field's native HTML `required`
  // (non-empty), which would otherwise block the submit via a native
  // validation bubble before React ever sees it, but still fails
  // `handleSave`'s own `name.trim() === ""` check — the one path that
  // actually reaches the warning toast through the real form.
  await page.getByRole("textbox", { name: "Name" }).fill(" ");
  await page.getByRole("button", { name: "Save ingredient" }).click();
  await expect(page.getByText("Fill in every field before saving.")).toBeVisible();

  await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Shopping", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Shopping", level: 1 })).toBeVisible();
  // Still up — the default 3.5s auto-dismiss comfortably outlasts one quick
  // client-side navigation.
  await expect(page.getByText("Fill in every field before saving.")).toBeVisible();

  // Only the FAB carries this exact `aria-label` attribute — the tablet/
  // desktop `.scanAction` button gets its accessible name from visible text
  // instead, so this selector can't accidentally match that one.
  const fab = page.locator('button[aria-label="Scan a barcode"]');
  await expect(fab).toBeVisible();
  const box = await fab.boundingBox();
  expect(box, "scan FAB has no box — is it actually rendered at 390px?").not.toBeNull();
  const centre = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };

  const hitsFab = await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    return el !== null && el.closest('button[aria-label="Scan a barcode"]') !== null;
  }, centre);
  expect(hitsFab, "elementFromPoint at the FAB's centre did not resolve to the FAB — something is covering it").toBe(
    true,
  );
});
