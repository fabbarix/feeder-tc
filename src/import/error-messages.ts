/**
 * The one place a recipe-import failure is turned into words a cook reads
 * on screen — same discipline as `src/sheets/error-messages.ts` (CLAUDE.md:
 * "Endpoint", "token", "model", "API" and "schema" are not words a cook
 * needs). `RecipeImportError.reason` is mapped explicitly here rather than
 * forwarding `.message` everywhere it's caught, so wording only ever needs
 * fixing in one place.
 */
import { RecipeImportError } from "./client.ts";

export function describeRecipeImportError(err: unknown): string {
  if (err instanceof RecipeImportError) {
    switch (err.reason) {
      case "not-configured":
        return "Set up the address and password for reading recipes in Settings first.";
      case "offline":
        return "Feeder needs to be online to read a recipe this way — try again once you're connected.";
      case "daily-limit":
      case "timeout":
      case "network":
      case "unauthorized":
      case "rate-limited":
      case "tool-unsupported":
        return err.message;
      case "invalid-response":
        return err.message;
    }
  }
  if (err instanceof Error) return err.message;
  return String(err);
}
