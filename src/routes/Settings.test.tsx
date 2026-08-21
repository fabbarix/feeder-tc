import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Settings } from "./Settings.tsx";
import { ToastProvider } from "../ui/components/Toast/ToastProvider.tsx";
import { ThemeProvider } from "../ui/theme/ThemeProvider.tsx";
import { WorkbookContext, type WorkbookContextValue } from "../workbook-context.ts";
import { createFakeOutbox, createFakeRng, createFakeWorkbookStore, createFixedClock } from "../domain/fakes/index.ts";
import { makeIsoDate, makeIsoTimestamp, type WorkbookStore } from "../domain/index.ts";

const NO_SETTINGS_ROW_ERROR =
  'Settings sheet has no valid "general" row — the workbook was not bootstrapped correctly.';

/** A store whose `settings.read()` throws exactly what `decodeSettings` throws for a workbook with no "general" row yet — everything else delegates to a normal in-memory fake. */
function createStoreMissingSettingsRow(): WorkbookStore {
  const store = createFakeWorkbookStore();
  return {
    ...store,
    settings: {
      read: () => Promise.reject(new Error(NO_SETTINGS_ROW_ERROR)),
      write: store.settings.write,
    },
  };
}

function renderSettings(store: WorkbookStore) {
  const contextValue: WorkbookContextValue = {
    store,
    clock: createFixedClock(makeIsoTimestamp("2026-08-21T12:00:00.000Z"), makeIsoDate("2026-08-21")),
    rng: createFakeRng(1),
    workbookId: "wb-1",
    outbox: createFakeOutbox(),
  };
  return render(
    <ThemeProvider>
      <WorkbookContext.Provider value={contextValue}>
        <ToastProvider>
          <Settings />
        </ToastProvider>
      </WorkbookContext.Provider>
    </ThemeProvider>,
  );
}

/**
 * Regression test for WP-31's onboarding-copy fix: a workbook whose
 * `Settings` sheet has no data row yet (old enough to predate this feature,
 * or one PR #36's schema self-heal only just gave the tab/header back to)
 * used to surface `decodeSettings`'s raw throw as a dead-end `ErrorState` —
 * "the workbook was not bootstrapped correctly", with a "Try again" button
 * that would only ever fail the same way again. This asserts the recovery
 * path instead: a real action that fixes it, wired to the same
 * `DEFAULT_SETTINGS` a brand-new workbook gets.
 */
describe("Settings — no Settings row yet (WP-31)", () => {
  it("offers 'Set up defaults' instead of a dead-end error, and it actually works", async () => {
    renderSettings(createStoreMissingSettingsRow());

    // Not the generic, non-actionable error surface...
    expect(await screen.findByText(/no settings saved yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/couldn't load settings/i)).not.toBeInTheDocument();
    expect(screen.queryByText(NO_SETTINGS_ROW_ERROR)).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /set up defaults/i }));

    // The full editor mounts once defaults are written.
    expect(await screen.findByText("Meal slots per day")).toBeInTheDocument();
    expect(screen.getByLabelText("Fewer — Size")).toBeInTheDocument();
    expect(screen.queryByText(/no settings saved yet/i)).not.toBeInTheDocument();
  });

  it("still shows a retryable error for a genuinely different load failure", async () => {
    const store = createFakeWorkbookStore();
    const broken: WorkbookStore = {
      ...store,
      settings: {
        read: () => Promise.reject(new Error("Network request failed")),
        write: store.settings.write,
      },
    };
    renderSettings(broken);

    expect(await screen.findByText(/couldn't load settings/i)).toBeInTheDocument();
    expect(screen.getByText("Network request failed")).toBeInTheDocument();
    expect(screen.queryByText(/set up defaults/i)).not.toBeInTheDocument();
  });
});
