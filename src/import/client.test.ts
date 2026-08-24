import { describe, expect, it, vi } from "vitest";
import { RecipeImportError, importRecipeFromText } from "./client.ts";

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
