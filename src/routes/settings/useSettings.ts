/**
 * Owns the household-shared `Settings` row (WP-22): household size, slot
 * layout, repeat-exclusion window. Plain-row read/write
 * (`WorkbookStore.settings.read/write`) — last-write-wins, no outbox
 * (invariant 9 only applies to `InventoryEvent`s).
 *
 * WP-stale-save: unlike `RecipeEditor.tsx`/`IngredientEditor.tsx` (one
 * discrete Save button after editing several fields at once), every write
 * here comes from a single rapid tap — a household-size stepper, an
 * add/remove-a-meal-slot button — with no explicit "Save" step at all.
 * Blocking each tap on a `ConfirmDialog` the way the whole-form editors do
 * would turn "tap + twice more" into three separate interruptions for what
 * the person experiences as one continuous adjustment. So `save` here takes
 * an EDIT function, not a finished `Settings` object, and applies it to a
 * freshly re-read row (same "refresh before edit" idea `src/sync/
 * refresh-before-edit.ts` names, inlined here because `Settings` is a
 * `read`/`write` singleton, not a `readAll`/`upsert` collection that helper's
 * generic shape expects) — protecting whatever field a concurrent household
 * member just changed (e.g. a meal slot) from being reset by THIS tap's
 * write, without a dialog on every tap. `settings === undefined` (no row
 * loaded — the "Set up defaults" empty-state action) skips the re-read
 * entirely: there is no prior row to have gone stale against, and
 * `store.settings.read()` would just rethrow the same "no valid general
 * row" error `Settings.tsx` already renders as its own empty state.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useWorkbookContext } from "../../workbook-context.ts";
import { useToast } from "../../ui/components/Toast/useToast.ts";
import type { Settings } from "../../domain/index.ts";
import { describeError as messageOf } from "../../sheets/error-messages.ts";

export interface UseSettingsResult {
  readonly loading: boolean;
  readonly error: string | undefined;
  readonly saving: boolean;
  readonly settings: Settings | undefined;
  readonly retry: () => void;
  /**
   * `current` is the freshest known row (a fresh re-read when one already
   * exists, `undefined` only for the no-row-yet empty state) — build the
   * next `Settings` from `current`, not from a captured closure value, so a
   * field this edit doesn't touch is never reset to a stale local copy.
   */
  readonly save: (edit: (current: Settings | undefined) => Settings) => Promise<void>;
}

export function useSettings(): UseSettingsResult {
  const { store } = useWorkbookContext();
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<Settings | undefined>(undefined);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    store.settings
      .read()
      .then((loaded) => {
        if (cancelled) return;
        setError(undefined);
        setSettings(loaded);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(messageOf(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [store, reloadToken]);

  // Serialises saves. Every write here is a rapid tap (a stepper, a
  // segmented control), and `save()` awaits a fresh read before writing —
  // so two taps in quick succession would BOTH read the pre-first-tap value,
  // both compute the same result, and the second would silently overwrite
  // the first. A lost update introduced by the refresh-before-edit itself,
  // within a single client: tapping "+" twice landed on 3 instead of 4.
  // Chaining each save onto the previous one keeps the cross-client
  // refresh-before-edit protection while guaranteeing tap N's read happens
  // after tap N-1's write. Never blocks the UI: the stepper is optimistic
  // and this queue only orders the writes behind it.
  const saveQueue = useRef<Promise<void>>(Promise.resolve());

  const save = useCallback(
    async (edit: (current: Settings | undefined) => Settings): Promise<void> => {
      const run = saveQueue.current.then(async () => {
        setSaving(true);
        try {
          // Refresh-before-edit — see this module's own doc comment for why
          // this merges onto a fresh read instead of showing a per-tap
          // ConfirmDialog. `settings === undefined` is the no-row-yet case;
          // re-reading there would just rethrow the same error this route's
          // empty state already handles.
          const current = settings === undefined ? undefined : await store.settings.read();
          const next = edit(current);
          await store.settings.write(next);
          setSettings(next);
          // Clears a stale "no Settings row yet" load error (Settings.tsx's
          // "Set up defaults" action) once a write actually creates that row —
          // otherwise the route's render logic, which treats that specific
          // error as "still missing", would keep showing the empty state
          // alongside the now-populated editor below it.
          setError(undefined);
        } catch (err) {
          showToast({ variant: "error", title: "Couldn't save settings", description: messageOf(err) });
        } finally {
          setSaving(false);
        }
      });
      // The queue must survive a rejected save — otherwise one failed write
      // would poison every later tap. The caller still sees the real result.
      saveQueue.current = run.catch(() => undefined);
      return run;
    },
    [store, settings, showToast],
  );

  const retry = useCallback(() => setReloadToken((t) => t + 1), []);

  return { loading, error, saving, settings, retry, save };
}
