import { expect, test } from "@playwright/test";
import { enterReadyShell } from "./support/shell.ts";
import { addRichCookedRecipe } from "./support/recipes.ts";
import { goToIngredients, addRichIngredient } from "./support/ingredients.ts";
import {
  goToSettings,
  setHouseholdSize,
  setRepeatExclusionWeeks,
  setThemeMode,
  setAccentHue,
  makeDinnerOnly,
} from "./support/settings.ts";
import {
  goToPantry,
  addPantryStock,
  openPantryItem,
  moveLot,
  openLot,
  correctLot,
  spoilLot,
  recordUsage,
} from "./support/pantry.ts";
import {
  goToPlan,
  generateWeek,
  dayCard,
  pickMealForEmptySlot,
  clearFutureSlot,
  markSlotCooked,
  todayCard,
  pinSlot,
  rerollSlot,
  bumpServings,
} from "./support/plan.ts";
import {
  goToShopping,
  seedShoppingNeed,
  selectRangePreset,
  adjustQuantity,
  openWhyDisclosureIfPresent,
  checkOffItem,
  reachScanner,
} from "./support/shopping.ts";
import { stubCamera, createUnknownProduct } from "./support/scan.ts";
import { dismissToasts } from "./support/toast.ts";
import { WIDE_BREAKPOINT_PX } from "./support/viewports.ts";

/**
 * The owner's own success criterion for v1.0.0 (IMPLEMENTATION_PLAN.md
 * WP-31): "onboard → recipes → pantry → generate week → shop → mark cooked
 * → leftovers", now run at every window size that criterion has to hold at
 * (phone/tablet/desktop — see `e2e/support/viewports.ts`, wired as the
 * `journey-phone`/`journey-tablet`/`journey-desktop` Playwright projects).
 * One long, real household session rather than isolated per-feature tests
 * (owner's own design guidance: "a few long journeys beat many isolated
 * tests") — every navigation is a real click, never `page.goto` to a deep
 * route, so a control that's missing at some tier fails HERE rather than
 * being silently bypassed the way the barcode-scanner bug
 * (commit af73a08) was invisible to a suite that only ever `goto`'d `/scan`.
 *
 * Targeted reachability checks for anything this one session can't
 * naturally reach — Plan's month/quarter views, the past-slot remove
 * confirm, the pantry/shopping wide-rail tier gating — live in
 * `e2e/reach-*.spec.ts` instead.
 */
test.describe.configure({ mode: "serial" });

