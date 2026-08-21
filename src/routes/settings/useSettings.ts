/**
 * Owns the household-shared `Settings` row (WP-22): household size, slot
 * layout, repeat-exclusion window. Plain-row read/write
 * (`WorkbookStore.settings.read/write`) — last-write-wins, no outbox
 * (invariant 9 only applies to `InventoryEvent`s), same pattern as
 * `RecipeEditor.tsx`'s `store.recipes.upsert`.
 */
import { useCallback, useEffect, useState } from "react";
import { useWorkbookContext } from "../../workbook-context.ts";
import { useToast } from "../../ui/components/Toast/useToast.ts";
import type { Settings } from "../../domain/index.ts";

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface UseSettingsResult {
  readonly loading: boolean;
  readonly error: string | undefined;
  readonly saving: boolean;
  readonly settings: Settings | undefined;
  readonly retry: () => void;
  readonly save: (next: Settings) => Promise<void>;
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

  const save = useCallback(
    async (next: Settings): Promise<void> => {
      setSaving(true);
      try {
        await store.settings.write(next);
        setSettings(next);
      } catch (err) {
        showToast({ variant: "error", title: "Couldn't save settings", description: messageOf(err) });
      } finally {
        setSaving(false);
      }
    },
    [store, showToast],
  );

  const retry = useCallback(() => setReloadToken((t) => t + 1), []);

  return { loading, error, saving, settings, retry, save };
}
