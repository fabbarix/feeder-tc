/**
 * Recipe-import provider settings + the per-day spend brake — DESIGN_RECIPE_IMPORT.md
 * §1 and "Decisions (owner, 2026-08-24)" §4/§6.
 *
 * **Never in the workbook** (shared with the whole household, invariant 6's
 * human-readable rule is exactly the wrong property for a secret) and
 * **never a `VITE_` variable** (ships in the public bundle) — held in
 * `localStorage` on this device only, same trust boundary
 * `src/sheets/auth.ts` already uses for the Google OAuth token (that
 * module's own doc comment is the template for "what an XSS here costs,
 * and what bounds it").
 *
 * The daily counter is one of the decision doc's two independent spend
 * brakes (§4): "an app-side per-day import counter with a limit the
 * household sets, refusing further imports with a plain-language message
 * that says when it resets." The other brake — the provider's own spend
 * cap — cannot be implemented here at all; it is disclosed, not enforced
 * (see `src/routes/settings/RecipeImportSettings.tsx`).
 */
import type { IsoDate } from "../domain/index.ts";

export interface RecipeImportSettings {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  /** Household-set per-day import cap (the app-side spend brake). */
  readonly dailyLimit: number;
  /**
   * Household-declared, not auto-detected: whether the configured address
   * can open a web link and not just accept pasted text. Off by default —
   * DESIGN_RECIPE_IMPORT.md decisions §3: "a feature that silently
   * disappears depending on a setting is worse than one that is simply
   * always there," so paste-text never depends on this, and the link box
   * only appears once the household has said yes.
   */
  readonly linkEnabled: boolean;
}

export const DEFAULT_RECIPE_IMPORT_SETTINGS: RecipeImportSettings = {
  baseUrl: "",
  apiKey: "",
  model: "",
  dailyLimit: 10,
  linkEnabled: false,
};

const SETTINGS_KEY = "feeder.recipeImport.settings.v1";
const COUNTER_KEY = "feeder.recipeImport.dailyCount.v1";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** localStorage is attacker-writable (same rule `src/sheets/auth.ts` follows) — nothing here trusts the shape it reads back, so a corrupted or hand-edited value degrades to the defaults rather than throwing. */
export function readRecipeImportSettings(storage: Storage = window.localStorage): RecipeImportSettings {
  const raw = storage.getItem(SETTINGS_KEY);
  if (raw === null) return DEFAULT_RECIPE_IMPORT_SETTINGS;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isPlainObject(parsed)) return DEFAULT_RECIPE_IMPORT_SETTINGS;
    return {
      baseUrl: typeof parsed.baseUrl === "string" ? parsed.baseUrl : DEFAULT_RECIPE_IMPORT_SETTINGS.baseUrl,
      apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : DEFAULT_RECIPE_IMPORT_SETTINGS.apiKey,
      model: typeof parsed.model === "string" ? parsed.model : DEFAULT_RECIPE_IMPORT_SETTINGS.model,
      dailyLimit:
        typeof parsed.dailyLimit === "number" && Number.isFinite(parsed.dailyLimit) && parsed.dailyLimit > 0
          ? parsed.dailyLimit
          : DEFAULT_RECIPE_IMPORT_SETTINGS.dailyLimit,
      linkEnabled: typeof parsed.linkEnabled === "boolean" ? parsed.linkEnabled : DEFAULT_RECIPE_IMPORT_SETTINGS.linkEnabled,
    };
  } catch {
    return DEFAULT_RECIPE_IMPORT_SETTINGS;
  }
}

export function saveRecipeImportSettings(settings: RecipeImportSettings, storage: Storage = window.localStorage): void {
  storage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

/** The Settings screen's "Remove" action (DESIGN_RECIPE_IMPORT.md §1: "the only thing this document asks to be easy to find"). Clears the key and every other field — never leaves a stale key sitting in storage after the household says remove. */
export function clearRecipeImportSettings(storage: Storage = window.localStorage): void {
  storage.removeItem(SETTINGS_KEY);
}

export function isRecipeImportConfigured(settings: RecipeImportSettings): boolean {
  return settings.baseUrl.trim() !== "" && settings.apiKey.trim() !== "";
}

interface StoredCounter {
  readonly date: string;
  readonly count: number;
}

function readCounter(storage: Storage): StoredCounter | undefined {
  const raw = storage.getItem(COUNTER_KEY);
  if (raw === null) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isPlainObject(parsed)) return undefined;
    if (typeof parsed.date !== "string" || typeof parsed.count !== "number" || !Number.isFinite(parsed.count)) {
      return undefined;
    }
    return { date: parsed.date, count: parsed.count };
  } catch {
    return undefined;
  }
}

export interface ImportUsageStatus {
  readonly usedToday: number;
  readonly limit: number;
  readonly remaining: number;
  readonly atLimit: boolean;
}

/** `today` is an `IsoDate` (`YYYY-MM-DD`, local calendar day — see `Clock.today()`) so the counter resets at local midnight, not UTC midnight, matching how a household actually experiences "today". A stored count from a different date is treated as zero — no explicit reset step needed. */
export function getImportUsage(today: IsoDate, settings: RecipeImportSettings, storage: Storage = window.localStorage): ImportUsageStatus {
  const stored = readCounter(storage);
  const usedToday = stored && stored.date === today ? stored.count : 0;
  const limit = settings.dailyLimit;
  const remaining = Math.max(0, limit - usedToday);
  return { usedToday, limit, remaining, atLimit: usedToday >= limit };
}

/** Records one successful import request against today's count. Called once per actual request sent — never per retry-that-didn't-fire, so a household that never taps Import never burns its allowance. */
export function recordImportUsed(today: IsoDate, storage: Storage = window.localStorage): void {
  const stored = readCounter(storage);
  const usedToday = stored && stored.date === today ? stored.count : 0;
  const next: StoredCounter = { date: today, count: usedToday + 1 };
  storage.setItem(COUNTER_KEY, JSON.stringify(next));
}
