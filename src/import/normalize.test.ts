import { describe, expect, it } from "vitest";
import { normalizeRecipeImportPayload, stripJsonFence } from "./normalize.ts";
import { validateRecipeImportResponse } from "./match.ts";

const BASE_RECIPE = {
  isRecipe: true,
  name: "Garlic Rice",
  servings: 4,
  prepMinutes: 5,
  cookMinutes: 20,
  ingredients: [{ name: "garlic", amount: 2, unit: "piece", note: "" }],
  steps: [{ description: "Cook it." }],
};

/** `BASE_RECIPE` with `name` dropped and `title` substituted — the shape a "title" alias test needs. */
function withoutName(base: typeof BASE_RECIPE, title: string): Record<string, unknown> {
  const clone: Record<string, unknown> = { ...base };
  delete clone.name;
  clone.title = title;
  return clone;
}

describe("stripJsonFence", () => {
  it("leaves already-valid JSON untouched, reporting no fence stripped", () => {
    const text = JSON.stringify(BASE_RECIPE);
    const result = stripJsonFence(text);
    expect(result.fenceStripped).toBe(false);
    expect(JSON.parse(result.text)).toEqual(BASE_RECIPE);
  });

  it("strips a ```json fence", () => {
    const fenced = "```json\n" + JSON.stringify(BASE_RECIPE) + "\n```";
    const result = stripJsonFence(fenced);
    expect(result.fenceStripped).toBe(true);
    expect(JSON.parse(result.text)).toEqual(BASE_RECIPE);
  });

  it("strips a bare ``` fence with no language tag", () => {
    const fenced = "```\n" + JSON.stringify(BASE_RECIPE) + "\n```";
    const result = stripJsonFence(fenced);
    expect(result.fenceStripped).toBe(true);
    expect(JSON.parse(result.text)).toEqual(BASE_RECIPE);
  });

  it("extracts the first balanced JSON object out of surrounding prose with no fence at all", () => {
    const withProse = `Here's the recipe:\n${JSON.stringify(BASE_RECIPE)}\nHope that helps!`;
    const result = stripJsonFence(withProse);
    expect(result.fenceStripped).toBe(true);
    expect(JSON.parse(result.text)).toEqual(BASE_RECIPE);
  });

  it("does not fabricate JSON out of a reply that genuinely isn't JSON at all", () => {
    const prose = "Sorry, I can't help with that.";
    const result = stripJsonFence(prose);
    expect(result.fenceStripped).toBe(false);
    expect(result.text).toBe(prose);
    expect(() => JSON.parse(result.text)).toThrow();
  });

  it("doesn't get confused by a brace inside a quoted string", () => {
    const withBraceInString = JSON.stringify({ ...BASE_RECIPE, name: "A {weird} name" });
    const fenced = "```json\n" + withBraceInString + "\n```";
    const result = stripJsonFence(fenced);
    expect(JSON.parse(result.text)).toMatchObject({ name: "A {weird} name" });
  });
});

