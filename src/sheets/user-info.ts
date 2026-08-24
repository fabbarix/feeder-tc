/**
 * Identifies the signed-in user for the header (`ShellUser` — name, email,
 * optional avatar) WITHOUT broadening the OAuth scope beyond `drive.file`
 * (HANDOVER.md invariant 8). `initTokenClient`'s response carries only an
 * opaque access token — no id_token, no email, no name — and the standard
 * fix (calling `userinfo`/`tokeninfo`) requires the `email`/`profile`
 * scopes we deliberately do not request.
 *
 * Instead this calls the Drive v3 `about.get` endpoint, which Google's own
 * reference lists `drive.file` among the scopes authorized to call it (it
 * is basic "who am I" account info tied to Drive access already granted,
 * not gated behind `email`/`profile`). This is the one Drive REST call in
 * this package that is not about the workbook spreadsheet itself.
 */
import { SheetsHttpError } from "./errors.ts";

const DRIVE_ABOUT_URL =
  "https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress,photoLink)";

interface DriveAboutResponse {
  readonly user?: {
    readonly displayName?: string;
    readonly emailAddress?: string;
    readonly photoLink?: string;
  };
}

/** Structurally a `ShellUser` (src/ui/AppShell.tsx) — not imported by name, since src/sheets must not depend on src/ui (UI_DESIGN.md §7 is a one-way boundary). */
export interface AuthenticatedUser {
  readonly name: string;
  readonly email: string;
  readonly pictureUrl?: string;
}

/**
 * Fetches the signed-in user's identity via Drive's `about.get`. Throws
 * `SheetsHttpError` on a non-OK response (mirrors the transport's own
 * error shape so callers can branch the same way), or a plain `Error` if
 * the response is missing the one field this app cannot function without
 * (`emailAddress`).
 */
export async function fetchAuthenticatedUser(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AuthenticatedUser> {
  const response = await fetchImpl(DRIVE_ABOUT_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new SheetsHttpError(response.status, "Failed to fetch the signed-in user from Drive", await response.text());
  }
  const body = (await response.json()) as DriveAboutResponse;
  const email = body.user?.emailAddress;
  if (!email) {
    // Plain language on purpose (jargon sweep, WP-fix-sheets-429) - reaches
    // App.tsx's handleSignIn catch, whose toast shows this verbatim.
    throw new Error("Couldn't confirm your account details. Please try signing in again.");
  }
  return {
    name: body.user?.displayName ?? email,
    email,
    ...(body.user?.photoLink ? { pictureUrl: body.user.photoLink } : {}),
  };
}
