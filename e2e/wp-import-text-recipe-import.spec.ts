import { expect, test, type Page } from "@playwright/test";
import { enterReadyShell } from "./support/shell.ts";
import { TINY_PHOTO_PATH } from "./support/fixtures.ts";

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

async function configureProvider(
  page: Page,
  { linkEnabled = false, toolServerUrl }: { linkEnabled?: boolean; toolServerUrl?: string } = {},
): Promise<void> {
  const nav = page.getByRole("navigation", { name: "Primary" });
  await nav.getByRole("link", { name: "Settings" }).click();
  await page.getByLabel("The address to send recipes to").fill(MOCK_BASE_URL);
  await page.getByLabel("The password for that address").fill("test-key");
  if (linkEnabled) {
    await page.getByLabel("This address can open a web link, not just read pasted text").check();
  }
  if (toolServerUrl !== undefined) {
    await page.getByLabel("The address of your own web-reading helper (optional)").fill(toolServerUrl);
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
          // Stashed for tests that need to see which tool shape was actually
          // sent (e.g. the MCP tool-server shape) — read back afterwards via
          // page.evaluate, never inspected mid-flight.
          (window as unknown as { __lastResponsesRequestBody?: unknown }).__lastResponsesRequestBody = init?.body
            ? JSON.parse(init.body as string)
            : undefined;
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

/**
 * Tolerant parsing (owner's 2026-08-25 report): a real, owner-run link
 * import against OpenRouter (`gpt-4o-mini`, `/v1/responses`, `strict: true`
 * requested and ignored) came back HTTP 200 with this exact reply — fenced
 * in ```json, `title` instead of `name`, `steps` as plain strings, two units
 * outside our enum, and a `null` note. Reproduced here verbatim (fence and
 * all) as the review screen actually has to handle it: import succeeds,
 * lands on a sensible draft, and every fix made is visible on screen rather
 * than silent.
 */
const OWNER_OPENROUTER_REPLY_TEXT =
  "```json\n" +
  JSON.stringify(
    {
      isRecipe: true,
      title: "Pasta alla Norma",
      servings: 6,
      ingredients: [
        { name: "sedanini", amount: 500, unit: "g", note: null },
        { name: "eggplant", amount: 1, unit: null, note: "violetta, di Vittoria" },
        { name: "garlic", amount: 4, unit: "cloves", note: null },
        { name: "basil", amount: 1, unit: "bunch", note: null },
      ],
      steps: ["Wash and dry the eggplant, cut it into slices…", "In the meantime, prepare the tomatoes…"],
    },
    null,
    2,
  ) +
  "\n```";

test("the owner's real fenced, schema-diverging OpenRouter reply still imports, landing on a sensible draft with every fix visible", async ({ page }) => {
  await mockRecipeReaderResponsesFetch(page, 200, { status: "completed", output_text: OWNER_OPENROUTER_REPLY_TEXT });
  await enterReadyShell(page);
  await configureProvider(page, { linkEnabled: true });

  await page.getByLabel("Or, the web address to read this recipe from").fill("https://ricette.giallozafferano.it/Pasta-alla-Norma.html");
  await page.getByRole("button", { name: "Read this recipe" }).click();

  await expect(page).toHaveURL(/\/recipes\/new$/);
  await expect(page.getByRole("heading", { name: "Add recipe" })).toBeVisible();
  await expect(page.getByLabel("Name")).toHaveValue("Pasta alla Norma");
  await expect(page.getByRole("textbox", { name: "Servings" })).toHaveValue("6");

  // Every coercion made is shown, plainly, never behind a disclosure.
  await expect(page.getByText("Feeder had to fix up this reply")).toBeVisible();
  await expect(page.getByText(/code fence/i)).toBeVisible();
  await expect(page.getByText(/"title"/)).toBeVisible();
  await expect(page.getByText(/plain lines of text/i)).toBeVisible();
  // Two out-of-enum units in this reply ("cloves", "bunch") — plural phrasing.
  await expect(page.getByText(/2 ingredient units weren.t one Feeder recognises/i)).toBeVisible();

  // Garlic: the seeded catalogue already has a "garlic" ingredient, so this
  // line matches confidently — but the unrepresentable unit ("cloves") must
  // still be visible, not silently dropped just because the line matched.
  await expect(page.getByText('Imported note: "cloves"')).toBeVisible();
});

test("the tool-server field is only offered once the link toggle is on, and stays out of sight otherwise", async ({ page }) => {
  await enterReadyShell(page);
  await configureProvider(page, { linkEnabled: false });
  const nav = page.getByRole("navigation", { name: "Primary" });
  await nav.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByLabel("The address of your own web-reading helper (optional)")).toHaveCount(0);
});

test("filling in the tool-server address sends the MCP shape, requesting 'open' but never naming MCP on screen", async ({ page }) => {
  await mockRecipeReaderResponsesFetch(page, 200, VALID_RESPONSES_BODY);
  await enterReadyShell(page);
  await configureProvider(page, { linkEnabled: true, toolServerUrl: "https://mock-tool-server.test/web" });

  // The field's own label/hint never say "MCP" or "tool server" — a cook shouldn't have to know either term.
  await expect(page.getByText(/mcp/i)).toHaveCount(0);
  await expect(page.getByText(/tool server/i)).toHaveCount(0);

  await page.getByLabel("Or, the web address to read this recipe from").fill("https://example.com/garlic-rice");
  await page.getByRole("button", { name: "Read this recipe" }).click();
  await expect(page).toHaveURL(/\/recipes\/new$/);

  const sentBody = await page.evaluate(() => (window as unknown as { __lastResponsesRequestBody?: unknown }).__lastResponsesRequestBody);
  expect(sentBody).toMatchObject({
    tools: [
      {
        type: "mcp",
        server_label: "web_search_preview",
        server_url: "https://mock-tool-server.test/web",
        allowed_tools: ["open"],
      },
    ],
  });
});

test("a wrongly-filled-in tool-server address still surfaces the plain-language tool-unsupported message", async ({ page }) => {
  await mockRecipeReaderResponsesFetch(page, 400, { error: { message: "mcp server_url could not be reached" } });
  await enterReadyShell(page);
  await configureProvider(page, { linkEnabled: true, toolServerUrl: "https://wrong-address.test" });

  await page.getByLabel("Or, the web address to read this recipe from").fill("https://example.com/garlic-rice");
  await page.getByRole("button", { name: "Read this recipe" }).click();

  await expect(page.getByText(/doesn't seem to support reading a recipe straight from a link/i)).toBeVisible();
});

/**
 * Recipe import from a photo (DESIGN_RECIPE_IMPORT_PHOTO.md, "Decisions"
 * appended to DESIGN_RECIPE_IMPORT.md). Faked the same way as the text/link
 * paths above — an in-page `fetch` override — since a photo import also
 * posts to `{baseUrl}/chat/completions`, `mockRecipeReaderFetch` above
 * already answers it with the same Chat-Completions response shape.
 */
async function switchToPhotoMode(page: Page): Promise<void> {
  await page.getByRole("radio", { name: "From a photo" }).click();
}

/** Captures the last request body sent to `{baseUrl}/chat/completions` — read back afterwards via `page.evaluate`, mirroring `mockRecipeReaderResponsesFetch`'s own `__lastResponsesRequestBody` pattern above. */
async function mockRecipeReaderFetchCapturingBody(page: Page, status: number, body: unknown): Promise<void> {
  await page.addInitScript(
    ([baseUrl, responseStatus, responseBody]) => {
      const realFetch = window.fetch.bind(window);
      window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.startsWith(baseUrl as string)) {
          (window as unknown as { __lastChatRequestBody?: unknown }).__lastChatRequestBody = init?.body
            ? JSON.parse(init.body as string)
            : undefined;
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

test("the capture screen shows the handwriting expectation and names the configured address before any photo is added", async ({ page }) => {
  await enterReadyShell(page);
  await configureProvider(page);
  await switchToPhotoMode(page);

  await expect(page.getByText(/works best on printed recipes/i)).toBeVisible();
  await expect(page.getByText(/can struggle with faded or cramped handwriting/i)).toBeVisible();
  // The disclosure names the actual configured address, not an abstract description.
  await expect(page.getByText(MOCK_BASE_URL)).toBeVisible();
});

test("adding two photos and reading the recipe sends both as separate image parts in one request, and the review screen shows the photo(s) beside the ingredients", async ({
  page,
}) => {
  await mockRecipeReaderFetchCapturingBody(page, 200, VALID_RESPONSE_BODY);
  await enterReadyShell(page);
  await configureProvider(page);
  await switchToPhotoMode(page);

  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles(TINY_PHOTO_PATH);
  await expect(page.getByRole("button", { name: "Remove page 1" })).toBeVisible();
  await page.getByRole("button", { name: "+ Add another page" }).click();
  await fileInput.setInputFiles(TINY_PHOTO_PATH);
  await expect(page.getByRole("button", { name: "Remove page 2" })).toBeVisible();

  await page.getByRole("button", { name: "Read this recipe" }).click();

  await expect(page).toHaveURL(/\/recipes\/new$/);
  await expect(page.getByRole("heading", { name: "Add recipe" })).toBeVisible();
  await expect(page.getByLabel("Name")).toHaveValue("Garlic Rice");
  // The review screen's own photo gallery, right beside the ingredients.
  await expect(page.getByText("Check the amounts below against the photo.")).toBeVisible();
  await expect(page.getByText("Matched from import")).toBeVisible();

  const sentBody = await page.evaluate(() => (window as unknown as { __lastChatRequestBody?: unknown }).__lastChatRequestBody);
  const userContent = (
    sentBody as { messages: { role: string; content: { type: string }[] }[] }
  ).messages[1]!.content;
  expect(userContent).toHaveLength(3); // one text part + two image parts, one request
  expect(userContent.filter((part) => part.type === "image_url")).toHaveLength(2);
});

test("photos cap at 3 — the add button disables once a third page is added", async ({ page }) => {
  await enterReadyShell(page);
  await configureProvider(page);
  await switchToPhotoMode(page);
  const fileInput = page.locator('input[type="file"]');
  for (let i = 0; i < 3; i += 1) {
    await fileInput.setInputFiles(TINY_PHOTO_PATH);
  }
  await expect(page.getByRole("button", { name: "Remove page 3" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Up to 3 pages" })).toBeDisabled();
});

test("a poor-quality photo shows an inline advisory, but never blocks sending", async ({ page }) => {
  await mockRecipeReaderFetch(page, 200, VALID_RESPONSE_BODY);
  await enterReadyShell(page);
  await configureProvider(page);
  await switchToPhotoMode(page);

  // The 1x1 fixture reads as flat/washed to the client-side heuristic —
  // exactly the "never block sending" case the advisory is for.
  await page.locator('input[type="file"]').setInputFiles(TINY_PHOTO_PATH);
  await expect(page.getByText(/you can try again, or send it anyway/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Read this recipe" })).toBeEnabled();
});

test("a photo import made while offline queues instead of failing, then fires automatically once back online and lands on the review screen", async ({
  page,
  context,
}) => {
  await mockRecipeReaderFetch(page, 200, VALID_RESPONSE_BODY);
  await enterReadyShell(page);
  await configureProvider(page);
  await switchToPhotoMode(page);
  await page.locator('input[type="file"]').setInputFiles(TINY_PHOTO_PATH);

  await context.setOffline(true);
  await page.getByRole("button", { name: "Read this recipe" }).click();
  await expect(page.getByText(/this will try again once you.re back online/i)).toBeVisible();

  await context.setOffline(false);
  await expect(page).toHaveURL(/\/recipes\/new$/, { timeout: 15_000 });
  await expect(page.getByLabel("Name")).toHaveValue("Garlic Rice");
});

test("photo mode's own copy never uses jargon", async ({ page }) => {
  await enterReadyShell(page);
  await configureProvider(page);
  await switchToPhotoMode(page);
  for (const jargon of ["endpoint", "token", "schema", "API", "vision"]) {
    await expect(page.getByText(jargon, { exact: false })).toHaveCount(0);
  }
});

/**
 * Diagnostics (owner's 2026-08-25 report): progress while a request is in
 * flight, and a "Show details" disclosure once a request fails — the plain
 * headline stays the only thing visible by default, so the whole-page
 * jargon sweeps above (lines ~223, ~412) still pass unmodified: the
 * disclosure's own body simply never mounts until a household taps it open.
 */
async function mockRecipeReaderFetchDelayed(page: Page, status: number, body: unknown, delayMs: number): Promise<void> {
  await page.addInitScript(
    ([baseUrl, responseStatus, responseBody, delay]) => {
      const realFetch = window.fetch.bind(window);
      window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.startsWith(baseUrl as string)) {
          await new Promise((resolve) => setTimeout(resolve, delay as number));
          return new Response(JSON.stringify(responseBody), {
            status: responseStatus as number,
            headers: { "Content-Type": "application/json" },
          });
        }
        return realFetch(input, init);
      };
    },
    [MOCK_BASE_URL, status, body, delayMs],
  );
}

test("shows live progress with an elapsed time while a request is in flight", async ({ page }) => {
  await mockRecipeReaderFetchDelayed(page, 200, VALID_RESPONSE_BODY, 2000);
  await enterReadyShell(page);
  await configureProvider(page);

  await page.getByLabel("Paste the recipe here").fill("Garlic Rice\n2 cloves garlic\nCook the rice with garlic.");
  await page.getByRole("button", { name: "Read this recipe" }).click();

  await expect(page.getByText(/Waiting for a reply…/)).toBeVisible();
  await expect(page).toHaveURL(/\/recipes\/new$/);
});

test("a failure offers 'Show details', collapsed by default, revealing the address, status, cause and a copy action — never the password", async ({
  page,
}) => {
  await mockRecipeReaderFetch(page, 500, "server exploded");
  await enterReadyShell(page);
  await configureProvider(page);

  await page.getByLabel("Paste the recipe here").fill("Anything at all.");
  await page.getByRole("button", { name: "Read this recipe" }).click();
  await expect(page.getByRole("button", { name: "Show details" })).toBeVisible();

  // Collapsed by default — none of the diagnostic vocabulary is visible yet.
  await expect(page.getByText(MOCK_BASE_URL)).toHaveCount(0);
  await expect(page.getByText("test-key")).toHaveCount(0);

  await page.getByRole("button", { name: "Show details" }).click();
  await expect(page.getByText(MOCK_BASE_URL, { exact: false })).toBeVisible();
  await expect(page.getByText(/status 500/i)).toBeVisible();
  await expect(page.getByText(/unexpected status/i)).toBeVisible();
  // The password/API key never appears anywhere on the page, expanded or not.
  await expect(page.getByText("test-key")).toHaveCount(0);
  await expect(page.getByText("[redacted]", { exact: false })).toBeVisible();

  await expect(page.getByRole("button", { name: "Copy to clipboard" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Clear this history" })).toBeVisible();
});

test("distinguishes a not-valid-JSON reply from a valid-but-empty-ingredients reply in the diagnostic panel", async ({ page }) => {
  await mockRecipeReaderFetch(page, 200, { choices: [{ message: { content: "Sorry, I can't help with that." } }] });
  await enterReadyShell(page);
  await configureProvider(page);

  await page.getByLabel("Paste the recipe here").fill("Something.");
  await page.getByRole("button", { name: "Read this recipe" }).click();
  await page.getByRole("button", { name: "Show details" }).click();
  await expect(page.getByText(/prose instead of the structured reply/i)).toBeVisible();
});

test("clearing the history removes the disclosure entirely", async ({ page }) => {
  await mockRecipeReaderFetch(page, 500, "boom");
  await enterReadyShell(page);
  await configureProvider(page);

  await page.getByLabel("Paste the recipe here").fill("Anything.");
  await page.getByRole("button", { name: "Read this recipe" }).click();
  await page.getByRole("button", { name: "Show details" }).click();
  await page.getByRole("button", { name: "Clear this history" }).click();
  await expect(page.getByRole("button", { name: "Show details" })).toHaveCount(0);
});