describe("normalizeRecipeImportPayload", () => {
  it("makes no changes, and reports no coercions, for an already-conformant payload", () => {
    const { value, coercions } = normalizeRecipeImportPayload(BASE_RECIPE);
    expect(coercions).toEqual([]);
    expect(value).toEqual(BASE_RECIPE);
  });

  it("aliases title to name when name is missing", () => {
    const payload = withoutName(BASE_RECIPE, "Garlic Rice");
    const { value, coercions } = normalizeRecipeImportPayload(payload);
    expect((value as { name: string }).name).toBe("Garlic Rice");
    expect(coercions).toHaveLength(1);
    expect(coercions[0]).toMatch(/title/i);
  });

  it("does not let title override an already-present name", () => {
    const payload = { ...BASE_RECIPE, title: "Some Other Name" };
    const { value, coercions } = normalizeRecipeImportPayload(payload);
    expect((value as { name: string }).name).toBe("Garlic Rice");
    expect(coercions).toEqual([]);
  });

  it("wraps plain-string steps as { description }", () => {
    const payload = { ...BASE_RECIPE, steps: ["Wash the eggplant.", "Fry it."] };
    const { value, coercions } = normalizeRecipeImportPayload(payload);
    expect((value as { steps: unknown[] }).steps).toEqual([{ description: "Wash the eggplant." }, { description: "Fry it." }]);
    expect(coercions).toHaveLength(1);
    expect(coercions[0]).toMatch(/plain lines of text/i);
  });

  it("aliases an obvious step key (text/instruction/step) to description", () => {
    const payload = { ...BASE_RECIPE, steps: [{ text: "Wash the eggplant." }] };
    const { value, coercions } = normalizeRecipeImportPayload(payload);
    expect((value as { steps: { description: string }[] }).steps[0]!.description).toBe("Wash the eggplant.");
    expect(coercions).toHaveLength(1);
  });

  it("leaves a step already carrying description untouched", () => {
    const payload = { ...BASE_RECIPE, steps: [{ description: "Cook it.", extra: "kept" }] };
    const { value, coercions } = normalizeRecipeImportPayload(payload);
    expect(value).toMatchObject({ steps: [{ description: "Cook it.", extra: "kept" }] });
    expect(coercions).toEqual([]);
  });

  it("coerces a unit outside the enum to null, folding the original word into note", () => {
    const payload = {
      ...BASE_RECIPE,
      ingredients: [{ name: "garlic", amount: 4, unit: "cloves", note: null }],
    };
    const { value, coercions } = normalizeRecipeImportPayload(payload);
    const [line] = (value as { ingredients: { unit: unknown; note: unknown }[] }).ingredients;
    expect(line!.unit).toBeNull();
    expect(line!.note).toBe("cloves");
    expect(coercions.some((c) => /unit/i.test(c))).toBe(true);
  });

  it("appends an out-of-enum unit to an existing note rather than replacing it", () => {
    const payload = {
      ...BASE_RECIPE,
      ingredients: [{ name: "garlic", amount: 4, unit: "cloves", note: "minced" }],
    };
    const { value } = normalizeRecipeImportPayload(payload);
    const [line] = (value as { ingredients: { note: unknown }[] }).ingredients;
    expect(line!.note).toBe("minced (cloves)");
  });

  it("turns a null note into an empty string", () => {
    const payload = {
      ...BASE_RECIPE,
      ingredients: [{ name: "sedanini", amount: 500, unit: "g", note: null }],
    };
    const { value, coercions } = normalizeRecipeImportPayload(payload);
    const [line] = (value as { ingredients: { note: unknown }[] }).ingredients;
    expect(line!.note).toBe("");
    expect(coercions.some((c) => /note/i.test(c))).toBe(true);
  });

  it("leaves a recognised unit and a real note completely untouched", () => {
    const payload = {
      ...BASE_RECIPE,
      ingredients: [{ name: "eggplant", amount: 1, unit: null, note: "violetta, di Vittoria" }],
    };
    const { value, coercions } = normalizeRecipeImportPayload(payload);
    expect(value).toMatchObject({ ingredients: [{ unit: null, note: "violetta, di Vittoria" }] });
    expect(coercions).toEqual([]);
  });

  it("handles every divergence independently — each fires without the others being present", () => {
    // Only a unit divergence, nothing else wrong.
    const onlyUnit = normalizeRecipeImportPayload({
      ...BASE_RECIPE,
      ingredients: [{ name: "basil", amount: 1, unit: "bunch", note: "" }],
    });
    expect(onlyUnit.coercions).toHaveLength(1);
    expect(onlyUnit.coercions[0]).toMatch(/unit/i);

    // Only a steps-as-strings divergence.
    const onlySteps = normalizeRecipeImportPayload({ ...BASE_RECIPE, steps: ["Do the thing."] });
    expect(onlySteps.coercions).toHaveLength(1);
    expect(onlySteps.coercions[0]).toMatch(/plain lines/i);

    // Only a title alias.
    const onlyTitle = normalizeRecipeImportPayload(withoutName(BASE_RECIPE, "Garlic Rice"));
    expect(onlyTitle.coercions).toHaveLength(1);
    expect(onlyTitle.coercions[0]).toMatch(/title/i);
  });

  it("never invents an ingredient, step, or name that wasn't present — a genuinely empty/non-recipe payload still fails validation afterwards", () => {
    const notARecipe = { isRecipe: false, name: "", servings: null, prepMinutes: null, cookMinutes: null, ingredients: [], steps: [] };
    const { value } = normalizeRecipeImportPayload(notARecipe);
    const validation = validateRecipeImportResponse(value);
    expect(validation.ok).toBe(false);

    const emptyIngredients = { ...BASE_RECIPE, ingredients: [] };
    const { value: normalizedEmpty } = normalizeRecipeImportPayload(emptyIngredients);
    const emptyValidation = validateRecipeImportResponse(normalizedEmpty);
    expect(emptyValidation.ok).toBe(false);
    if (!emptyValidation.ok) expect(emptyValidation.reason).toMatch(/no ingredients/i);
  });

  it("leaves non-object payloads (arrays, primitives, null) completely alone", () => {
    expect(normalizeRecipeImportPayload(null)).toEqual({ value: null, coercions: [] });
    expect(normalizeRecipeImportPayload("prose")).toEqual({ value: "prose", coercions: [] });
    expect(normalizeRecipeImportPayload([1, 2, 3])).toEqual({ value: [1, 2, 3], coercions: [] });
  });

  it("reproduces the owner's real OpenRouter reply end to end: fence stripped, title aliased, steps unwrapped, both odd units kept as notes", () => {
    const ownerReply =
      "```json\n" +
      JSON.stringify({
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
      }) +
      "\n```";

    const { text, fenceStripped } = stripJsonFence(ownerReply);
    expect(fenceStripped).toBe(true);
    const rawParsed: unknown = JSON.parse(text);
    // The owner's transcript also has no prepMinutes/cookMinutes keys at
    // all (not even null) — a sixth, unnamed divergence from the same
    // real reply, handled the same conservative way as every other missing
    // field: folded to null, never guessed.
    const { value, coercions } = normalizeRecipeImportPayload(rawParsed);
    const fullCoercions = ["fence"].concat(coercions); // fence handled by stripJsonFence, not normalize itself

    const validation = validateRecipeImportResponse(value);
    expect(validation.ok).toBe(true);
    if (!validation.ok) return;
    expect(validation.draft.name).toBe("Pasta alla Norma");
    expect(validation.draft.servings).toBe(6);
    const garlic = validation.draft.ingredients.find((i) => i.name === "garlic");
    expect(garlic?.unit).toBeNull();
    expect(garlic?.note).toBe("cloves");
    expect(validation.draft.steps).toHaveLength(2);
    expect(fullCoercions.length).toBeGreaterThan(1); // fence + at least one shape coercion
  });
});
