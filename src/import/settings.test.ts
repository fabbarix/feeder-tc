import { beforeEach, describe, expect, it } from "vitest";
import { makeIsoDate } from "../domain/index.ts";
import {
  DEFAULT_RECIPE_IMPORT_SETTINGS,
  clearRecipeImportSettings,
  getImportUsage,
  isRecipeImportConfigured,
  readRecipeImportSettings,
  recordImportUsed,
  saveRecipeImportSettings,
  type RecipeImportSettings,
} from "./settings.ts";

const TODAY = makeIsoDate("2026-08-24");
const TOMORROW = makeIsoDate("2026-08-25");

describe("recipe import settings storage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("defaults to unconfigured, empty settings", () => {
    const settings = readRecipeImportSettings();
    expect(settings).toEqual(DEFAULT_RECIPE_IMPORT_SETTINGS);
    expect(isRecipeImportConfigured(settings)).toBe(false);
  });

  it("round-trips saved settings", () => {
    const settings: RecipeImportSettings = {
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
      model: "gpt-4o-mini",
      dailyLimit: 5,
      linkEnabled: true,
    };
    saveRecipeImportSettings(settings);
    expect(readRecipeImportSettings()).toEqual(settings);
    expect(isRecipeImportConfigured(readRecipeImportSettings())).toBe(true);
  });

  it("clear removes the saved settings entirely", () => {
    saveRecipeImportSettings({ baseUrl: "https://x", apiKey: "k", model: "m", dailyLimit: 3, linkEnabled: false });
    clearRecipeImportSettings();
    expect(readRecipeImportSettings()).toEqual(DEFAULT_RECIPE_IMPORT_SETTINGS);
  });

  it("degrades to defaults on a corrupted stored value, never throws", () => {
    window.localStorage.setItem("feeder.recipeImport.settings.v1", "{not json");
    expect(() => readRecipeImportSettings()).not.toThrow();
    expect(readRecipeImportSettings()).toEqual(DEFAULT_RECIPE_IMPORT_SETTINGS);
  });
});

describe("daily import counter", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  const settings: RecipeImportSettings = { ...DEFAULT_RECIPE_IMPORT_SETTINGS, dailyLimit: 2 };

  it("starts at zero used, full remaining", () => {
    const usage = getImportUsage(TODAY, settings);
    expect(usage).toEqual({ usedToday: 0, limit: 2, remaining: 2, atLimit: false });
  });

  it("increments on each recorded use and refuses once the limit is hit", () => {
    recordImportUsed(TODAY);
    expect(getImportUsage(TODAY, settings)).toEqual({ usedToday: 1, limit: 2, remaining: 1, atLimit: false });

    recordImportUsed(TODAY);
    const usage = getImportUsage(TODAY, settings);
    expect(usage).toEqual({ usedToday: 2, limit: 2, remaining: 0, atLimit: true });
  });

  it("resets automatically on a new calendar day", () => {
    recordImportUsed(TODAY);
    recordImportUsed(TODAY);
    expect(getImportUsage(TODAY, settings).atLimit).toBe(true);
    expect(getImportUsage(TOMORROW, settings).atLimit).toBe(false);
    expect(getImportUsage(TOMORROW, settings).usedToday).toBe(0);
  });
});
