import { describe, expect, it, vi } from "vitest";
import { RecipeImportError, importRecipeFromLink, importRecipeFromPhotos, importRecipeFromText } from "./client.ts";
import type { ImportFailureCause, ImportProgressStage } from "./diagnostics.ts";

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), { status: 200, ...init, headers: { "Content-Type": "application/json" } });
}

const VALID_DRAFT_CONTENT = JSON.stringify({
  isRecipe: true,
  name: "Garlic Rice",
  servings: 4,
  prepMinutes: 5,
  cookMinutes: 20,
  ingredients: [{ name: "garlic", amount: 2, unit: "piece", note: "" }],
  steps: [{ description: "Cook it." }],
});

const PARAMS = { baseUrl: "https://api.example.com/v1", apiKey: "sk-test", model: "gpt-4o-mini", pastedText: "Garlic Rice\n2 cloves garlic\nCook it." };

describe("importRecipeFromText", () => {
  it("parses and validates a well-formed Chat Completions response", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ choices: [{ message: { content: VALID_DRAFT_CONTENT } }] }));
    const draft = await importRecipeFromText(PARAMS, fetchImpl);
    expect(draft.name).toBe("Garlic Rice");
    expect(draft.ingredients).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.example.com/v1/chat/completions");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer sk-test" });
  });

  it("throws unauthorized on a 401", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("", { status: 401 }));
    await expect(importRecipeFromText(PARAMS, fetchImpl)).rejects.toMatchObject({
      reason: "unauthorized",
    });
  });

  it("throws rate-limited on a 429", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("", { status: 429 }));
    await expect(importRecipeFromText(PARAMS, fetchImpl)).rejects.toMatchObject({
      reason: "rate-limited",
    });
  });

  it("throws network on a transport failure", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(importRecipeFromText(PARAMS, fetchImpl)).rejects.toMatchObject({
      reason: "network",
    });
  });

  it("throws invalid-response when the model's JSON fails schema validation", async () => {
    const badContent = JSON.stringify({ isRecipe: true, name: "X", servings: null, prepMinutes: null, cookMinutes: null, ingredients: [{ name: "x", amount: "lots", unit: null, note: "" }], steps: [] });
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ choices: [{ message: { content: badContent } }] }));
    await expect(importRecipeFromText(PARAMS, fetchImpl)).rejects.toBeInstanceOf(RecipeImportError);
    await expect(importRecipeFromText(PARAMS, fetchImpl)).rejects.toMatchObject({
      reason: "invalid-response",
    });
  });

  it("throws invalid-response when isRecipe is false", async () => {
    const content = JSON.stringify({ isRecipe: false, name: "", servings: null, prepMinutes: null, cookMinutes: null, ingredients: [], steps: [] });
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ choices: [{ message: { content } }] }));
    await expect(importRecipeFromText(PARAMS, fetchImpl)).rejects.toMatchObject({
      reason: "invalid-response",
      message: expect.stringContaining("doesn't look like a recipe"),
    });
  });

  it("throws invalid-response when the response has no usable content at all", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ choices: [] }));
    await expect(importRecipeFromText(PARAMS, fetchImpl)).rejects.toMatchObject({
      reason: "invalid-response",
    });
  });

  it("sends the source URL as a labelled line, never as a fetch target", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ choices: [{ message: { content: VALID_DRAFT_CONTENT } }] }));
    await importRecipeFromText({ ...PARAMS, sourceUrl: "https://example.com/recipe" }, fetchImpl);
    const [, init] = fetchImpl.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string) as { messages: { role: string; content: string }[] };
    expect(body.messages[1]!.content).toContain("https://example.com/recipe");
    // Only one request was ever made — the app never fetches the URL itself.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

const PHOTO_PARAMS = {
  baseUrl: "https://api.example.com/v1",
  apiKey: "sk-test",
  model: "gpt-4o-mini",
  photos: ["data:image/jpeg;base64,AAA", "data:image/jpeg;base64,BBB"],
};

