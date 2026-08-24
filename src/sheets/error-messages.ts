/**
 * The one place a caught error is turned into words a cook reads on screen —
 * never a status code, never the name of the storage backend, never an
 * internal identifier (jargon sweep, WP-fix-sheets-429). Every route/hook
 * used to carry its own local `messageOf` that just forwarded `err.message`
 * verbatim; that is how `SheetsHttpError`'s own message ("Sheets API request
 * failed with 429" — transport.ts) and a handful of siblings (a failed
 * sign-in's raw Google OAuth `error_description`, "Drive about.get response
 * was missing user.emailAddress.", …) reached `ErrorState`/toast copy
 * untouched, past four separate wording sweeps that all hunted document
 * names and work-package codes instead of ordinary technical vocabulary.
 *
 * `SheetsHttpError`/`ReAuthRequiredError` are special-cased here regardless
 * of their own `.message` — those messages exist for logs/devtools
 * (`console.warn`, bug reports), not the screen. Any other `Error` is
 * assumed to already be human-authored copy (e.g. `workbook-store.ts`'s
 * "This meal planner looks incomplete…", a form's own validation message)
 * and passed through unchanged — this function does not censor arbitrary
 * text, only the two error types this codebase actually raises for
 * transport/auth failures.
 *
 * A 429 gets its own words on purpose: it is not the same failure as a
 * network error or a missing tab. It is temporary, it is nobody's fault, and
 * waiting fixes it — the retry button below still lets the user act, but the
 * copy itself should not imply something is broken.
 */
import { ReAuthRequiredError, SheetsHttpError } from "./errors.ts";

export function describeError(err: unknown): string {
  if (err instanceof SheetsHttpError) {
    if (err.status === 429) {
      return "Things are a little busy right now — this isn't anything you did. Please wait a few seconds and try again.";
    }
    return "Couldn't reach your meal planner right now. Please try again in a moment.";
  }
  if (err instanceof ReAuthRequiredError) {
    return "Your sign-in has expired. Please sign in again to continue.";
  }
  if (err instanceof Error) return err.message;
  return String(err);
}
