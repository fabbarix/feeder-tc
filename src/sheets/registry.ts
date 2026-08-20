/**
 * Multi-workbook registry (WP-10 scope): the list of spreadsheets a user has
 * created or opened via Picker, persisted in localStorage, plus which one is
 * active. This is NOT a credential - a spreadsheet id and a display name are
 * no more sensitive than a bookmark - so, unlike the OAuth token in auth.ts,
 * it is fine (and required by the design) for this to survive a reload.
 *
 * DESIGN.md: "Workbook provisioning ... The spreadsheet ID is stored in
 * localStorage" / "The app supports remembering multiple workbooks and
 * switching between them."
 */

export interface WorkbookRegistryEntry {
  readonly id: string;
  readonly name: string;
}

export interface WorkbookRegistry {
  list(): readonly WorkbookRegistryEntry[];
  /**
   * Upserts by `id` (last-write-wins on the name). If the registry has no
   * active workbook yet, the newly added entry becomes active - this is what
   * lets "sign in, then pick/create a workbook" make that workbook active in
   * one step without a separate call.
   */
  add(entry: WorkbookRegistryEntry): void;
  /** Throws if `id` is not in the registry. */
  setActive(id: string): void;
  getActive(): WorkbookRegistryEntry | undefined;
  remove(id: string): void;
}

interface PersistedShape {
  readonly entries: readonly WorkbookRegistryEntry[];
  readonly activeId: string | undefined;
}

const EMPTY_STATE: PersistedShape = { entries: [], activeId: undefined };

function isWorkbookRegistryEntry(value: unknown): value is WorkbookRegistryEntry {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string" &&
    typeof (value as { name?: unknown }).name === "string"
  );
}

/** Never throws on malformed/foreign localStorage content - starts empty instead, same "quarantine, don't crash" spirit as the domain codecs. */
function loadState(storage: Storage, key: string): PersistedShape {
  const raw = storage.getItem(key);
  if (!raw) return EMPTY_STATE;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return EMPTY_STATE;
    const entriesRaw = (parsed as { entries?: unknown }).entries;
    const entries = Array.isArray(entriesRaw) ? entriesRaw.filter(isWorkbookRegistryEntry) : [];
    const activeIdRaw = (parsed as { activeId?: unknown }).activeId;
    const activeId = typeof activeIdRaw === "string" ? activeIdRaw : undefined;
    return { entries, activeId: entries.some((e) => e.id === activeId) ? activeId : undefined };
  } catch {
    return EMPTY_STATE;
  }
}

export function createWorkbookRegistry(
  storage: Storage,
  storageKey = "feeder.workbookRegistry.v1",
): WorkbookRegistry {
  let state = loadState(storage, storageKey);

  function persist(): void {
    storage.setItem(storageKey, JSON.stringify(state));
  }

  return {
    list(): readonly WorkbookRegistryEntry[] {
      return state.entries;
    },

    add(entry: WorkbookRegistryEntry): void {
      const withoutExisting = state.entries.filter((e) => e.id !== entry.id);
      const entries = [...withoutExisting, entry];
      const activeId = state.activeId ?? entry.id;
      state = { entries, activeId };
      persist();
    },

    setActive(id: string): void {
      if (!state.entries.some((e) => e.id === id)) {
        throw new Error(`Cannot activate unknown workbook id ${JSON.stringify(id)} - add() it first.`);
      }
      state = { ...state, activeId: id };
      persist();
    },

    getActive(): WorkbookRegistryEntry | undefined {
      return state.entries.find((e) => e.id === state.activeId);
    },

    remove(id: string): void {
      const entries = state.entries.filter((e) => e.id !== id);
      const activeId = state.activeId === id ? undefined : state.activeId;
      state = { entries, activeId };
      persist();
    },
  };
}
