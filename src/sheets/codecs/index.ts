/**
 * Barrel for every row<->entity codec (WP-11) plus `WORKBOOK_HEADERS`, the
 * DESIGN.md §3 header row for each of the nine sheets, used by both
 * bootstrap.ts (writes them to row 1 on a fresh workbook) and
 * workbook-store.ts (column-width bookkeeping).
 */
export * from "./common.ts";
export * from "./enums.ts";
export * from "./meta.ts";
export * from "./settings.ts";
export * from "./ingredients.ts";
export * from "./recipes.ts";
export * from "./recipe-ingredients.ts";
export * from "./recipe-steps.ts";
export * from "./plan-slots.ts";
export * from "./inventory-events.ts";
export * from "./shopping-items.ts";
export * from "./products.ts";
export * from "./product-photos.ts";
export * from "./price-observations.ts";

import type { CellRow } from "../../domain/contracts.ts";
import type { WorkbookSheetName } from "../../domain/types.ts";
import { INGREDIENTS_HEADER } from "./ingredients.ts";
import { INVENTORY_EVENTS_HEADER } from "./inventory-events.ts";
import { META_HEADER } from "./meta.ts";
import { PLAN_SLOTS_HEADER } from "./plan-slots.ts";
import { PRICE_OBSERVATIONS_HEADER } from "./price-observations.ts";
import { PRODUCT_PHOTOS_HEADER } from "./product-photos.ts";
import { PRODUCTS_HEADER } from "./products.ts";
import { RECIPE_INGREDIENTS_HEADER } from "./recipe-ingredients.ts";
import { RECIPE_STEPS_HEADER } from "./recipe-steps.ts";
import { RECIPES_HEADER } from "./recipes.ts";
import { SETTINGS_HEADER } from "./settings.ts";
import { SHOPPING_ITEMS_HEADER } from "./shopping-items.ts";

/** DESIGN.md §3 / DESIGN_PRODUCTS.md §2 header row for every sheet, keyed by `WorkbookSheetName`. */
export const WORKBOOK_HEADERS: Record<WorkbookSheetName, CellRow> = {
  Meta: META_HEADER,
  Settings: SETTINGS_HEADER,
  Ingredients: INGREDIENTS_HEADER,
  Recipes: RECIPES_HEADER,
  RecipeIngredients: RECIPE_INGREDIENTS_HEADER,
  RecipeSteps: RECIPE_STEPS_HEADER,
  PlanSlots: PLAN_SLOTS_HEADER,
  InventoryEvents: INVENTORY_EVENTS_HEADER,
  ShoppingItems: SHOPPING_ITEMS_HEADER,
  Products: PRODUCTS_HEADER,
  ProductPhotos: PRODUCT_PHOTOS_HEADER,
  PriceObservations: PRICE_OBSERVATIONS_HEADER,
};