test("A household's first week", async ({ page }) => {
  // Manual barcode entry only — headless CI has no camera (see scan.ts).
  // Must be registered before the FIRST navigation.
  await stubCamera(page);

  // ---- Onboarding: sign-in, create workbook, seeded catalogue landing ----
  await enterReadyShell(page);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  await goToIngredients(page);
  await expect(page.getByRole("link", { name: "Rice", exact: true })).toBeVisible();
  const seededRows = page.getByRole("main").getByRole("link");
  expect(await seededRows.count(), "a fresh workbook's bootstrap seeds ~100 catalog ingredients").toBeGreaterThan(50);

  // ---- Settings: household size, repeat window, theme, accent, slot layout ----
  await goToSettings(page);
  await setHouseholdSize(page, 4);
  await setRepeatExclusionWeeks(page, 0);
  await setThemeMode(page, "Dark");
  await setAccentHue(page, 210);
  await makeDinnerOnly(page); // deterministic 7-dinner-slot week, same setup e2e/wp-22-weekly-planning.spec.ts relies on

  // ---- Recipes: enough dinner candidates to fill every slot (2 staples +
  // 6 rotation — e2e/wp-22-weekly-planning.spec.ts's own proven count), one
  // of them carrying every "rich" field the task brief calls out. ----
  await addRichCookedRecipe(page, "Sunday Roast", { staple: true });
  await addRichCookedRecipe(page, "Fish Pie", { staple: true });
  await addRichCookedRecipe(page, "Carbonara", {
    photo: true,
    steps: [
      { instruction: "Boil the pasta until al dente.", durationMinutes: 5 },
      {
        instruction: "Off the heat, stir in egg, pecorino and pepper.",
        durationMinutes: 2,
        detail: "**Do not** let the pan touch direct heat here — the egg will scramble instead of forming a sauce.",
        photo: true,
      },
    ],
  });
  await addRichCookedRecipe(page, "Roast Chicken");
  await addRichCookedRecipe(page, "Store Lasagna");
  await addRichCookedRecipe(page, "Tomato Salad");
  await addRichCookedRecipe(page, "Beef Stew");
  await addRichCookedRecipe(page, "Veggie Curry");
  await dismissToasts(page);

  // Read view: photo, per-step duration/markdown-detail disclosure, timer.
  await page.getByRole("link", { name: "Carbonara" }).click();
  await expect(page.getByRole("heading", { name: "Carbonara" })).toBeVisible();
  await expect(page.locator("main img")).toHaveCount(2); // recipe photo + step-2 photo

  const detailDisclosure = page.locator("details summary");
  await expect(page.getByText(/Do not.*let the pan touch direct heat/)).not.toBeVisible();
  await detailDisclosure.click();
  await expect(page.getByText(/let the pan touch direct heat/)).toBeVisible();

  await page.getByRole("button", { name: "Start timer" }).first().click();
  await expect(page.getByText(/^\d+:\d{2}$/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Pause timer" })).toBeVisible();
  await page.getByRole("button", { name: "Pause timer" }).click();
  await expect(page.getByRole("button", { name: "Resume timer" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel timer" }).click();
  await expect(page.getByRole("button", { name: "Start timer" }).first()).toBeVisible();

  // ---- Ingredients: photo, "How you buy it", "How you measure it" ----
  await addRichIngredient(page, "Rolled Oats", {
    canonicalUnit: "g",
    defaultLocation: "Pantry",
    shelfLifeDays: "365",
    photo: true,
    howYouBuyIt: { soldAs: "Whole", packSize: "500", containerName: "Cardboard box" },
    howYouMeasureIt: { cupWeightGrams: "90" },
  });
  await goToIngredients(page);
  await expect(page.getByRole("link", { name: "Rolled Oats", exact: true })).toBeVisible();

  // ---- Pantry: stock, a lot's full lifecycle, manual usage ----
  await goToPantry(page);
  await addPantryStock(page, "Ground beef", "1000"); // for the Chili scenario below
  await dismissToasts(page);
  await addPantryStock(page, "Milk", "500");
  await dismissToasts(page);
  await addPantryStock(page, "Eggs", "12");
  await dismissToasts(page);

  await openPantryItem(page, "Milk");
  await moveLot(page, "Fridge");
  await expect(page.getByRole("main")).toContainText("Fridge");
  await openLot(page);
  await expect(page.getByRole("main")).toContainText(/opened \d{1,2} \w+/);
  await correctLot(page, "-50", "+1w");
  await expect(page.getByRole("main")).toContainText("450 ml"); // Milk's canonical unit is millilitres, not grams
  await spoilLot(page, "50");
  await expect(page.getByRole("main")).toContainText("400 ml");

  await goToPantry(page);
  await recordUsage(page, "Eggs", "4");
  await expect(page.getByRole("main")).toContainText("8");

  // ---- Plan: generate, pin/reroll, remove + manual pick, scale, mark cooked ----
  await goToPlan(page);
  await generateWeek(page);
  await expect(page.getByRole("button", { name: /Pick a meal/ })).toHaveCount(0);

  // Staples land on the first two chronological days in creation order
  // (generator.ts's advanceStaples) — same determinism WP-22's own spec
  // relies on: Monday gets "Sunday Roast", Tuesday gets "Fish Pie".
  const tuesday = dayCard(page, "Tue");
  const wednesday = dayCard(page, "Wed");
  await expect(tuesday.getByRole("button", { name: "Fish Pie", exact: true })).toBeVisible();

  await pinSlot(tuesday);
  const wednesdayNameBefore = await wednesday.locator('[class*="slotNameButton"]').innerText();
  await rerollSlot(wednesday);
  await expect(tuesday.getByRole("button", { name: "Fish Pie", exact: true })).toBeVisible(); // pinned, unchanged
  await expect(wednesday.locator('[class*="slotNameButton"]')).not.toHaveText(wednesdayNameBefore);

  // Today's highlight — the app's ONLY "today" marker is this badge text
  // (no day-level CSS treatment exists — see reach-plan.spec.ts).
  await expect(todayCard(page)).toContainText("tonight");

  // Remove from plan (the app's only such affordance — clearing a still-
  // "planned" future slot via the picker's "Clear this slot"; see
  // reach-plan.spec.ts for why a PAST/cooked slot has no equivalent), then
  // manually pick a specific recipe onto the now-empty slot.
  const saturday = dayCard(page, "Sat");
  const saturdayNameBefore = await saturday.locator('[class*="slotNameButton"]').innerText();
  await clearFutureSlot(page, saturday, saturdayNameBefore);
  await expect(saturday.getByRole("button", { name: "Pick a meal for Dinner" })).toBeVisible();

  await addRichCookedRecipe(page, "Chili", { ingredients: [{ name: "Ground beef", amount: "250" }] });
  await dismissToasts(page);
  await goToPlan(page);
  const saturdayAfterClear = dayCard(page, "Sat");
  await pickMealForEmptySlot(page, saturdayAfterClear, "Dinner", "Chili");

  // Scale: household of 4 -> 8 servings (the +/- stepper — present at every
  // tier despite design/mock-responsive.html's "phone-only" note; see
  // reach-plan.spec.ts).
  await bumpServings(saturdayAfterClear, "Chili", 4);
  await expect(saturdayAfterClear.locator('[class*="scaleBadge"]')).toHaveText("8 servings");

  // Mark cooked -> pantry deduction (FIFO) + leftover reconciliation.
  await markSlotCooked(page, saturdayAfterClear, "Chili");
  await dismissToasts(page);

  await goToPantry(page);
  await expect(page.getByRole("main")).toContainText("500 g"); // 1000 g - 500 g (250 g x2 at 8 servings)
  await expect(page.getByRole("link", { name: /Leftover: Chili/ })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("4 portion");

  await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Recipes", exact: true }).click();
  // Not `exact: true` — a recipe card's accessible name is its full text
  // content ("Chili 15 prep 20 cook serves 4 Dinner"), not just the name.
  await page.getByRole("link", { name: /^Chili\b/ }).click();
  await expect(page.getByRole("main")).toContainText(/Cooked \d+ time/i);

  // ---- Shopping: list, range presets, quantity adjust, "Why?", reach Scan ----
  // Rice's baseServings-2 recipe scales x2 for this now-4-person household:
  // 137 g becomes a 274 g need. Rice is a plain loose "g" catalog ingredient
  // with no configured pack size, so the SUGGESTED buy amount is never
  // rounded — but (fix-ua-integrity) every row's own "Why?" disclosure now
  // also answers "why is this on my list at all" from `line.sources`
  // (`buildWhyExplanation`), not just the pack-rounding arithmetic, so it is
  // present and correct here too, just without a rounding sentence tacked
  // on.
  await seedShoppingNeed(page, { recipeName: "E2E rice dinner", ingredientId: "rice", amount: 137, unit: "g" });
  await goToShopping(page);
  const riceCheckbox = page.getByRole("checkbox", { name: /rice/i });
  const riceRow = riceCheckbox.locator("xpath=ancestor::label[1]");
  await expect(riceCheckbox).toBeVisible();
  await expect(riceRow).toContainText("274 g");
  expect(await openWhyDisclosureIfPresent(page, "rice"), "every row explains its own day/source, rounded or not").toBe(
    true,
  );
  await expect(riceRow.locator("xpath=following-sibling::details[1]")).toContainText(/dinner \(E2E rice dinner\) needs/i);
  await expect(riceRow.locator("xpath=following-sibling::details[1]")).not.toContainText(/sold in|round up/i);

  await selectRangePreset(page, "Next week");
  await expect(riceCheckbox).toHaveCount(0); // nothing planned next week
  await selectRangePreset(page, "This week");
  await expect(riceCheckbox).toBeVisible();

  await adjustQuantity(page, /rice/i, 1);

  // fix-ua-integrity: the desktop/tablet rail used to also carry a single
  // "Why N rice?" block naming whichever line was `uncheckedLines[0]` —
  // that was the defect a usability review caught (the panel's answer
  // silently stopped matching the row a person was looking at once other
  // items existed or got checked off). The rail is now just the "N items
  // still to buy" count; the day/source explanation lives entirely in each
  // row's own disclosure, asserted above and in the dedicated regression
  // test (e2e/wp-23-shopping-trip.spec.ts).
  const width = page.viewportSize()?.width ?? 0;
  const railStat = page.getByText("items still to buy");
  if (width >= WIDE_BREAKPOINT_PX) {
    await expect(railStat).toBeVisible();
  } else {
    await expect(railStat).toHaveCount(1); // present in the DOM, just not visible
    await expect(railStat).toBeHidden();
  }

  // Check off a SECOND need manually (the confirm sheet — location,
  // quantity-bought override, "Mark bought") rather than every purchase
  // going through the barcode scanner, which is its own separate path.
  await seedShoppingNeed(page, { recipeName: "E2E onion dinner", ingredientId: "onion", amount: 2, unit: "piece" });
  // useShoppingList reads its data once at mount — clicking "Shopping" while
  // already ON Shopping doesn't remount/refetch, so navigate away and back
  // to actually pick up the newly seeded need.
  await goToPantry(page);
  await goToShopping(page);
  await checkOffItem(page, "onion", "4");
  await expect(page.getByRole("checkbox", { name: /onion/i })).toBeChecked();
  await dismissToasts(page); // a lingering "Marked bought" toast can sit over the phone FAB and intercept the click below

  // Scan: reachable at every tier (the FAB on phone, a page action on
  // tablet/desktop, since commit af73a08 — dedicated regression coverage
  // lives in e2e/m6-scan-reachable.spec.ts).
  await reachScanner(page);
  await createUnknownProduct(page, {
    barcode: "8001120000123",
    name: "Riso Gallo Arborio 1 kg",
    ingredientName: "Rice",
    packageContentAmount: "1",
    packageContentUnit: "kg",
    price: "2.49",
  });

  await goToShopping(page);
  await expect(page.getByRole("checkbox", { name: /rice/i })).toHaveCount(0); // the need is now covered

  // ---- Price history: per ingredient and per product ----
  await goToPantry(page);
  await openPantryItem(page, "Rice");
  await page.getByRole("link", { name: "Price history" }).click();
  await expect(page.getByRole("heading", { name: "Rice" })).toBeVisible();
  // Several `$`-prefixed figures render on this page (headline latest price,
  // the raw $2.49 observation, per-100g normalizations) — reachability only
  // needs SOME price content to be visible, not a specific one.
  await expect(page.getByText(/\$\d/).first()).toBeVisible();

  await page.getByRole("link", { name: /price history/i }).click();
  await expect(page.getByRole("tab", { name: "Products" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("radio", { name: "Price history" })).toBeChecked();
  await page.getByRole("radio", { name: "By product" }).click();
  await page.getByRole("link", { name: /Riso Gallo Arborio/ }).click();
  await expect(page.getByRole("heading", { name: "Riso Gallo Arborio 1 kg" })).toBeVisible();

  // ---- Leftovers: visible in the default list, and the narrowing
  // "Leftovers" filter reachable, at EVERY tier.
  //
  // This block previously asserted the filter group was ABSENT below 768px
  // — encoding the bug as expected behaviour, because when this suite was
  // written `pantry.module.css`'s `.rail` was `display:none` on phone with
  // no replacement, leaving no route to Leftovers at all on the primary
  // device. That gap is fixed (the phone tier now gets the Stock/Leftovers
  // tab and filter row the approved mock specifies), so the assertion is
  // now the same at every tier: the filter is REACHABLE and it works.
  //
  // Worth keeping in mind generally: a test written against a buggy app can
  // quietly cement the bug. This one did, and only failed once the bug was
  // fixed. ----
  //
  // The CONTROL differs by tier, deliberately, and the mock says so: phone
  // gets a "Stock"/"Leftovers" section tab (a two-option segmented control
  // reads better than a chip buried in a filter row on a 390px screen),
  // while tablet/desktop keep "Leftovers" as a chip inside the "Show"
  // filter group. Both drive the same state. What must NOT differ by tier
  // is that Leftovers is reachable at all — that is the property this
  // asserts.
  await goToPantry(page);
  await expect(page.getByRole("link", { name: /Leftover: Chili/ })).toBeVisible();

  const leftoversControl =
    width >= WIDE_BREAKPOINT_PX
      ? page.getByRole("group", { name: "Show" }).getByRole("button", { name: "Leftovers" })
      : page.getByRole("radiogroup", { name: "Pantry section" }).getByRole("radio", { name: "Leftovers" });

  await expect(leftoversControl, `no reachable route to Leftovers at ${width}px`).toBeVisible();
  await leftoversControl.click();
  await expect(page.getByRole("link", { name: /Leftover: Chili/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Rice", exact: true })).toHaveCount(0);
});