describe("importRecipeFromPhotos", () => {
  it("posts to {baseUrl}/chat/completions with one image_url part per photo plus a text part, and validates the response", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ choices: [{ message: { content: VALID_DRAFT_CONTENT } }] }));
    const draft = await importRecipeFromPhotos(PHOTO_PARAMS, fetchImpl);
    expect(draft.name).toBe("Garlic Rice");
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.example.com/v1/chat/completions");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer sk-test" });
    const body = JSON.parse((init as RequestInit).body as string) as {
      messages: { role: string; content: unknown }[];
      response_format: { type: string; json_schema: { strict: boolean } };
    };
    const userContent = body.messages[1]!.content as { type: string; text?: string; image_url?: { url: string; detail: string } }[];
    expect(userContent[0]).toEqual({ type: "text", text: "Transcribe this recipe." });
    expect(userContent.slice(1)).toEqual([
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,AAA", detail: "high" } },
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,BBB", detail: "high" } },
    ]);
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.strict).toBe(true);
    // One request only, even with multiple photos — multi-page is several images in one request, not several requests.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("works with a single photo too", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ choices: [{ message: { content: VALID_DRAFT_CONTENT } }] }));
    await importRecipeFromPhotos({ ...PHOTO_PARAMS, photos: ["data:image/jpeg;base64,ONLY"] }, fetchImpl);
    const [, init] = fetchImpl.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string) as { messages: { content: unknown }[] };
    const userContent = body.messages[1]!.content as unknown[];
    expect(userContent).toHaveLength(2); // one text part + one image part
  });

  it("throws unauthorized on a 401, same as the text path", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("", { status: 401 }));
    await expect(importRecipeFromPhotos(PHOTO_PARAMS, fetchImpl)).rejects.toMatchObject({ reason: "unauthorized" });
  });

  it("throws rate-limited on a 429", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("", { status: 429 }));
    await expect(importRecipeFromPhotos(PHOTO_PARAMS, fetchImpl)).rejects.toMatchObject({ reason: "rate-limited" });
  });

  it("throws network on a transport failure", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(importRecipeFromPhotos(PHOTO_PARAMS, fetchImpl)).rejects.toMatchObject({ reason: "network" });
  });

  it("throws invalid-response when the model's JSON fails schema validation", async () => {
    const badContent = JSON.stringify({ isRecipe: true, name: "X", servings: null, prepMinutes: null, cookMinutes: null, ingredients: [{ name: "x", amount: "lots", unit: null, note: "" }], steps: [] });
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ choices: [{ message: { content: badContent } }] }));
    await expect(importRecipeFromPhotos(PHOTO_PARAMS, fetchImpl)).rejects.toMatchObject({ reason: "invalid-response" });
  });

  it("throws invalid-response when isRecipe is false — the photo wasn't a recipe", async () => {
    const content = JSON.stringify({ isRecipe: false, name: "", servings: null, prepMinutes: null, cookMinutes: null, ingredients: [], steps: [] });
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ choices: [{ message: { content } }] }));
    await expect(importRecipeFromPhotos(PHOTO_PARAMS, fetchImpl)).rejects.toMatchObject({
      reason: "invalid-response",
      message: expect.stringContaining("doesn't look like a recipe"),
    });
  });

  it("never mentions jargon in its own error copy", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("", { status: 401 }));
    await expect(importRecipeFromPhotos(PHOTO_PARAMS, fetchImpl)).rejects.toMatchObject({
      message: expect.not.stringMatching(/endpoint|token|schema|vision|\bAPI\b/i),
    });
  });
});

const LINK_PARAMS = { baseUrl: "https://api.example.com/v1", apiKey: "sk-test", model: "gpt-4o-mini", url: "https://example.com/garlic-rice" };

