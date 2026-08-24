import { expect, test, type Page } from "@playwright/test";
import { enterReadyShell } from "./support/shell.ts";

/**
 * Recipe import from pasted text (DESIGN_RECIPE_IMPORT.md). CI must never
 * call a real endpoint (CLAUDE.md/TESTING.md) — the household's configured
 * "address" is faked with an init script that overrides `window.fetch`
 * before the app's own JS ever runs, not `page.route` (this app's msw
 * browser worker registers a real Service Worker for the Sheets/Drive/
 * Picker surface, and Service-Worker-intercepted fetches aren't reliably
 * reachable by Playwright's request interception — overriding `fetch`
 * itself, in-page, sidesteps that entirely and is closer to "this address
 * really answers this way" than any proxy would be).
 *
 * Every navigation here is client-side (link clicks), never `page.goto`
 * after sign-in — the access token lives only in memory
 * (`e2e/support/shell.ts`'s own doc comment), so a real browser navigation
 * would drop back to the signed-out gate mid-test.
 */
const MOCK_BASE_URL = "https://mock-recipe-reader.test/v1";

async function mockRecipeReaderFetch(page: Page, status: number, body: unknown): Promise<void> {
  await page.addInitScript(
    ([baseUrl, responseStatus, responseBody]) => {
      const realFetch = window.fetch.bind(window);
      window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.startsWith(baseUrl as string)) {
          return new Response(JSON.stringify(responseBody), {
            status: responseStatus as number,
            headers: { "Content-Type": "application/json" },
          });
        }
        return realFetch(input, init);
      };
    },
    [MOCK_BASE_URL, status, body],
  );
}

const VALID_RESPONSE_BODY = {
  choices: [
    {
      message: {
        content: JSON.stringify({
          isRecipe: true,
          name: "Garlic Rice",
          servings: 4,
          prepMinutes: 5,
          cookMinutes: 20,
          ingredients: [
            { name: "garlic", amount: 2, unit: "piece", note: "" },
            { name: "something rare", amount: 1, unit: "cup", note: "" },
          ],
          steps: [{ description: "Cook the rice with garlic." }],
        }),
      },
    },
  ],
};

async function goToImportScreen(page: Page): Promise<void> {
  const nav = page.getByRole("navigation", { name: "Primary" });
  await nav.getByRole("link", { name: "Recipes", exact: true }).click();
  await page.getByRole("link", { name: "Add from a recipe you found online" }).click();
  await expect(page.getByRole("heading", { name: "Add from a recipe you found online" })).toBeVisible();
}

async function configureProvider(page: Page, { linkEnabled = false }: { linkEnabled?: boolean } = {}): Promise<void> {
  const nav = page.getByRole("navigation", { name: "Primary" });
  await nav.getByRole("link", { name: "Settings" }).click();
  await page.getByLabel("The address to send recipes to").fill(MOCK_BASE_URL);
  await page.getByLabel("The password for that address").fill("test-key");
  if (linkEnabled) {
    await page.getByLabel("This address can open a web link, not just read pasted text").check();
  }
  await goToImportScreen(page);
}

/**
 * Faked the same way as `mockRecipeReaderFetch` above (same doc comment
 * applies — an in-page `fetch` override, not `page.route`), but routing on
 * the request path so a test can give `/responses` (the link path,
 * `importRecipeFromLink`) a different canned answer than `/chat/completions`
 * (the text path) within the same page.
 */
async function mockRecipeReaderResponsesFetch(page: Page, status: number, body: unknown): Promise<void> {
  await page.addInitScript(
    ([baseUrl, responseStatus, responseBody]) => {
      const realFetch = window.fetch.bind(window);
      window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === `${baseUrl as string}/responses`) {
          return new Response(JSON.stringify(responseBody), {
            status: responseStatus as number,
            headers: { "Content-Type": "application/json" },
          });
        }
        return realFetch(input, init);
      };
    },
    [MOCK_BASE_URL, status, body],
  );
}

const VALID_RESPONSES_BODY = {
  status: "completed",
  output_text: JSON.stringify({
    isRecipe: true,
    name: "Garlic Rice",
    servings: 4,
    prepMinutes: 5,
    cookMinutes: 20,
    ingredients: [
      { name: "garlic", amount: 2, unit: "piece", note: "" },
      { name: "something rare", amount: 1, unit: "cup", note: "" },
    ],
    steps: [{ description: "Cook the rice with garlic." }],
  }),
};

