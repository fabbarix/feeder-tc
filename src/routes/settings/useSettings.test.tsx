/**
 * Regression guard for a LOST UPDATE introduced by refresh-before-edit
 * itself, within a single client.
 *
 * `save()` re-reads the row before writing, to protect a concurrent
 * household member's change from being clobbered. But every write on this
 * screen is a rapid tap (a stepper, an add-a-slot button), and two taps in
 * quick succession would BOTH read the pre-first-tap value, both compute the
 * same result, and the second would silently overwrite the first — tapping
 * "+" twice landed on 3 instead of 4.
 *
 * It surfaced as an intermittent E2E failure in an unrelated-looking spec
 * (`wp-22-weekly-planning`, "Mark cooked deducts pantry and creates
 * leftovers"), passing in isolation and failing only under the full parallel
 * suite — the classic shape of a real race being mistaken for flakiness.
 *
 * The fix serialises saves behind a promise queue, so tap N's read happens
 * after tap N-1's write. These tests pin both halves: the ordering, and the
 * queue surviving a failed write.
 */
import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { useSettings } from "./useSettings.ts";
import { WorkbookContext } from "../../workbook-context.ts";
import { ToastProvider } from "../../ui/components/Toast/ToastProvider.tsx";
import { createFakeWorkbookStore } from "../../domain/fakes/workbook-store.ts";
import type { Settings } from "../../domain/index.ts";
import { DEFAULT_SETTINGS } from "../../sheets/bootstrap.ts";

function wrapper(store: ReturnType<typeof createFakeWorkbookStore>) {
  return function Wrapper({ children }: { readonly children: ReactNode }) {
    return (
      <ToastProvider>
        <WorkbookContext.Provider value={{ store, workbookId: "wb-test" } as never}>
          {children}
        </WorkbookContext.Provider>
      </ToastProvider>
    );
  };
}

describe("useSettings save serialisation", () => {
  it("serialises: tap 2's read happens AFTER tap 1's write, never interleaved", async () => {
    const store = createFakeWorkbookStore();
    await store.settings.write({ ...DEFAULT_SETTINGS, householdSize: 2 });

    // Record the actual operation order. Without serialisation the two taps
    // interleave as read,read,write,write — both reading the same pre-first-
    // tap value. Serialised, they must be read,write,read,write.
    const order: string[] = [];
    const realRead = store.settings.read.bind(store.settings);
    const realWrite = store.settings.write.bind(store.settings);
    vi.spyOn(store.settings, "read").mockImplementation(async () => {
      order.push("read");
      await new Promise((r) => setTimeout(r, 20));
      return realRead();
    });
    vi.spyOn(store.settings, "write").mockImplementation(async (next) => {
      order.push("write");
      return realWrite(next);
    });

    const { result } = renderHook(() => useSettings(), { wrapper: wrapper(store) });
    await waitFor(() => expect(result.current.settings?.householdSize).toBe(2));
    // Drop the hook's own mount read — we only care about the two taps.
    order.length = 0;

    const bump = (current: Settings | undefined): Settings => ({
      ...(current ?? DEFAULT_SETTINGS),
      householdSize: (current ?? DEFAULT_SETTINGS).householdSize + 1,
    });

    // Fire both without awaiting the first — exactly what two quick taps do.
    await act(async () => {
      const a = result.current.save(bump);
      const b = result.current.save(bump);
      await Promise.all([a, b]);
    });

    // The discriminating assertion: interleaved reads mean a lost update.
    expect(order).toEqual(["read", "write", "read", "write"]);
    const persisted = await realRead();
    expect(persisted.householdSize).toBe(4);
  });

  it("a failed write does not poison the queue for later taps", async () => {
    const store = createFakeWorkbookStore();
    await store.settings.write({ ...DEFAULT_SETTINGS, householdSize: 2 });
    const realWrite = store.settings.write.bind(store.settings);
    let failNext = true;
    vi.spyOn(store.settings, "write").mockImplementation(async (next) => {
      if (failNext) {
        failNext = false;
        throw new Error("transient write failure");
      }
      return realWrite(next);
    });

    const { result } = renderHook(() => useSettings(), { wrapper: wrapper(store) });
    await waitFor(() => expect(result.current.settings?.householdSize).toBe(2));

    const bump = (current: Settings | undefined): Settings => ({
      ...(current ?? DEFAULT_SETTINGS),
      householdSize: (current ?? DEFAULT_SETTINGS).householdSize + 1,
    });

    await act(async () => {
      await result.current.save(bump).catch(() => undefined);
    });
    await act(async () => {
      await result.current.save(bump);
    });

    // The second tap still worked: a rejected save must not leave the queue
    // permanently rejected.
    const persisted = await store.settings.read();
    expect(persisted.householdSize).toBe(3);
  });
});