describe("importRecipeFromLink", () => {
  it("posts to {baseUrl}/responses, carrying the URL and the browser tool, and validates a top-level output_text", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ status: "completed", output_text: VALID_DRAFT_CONTENT, output: [] }));
    const draft = await importRecipeFromLink(LINK_PARAMS, fetchImpl);
    expect(draft.name).toBe("Garlic Rice");
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.example.com/v1/responses");
    const body = JSON.parse((init as RequestInit).body as string) as {
      input: { role: string; content: string }[];
      tools: { type: string }[];
      text: { format: { type: string; strict: boolean } };
    };
    expect(body.input[1]!.content).toContain(LINK_PARAMS.url);
    expect(body.tools).toEqual([{ type: "web_search_preview" }]);
    expect(body.text.format.type).toBe("json_schema");
    expect(body.text.format.strict).toBe(true);
    // One request only — the household's own tap, no follow-up polling.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("sends the MCP tool-server shape, requesting 'open' but not 'search', when a tool-server address is configured", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ status: "completed", output_text: VALID_DRAFT_CONTENT }));
    await importRecipeFromLink({ ...LINK_PARAMS, toolServerUrl: "https://mock-vllm.test/tools/web" }, fetchImpl);
    const [, init] = fetchImpl.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string) as {
      tools: { type: string; server_label?: string; server_url?: string; allowed_tools?: string[] }[];
    };
    expect(body.tools).toEqual([
      { type: "mcp", server_label: "web_search_preview", server_url: "https://mock-vllm.test/tools/web", allowed_tools: ["open"] },
    ]);
    expect(body.tools[0]!.allowed_tools).not.toContain("search");
  });

  it("falls back to scanning output[] for an output_text content item when there's no top-level output_text", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        status: "completed",
        output: [
          { type: "web_search_call", id: "ws_1", status: "completed" },
          { type: "message", role: "assistant", content: [{ type: "output_text", text: VALID_DRAFT_CONTENT }] },
        ],
      }),
    );
    const draft = await importRecipeFromLink(LINK_PARAMS, fetchImpl);
    expect(draft.name).toBe("Garlic Rice");
  });

  it("throws tool-unsupported when a misconfigured tool-server address is rejected as an unrecognised MCP server", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ error: { message: "mcp server_url could not be reached" } }), { status: 400 }),
    );
    await expect(importRecipeFromLink({ ...LINK_PARAMS, toolServerUrl: "https://wrong.test" }, fetchImpl)).rejects.toMatchObject({
      reason: "tool-unsupported",
    });
  });

  it("throws tool-unsupported, in plain language, when the endpoint rejects the browser tool", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ error: { message: "Unknown tool type 'web_search_preview'" } }), { status: 400 }),
    );
    await expect(importRecipeFromLink(LINK_PARAMS, fetchImpl)).rejects.toMatchObject({ reason: "tool-unsupported" });
    await expect(importRecipeFromLink(LINK_PARAMS, fetchImpl)).rejects.toMatchObject({
      message: expect.not.stringMatching(/endpoint|token|schema|\bAPI\b/i),
    });
  });

  it("throws tool-unsupported when the address has no /responses route at all (a plain Chat Completions server)", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("Not Found", { status: 404 }));
    await expect(importRecipeFromLink(LINK_PARAMS, fetchImpl)).rejects.toMatchObject({ reason: "tool-unsupported" });
  });

  it("throws tool-unsupported when a 200 response itself carries an error naming the tool", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ status: "failed", error: { message: "web_search tool is not enabled for this deployment" } }));
    await expect(importRecipeFromLink(LINK_PARAMS, fetchImpl)).rejects.toMatchObject({ reason: "tool-unsupported" });
  });

  it("throws invalid-response when the fetched page turns out not to be a recipe at all", async () => {
    const content = JSON.stringify({ isRecipe: false, name: "", servings: null, prepMinutes: null, cookMinutes: null, ingredients: [], steps: [] });
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ status: "completed", output_text: content }));
    await expect(importRecipeFromLink(LINK_PARAMS, fetchImpl)).rejects.toMatchObject({
      reason: "invalid-response",
      message: expect.stringContaining("doesn't look like a recipe"),
    });
  });

  it("throws invalid-response when the response fails schema validation", async () => {
    const badContent = JSON.stringify({ isRecipe: true, name: "X", servings: null, prepMinutes: null, cookMinutes: null, ingredients: [{ name: "x", amount: "lots", unit: null, note: "" }], steps: [] });
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ status: "completed", output_text: badContent }));
    await expect(importRecipeFromLink(LINK_PARAMS, fetchImpl)).rejects.toMatchObject({ reason: "invalid-response" });
  });

  it("throws unauthorized on a 401, and rate-limited on a 429, same as the text path", async () => {
    const unauthorized = vi.fn<typeof fetch>(async () => new Response("", { status: 401 }));
    await expect(importRecipeFromLink(LINK_PARAMS, unauthorized)).rejects.toMatchObject({ reason: "unauthorized" });
    const rateLimited = vi.fn<typeof fetch>(async () => new Response("", { status: 429 }));
    await expect(importRecipeFromLink(LINK_PARAMS, rateLimited)).rejects.toMatchObject({ reason: "rate-limited" });
  });
});

