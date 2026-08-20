/**
 * Error types raised by the Sheets transport / auth layer. Kept distinct from
 * a generic `Error` so callers (eventually WP-15/WP-20's UI) can branch on
 * `instanceof` to decide "show a retry toast" vs "send the user back through
 * the sign-in button" without string-matching messages.
 */

/** A Sheets/Drive REST call failed after exhausting retries, with a non-auth HTTP status. */
export class SheetsHttpError extends Error {
  readonly status: number;
  readonly body: string | undefined;

  constructor(status: number, message: string, body?: string) {
    super(message);
    this.name = "SheetsHttpError";
    this.status = status;
    this.body = body;
  }
}

/**
 * The user's Google session is gone (never signed in, silent refresh failed,
 * or the API kept returning 401 after we tried refreshing once). The only
 * recovery is a fresh `signIn()` from a real user gesture - this error exists
 * so callers know to route back to that, rather than retrying automatically.
 */
export class ReAuthRequiredError extends Error {
  constructor(message = "Google session expired or missing; sign in again.") {
    super(message);
    this.name = "ReAuthRequiredError";
  }
}