test("importing pasted text prefills the recipe editor, marking a confident match and leaving an unmatched line for the cook", async ({
  page,
}) => {
  await mockRecipeReaderFetch(page, 200, VALID_RESPONSE_BODY);
  await enterReadyShell(page);
  await configureProvider(page);

  await page
    .getByLabel("Paste the recipe here")
    .fill("Garlic Rice\n2 cloves garlic\n1 cup of something rare\nCook the rice with garlic.");
  await page.getByRole("button", { name: "Read this recipe" }).click();

  await expect(page).toHaveURL(/\/recipes\/new$/);
  await expect(page.getByRole("heading", { name: "Add recipe" })).toBeVisible();
  await expect(page.getByLabel("Name")).toHaveValue("Garlic Rice");

  // The source text stays visible beside the draft (§10/§11).
  await expect(page.getByText("What you pasted")).toBeVisible();

  // A confident match ("garlic") is pre-filled and marked, never silent.
  await expect(page.getByText("Matched from import")).toBeVisible();
  // The unmatched line stays for the cook to resolve, with its raw reading visible.
  await expect(page.getByText(/As read:.*something rare/)).toBeVisible();
});

test("the disclosure is shown before any request, and nothing is sent while offline", async ({ page, context }) => {
  await enterReadyShell(page);
  await configureProvider(page);
  await expect(page.getByText(/sends this text to the address you set up in settings/i)).toBeVisible();

  await context.setOffline(true);
  await expect(page.getByText(/needs to be online/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Read this recipe" })).toBeDisabled();
  await context.setOffline(false);
});

test("the import action is disabled with a plain explanation until a provider is configured", async ({ page }) => {
  await enterReadyShell(page);
  await goToImportScreen(page);
  await expect(page.getByText(/set up an address for reading recipes first/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Read this recipe" })).toBeDisabled();
  await page.getByRole("main").getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/settings$/);
});

test("an unusable response surfaces a plain-language error, never a raw status", async ({ page }) => {
  await mockRecipeReaderFetch(page, 401, "");
  await enterReadyShell(page);
  await configureProvider(page);

  await page.getByLabel("Paste the recipe here").fill("Anything at all, doesn't matter for this test.");
  await page.getByRole("button", { name: "Read this recipe" }).click();

  await expect(page.getByText(/password wasn't accepted/i)).toBeVisible();
  await expect(page.getByText("401")).toHaveCount(0);
});

test("with the link toggle on, giving a web address instead of pasting reads the recipe straight from the link", async ({ page }) => {
  await mockRecipeReaderResponsesFetch(page, 200, VALID_RESPONSES_BODY);
  await enterReadyShell(page);
  await configureProvider(page, { linkEnabled: true });

  // The floor is still there, untouched, and left empty for this test.
  await expect(page.getByLabel("Paste the recipe here")).toBeVisible();

  await page.getByLabel("Or, the web address to read this recipe from").fill("https://example.com/garlic-rice");
  await expect(page.getByText(/feeder will open this page itself/i)).toBeVisible();
  await page.getByRole("button", { name: "Read this recipe" }).click();

  await expect(page).toHaveURL(/\/recipes\/new$/);
  await expect(page.getByRole("heading", { name: "Add recipe" })).toBeVisible();
  await expect(page.getByLabel("Name")).toHaveValue("Garlic Rice");

  // No pasted text exists for this import — the panel says so plainly rather than showing an empty box.
  await expect(page.getByText("Where this came from")).toBeVisible();
  await expect(page.getByText("What you pasted")).toHaveCount(0);
  await expect(page.getByText("Matched from import")).toBeVisible();
});

test("when the address doesn't actually support opening a link, the error names no protocol", async ({ page }) => {
  await mockRecipeReaderResponsesFetch(page, 400, { error: { message: "Unknown tool type 'web_search_preview'" } });
  await enterReadyShell(page);
  await configureProvider(page, { linkEnabled: true });

  await page.getByLabel("Or, the web address to read this recipe from").fill("https://example.com/garlic-rice");
  await page.getByRole("button", { name: "Read this recipe" }).click();

  await expect(page.getByText(/doesn't seem to support reading a recipe straight from a link/i)).toBeVisible();
  for (const jargon of ["endpoint", "token", "schema", "API", "400"]) {
    await expect(page.getByText(jargon, { exact: false })).toHaveCount(0);
  }
});

test("a page that turns out not to be a recipe surfaces the same plain message as the text path", async ({ page }) => {
  await mockRecipeReaderResponsesFetch(page, 200, {
    status: "completed",
    output_text: JSON.stringify({ isRecipe: false, name: "", servings: null, prepMinutes: null, cookMinutes: null, ingredients: [], steps: [] }),
  });
  await enterReadyShell(page);
  await configureProvider(page, { linkEnabled: true });

  await page.getByLabel("Or, the web address to read this recipe from").fill("https://example.com/not-a-recipe");
  await page.getByRole("button", { name: "Read this recipe" }).click();

  await expect(page.getByText(/doesn't look like a recipe/i)).toBeVisible();
});