/**
 * Diagnostics (owner's 2026-08-25 report): the six previously-identical
 * "couldn't make sense of what came back" throw sites must now each carry a
 * distinguishable `diagnostic.cause`, the key must never appear in one under
 * any failure path, and a photo import's diagnostic must never carry a raw
 * base64 payload. These pin the invariants the owner's brief calls out by
 * name, on top of the behavioural tests above.
 */
describe("RecipeImportError diagnostics", () => {
  async function causeOf(promise: Promise<unknown>): Promise<ImportFailureCause | undefined> {
    try {
      await promise;
      throw new Error("expected the import to reject");
    } catch (err) {
      expect(err).toBeInstanceOf(RecipeImportError);
      return (err as RecipeImportError).diagnostic?.cause;
    }
  }

  it("tells apart all six previously-collapsed causes", async () => {
    const unparseableBody = vi.fn<typeof fetch>(async () => new Response("not json at all {{{", { status: 200, headers: { "Content-Type": "application/json" } }));
    expect(await causeOf(importRecipeFromText(PARAMS, unparseableBody))).toBe("unparseable-body");

    const missingContent = vi.fn<typeof fetch>(async () => jsonResponse({ choices: [] }));
    expect(await causeOf(importRecipeFromText(PARAMS, missingContent))).toBe("missing-content");

    const contentNotJson = vi.fn<typeof fetch>(async () => jsonResponse({ choices: [{ message: { content: "Sorry, I can't help with that." } }] }));
    expect(await causeOf(importRecipeFromText(PARAMS, contentNotJson))).toBe("content-not-json");

    const schemaMismatchContent = JSON.stringify({
      isRecipe: true,
      name: "X",
      servings: null,
      prepMinutes: null,
      cookMinutes: null,
      ingredients: [{ name: "x", amount: "lots", unit: null, note: "" }],
      steps: [],
    });
    const schemaMismatch = vi.fn<typeof fetch>(async () => jsonResponse({ choices: [{ message: { content: schemaMismatchContent } }] }));
    expect(await causeOf(importRecipeFromText(PARAMS, schemaMismatch))).toBe("schema-mismatch");

    const noIngredientsContent = JSON.stringify({
      isRecipe: true,
      name: "Garlic Rice",
      servings: null,
      prepMinutes: null,
      cookMinutes: null,
      ingredients: [],
      steps: [{ description: "Cook it." }],
    });
    const noIngredients = vi.fn<typeof fetch>(async () => jsonResponse({ choices: [{ message: { content: noIngredientsContent } }] }));
    expect(await causeOf(importRecipeFromText(PARAMS, noIngredients))).toBe("no-ingredients");

    const badStatus = vi.fn<typeof fetch>(async () => new Response("internal error", { status: 500 }));
    expect(await causeOf(importRecipeFromText(PARAMS, badStatus))).toBe("bad-status");
  });

  it("never leaks the API key into a diagnostic, on any failure path", async () => {
    const secretParams = { ...PARAMS, apiKey: "sk-this-must-never-appear-anywhere" };
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("boom", { status: 500 }));
    try {
      await importRecipeFromText(secretParams, fetchImpl);
      throw new Error("expected rejection");
    } catch (err) {
      const diagnostic = (err as RecipeImportError).diagnostic;
      expect(diagnostic).toBeDefined();
      const serialized = JSON.stringify(diagnostic);
      expect(serialized).not.toContain("sk-this-must-never-appear-anywhere");
      expect(diagnostic!.request.headers.Authorization).toBe("[redacted]");
    }
  });

  it("attaches a diagnostic with the HTTP status, response body preview, and elapsed time for a bad-status failure", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("server on fire", { status: 500, statusText: "Internal Server Error" }));
    try {
      await importRecipeFromText(PARAMS, fetchImpl);
      throw new Error("expected rejection");
    } catch (err) {
      const diagnostic = (err as RecipeImportError).diagnostic!;
      expect(diagnostic.httpStatus).toBe(500);
      expect(diagnostic.responseBodyPreview).toContain("server on fire");
      expect(diagnostic.elapsedMs).toBeGreaterThanOrEqual(0);
      expect(diagnostic.request.url).toBe("https://api.example.com/v1/chat/completions");
      expect(diagnostic.request.model).toBe("gpt-4o-mini");
    }
  });

  it("carries structured field/expected/received detail for a schema-mismatch failure", async () => {
    const badContent = JSON.stringify({
      isRecipe: true,
      name: "X",
      servings: "a lot",
      prepMinutes: null,
      cookMinutes: null,
      ingredients: [{ name: "garlic", amount: 1, unit: "piece", note: "" }],
      steps: [{ description: "Cook it." }],
    });
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ choices: [{ message: { content: badContent } }] }));
    try {
      await importRecipeFromText(PARAMS, fetchImpl);
      throw new Error("expected rejection");
    } catch (err) {
      const diagnostic = (err as RecipeImportError).diagnostic!;
      expect(diagnostic.validation).toMatchObject({ field: "servings", expected: expect.stringContaining("number"), received: expect.stringContaining("a lot") });
    }
  });

  it("never carries a raw base64 image payload in a photo import's diagnostic, and stays a sane size", async () => {
    const hugeFakeJpeg = `data:image/jpeg;base64,${"A".repeat(400_000)}`;
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("nope", { status: 500 }));
    try {
      await importRecipeFromPhotos({ ...PHOTO_PARAMS, photos: [hugeFakeJpeg, hugeFakeJpeg, hugeFakeJpeg] }, fetchImpl);
      throw new Error("expected rejection");
    } catch (err) {
      const diagnostic = (err as RecipeImportError).diagnostic!;
      const serialized = JSON.stringify(diagnostic);
      expect(serialized).not.toContain("A".repeat(1000));
      // Three ~300KB photos would be roughly a megabyte raw; the diagnostic must stay tiny.
      expect(serialized.length).toBeLessThan(5000);
    }
  });

  it("reports sending/waiting/reading/checking progress, in order, with non-decreasing elapsed time", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ choices: [{ message: { content: VALID_DRAFT_CONTENT } }] }));
    const stages: ImportProgressStage[] = [];
    let lastElapsed = -1;
    await importRecipeFromText(PARAMS, fetchImpl, (stage, elapsedMs) => {
      stages.push(stage);
      expect(elapsedMs).toBeGreaterThanOrEqual(lastElapsed);
      lastElapsed = elapsedMs;
    });
    expect(stages).toEqual(["sending", "waiting", "reading", "checking"]);
  });
});
