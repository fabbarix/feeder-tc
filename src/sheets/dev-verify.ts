/**
 * Wiring for verify-google.html - a dev-only manual check page, NOT part of
 * the routed app (WP-15/WP-20 own that UI) and NOT part of the production
 * build (vite build only bundles index.html; this file is unreachable from
 * there). It exists purely so a human can exercise the one thing this WP
 * cannot test itself: a real sign-in + Picker open against live Google
 * APIs. Every call below is real - no msw, no fakes. See HANDOVER.md §7 and
 * this WP's final report for exactly what to click and what "it worked"
 * looks like.
 */
import { env } from "../env.ts";
import { createGoogleAuth } from "./auth.ts";
import { createGooglePickerLauncher, pickWorkbook } from "./picker.ts";
import { createWorkbookRegistry } from "./registry.ts";
import { createWorkbook } from "./spreadsheet.ts";
import { createGoogleSheetsTransport } from "./transport.ts";

function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`verify-google.html is missing #${id}`);
  return found as T;
}

const statusEl = el<HTMLParagraphElement>("status");
const logEl = el<HTMLPreElement>("log");
const signInBtn = el<HTMLButtonElement>("sign-in");
const signOutBtn = el<HTMLButtonElement>("sign-out");
const createBtn = el<HTMLButtonElement>("create");
const pickBtn = el<HTMLButtonElement>("pick");
const readBtn = el<HTMLButtonElement>("read");

function log(message: string): void {
  logEl.textContent += `\n${message}`;
  console.log("[wp-10 verify]", message);
}

const auth = createGoogleAuth(env.googleClientId);
const registry = createWorkbookRegistry(localStorage, "feeder.workbookRegistry.verify-page");
const pickerLauncher = createGooglePickerLauncher(env.googleApiKey);

function refreshButtons(): void {
  const signedIn = auth.state() === "signed-in";
  signInBtn.disabled = signedIn;
  signOutBtn.disabled = !signedIn;
  createBtn.disabled = !signedIn;
  pickBtn.disabled = !signedIn;
  readBtn.disabled = !signedIn || !registry.getActive();
  statusEl.textContent = signedIn ? "Signed in." : "Not signed in.";
}

auth.subscribe(refreshButtons);
refreshButtons();

signInBtn.addEventListener("click", async () => {
  try {
    await auth.signIn();
    log("Signed in. Requested scope: drive.file only.");
  } catch (err) {
    log(`Sign-in failed: ${String(err)}`);
  }
});

signOutBtn.addEventListener("click", async () => {
  await auth.signOut();
  log("Signed out.");
});

createBtn.addEventListener("click", async () => {
  const title = `Feeder WP-10 verification ${new Date().toISOString()}`;
  try {
    const created = await createWorkbook(title, auth, registry);
    log(`Created spreadsheet "${created.name}" (${created.id}).`);
    log(`Open it: https://docs.google.com/spreadsheets/d/${created.id}/edit`);
    refreshButtons();
  } catch (err) {
    log(`Create failed: ${String(err)}`);
  }
});

pickBtn.addEventListener("click", async () => {
  try {
    const picked = await pickWorkbook(pickerLauncher, auth, registry);
    log(picked ? `Picked "${picked.name}" (${picked.id}).` : "Picker closed without a selection.");
    refreshButtons();
  } catch (err) {
    log(`Picker failed: ${String(err)}`);
  }
});

readBtn.addEventListener("click", async () => {
  const active = registry.getActive();
  if (!active) return;
  try {
    const transport = createGoogleSheetsTransport({ spreadsheetId: active.id, auth });
    const rows = await transport.readRange("Meta!A1:B1");
    log(`Read Meta!A1:B1 from "${active.name}": ${JSON.stringify(rows)}`);
  } catch (err) {
    log(`Read failed: ${String(err)}`);
  }
});
