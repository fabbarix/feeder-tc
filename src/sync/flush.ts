/**
 * Outbox flush (WP-17): appends pending events to InventoryEvents in FIFO
 * order, with retry, and — the point of this module — exactly-once
 * semantics even when a retried append could otherwise duplicate a row.
 *
 * The failure mode this defends against (WP-17 BDD "Flush retry does not
 * duplicate events"): the server actually applies an `append`, but the HTTP
 * response is lost (timeout, dropped connection) before the client sees
 * success. A naive retry would append the same event a second time. Client-
 * generated `EventId`s (design requirement 3) make the event itself
 * idempotent, but only if something actually *checks* for it before
 * re-appending — a purely local "did I already send this" flag cannot tell
 * the difference between "never sent" and "sent, response lost", because
 * both look identical from the client's side. So the dedupe check here
 * reads the sheet itself (`WorkbookStore.inventoryEvents.readFrom`) and
 * looks for the event's id among the rows actually there, which is the one
 * source of truth that distinguishes the two cases.
 */
import type { WorkbookStore } from "../domain/contracts.ts";
import type { Outbox } from "../domain/contracts.ts";
import type { EventId, InventoryEvent } from "../domain/types.ts";

export interface FlushOutboxDeps {
  readonly outbox: Outbox;
  readonly workbookStore: WorkbookStore;
  /** Delay between retries of the same event. Injectable so tests never wait on a real timer. Defaults to a real `setTimeout`-based delay. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Backoff schedule in ms, one entry per retry after the first attempt. Default: [50, 200, 500] (so up to 4 attempts per event). */
  readonly backoffMs?: readonly number[];
  /**
   * Lower bound row index already known to be free of anything this outbox
   * could have appended (e.g. the caller's last confirmed snapshot cursor).
   * Purely a performance hint for the dedupe check below — 0 is always
   * correct, just potentially rescans more rows than necessary.
   */
  readonly sinceCursor?: number;
}

export interface FlushOutboxFailure {
  readonly eventId: EventId;
  readonly error: unknown;
}

export interface FlushOutboxResult {
  /** Ids acknowledged (applied exactly once) during this call, in FIFO order. */
  readonly flushed: readonly EventId[];
  /** Present only if flushing stopped early because one event exhausted its retries. Later pending events are left untouched, to preserve FIFO order — a later event is never applied ahead of an earlier one still stuck. */
  readonly failure?: FlushOutboxFailure;
  /** Entries still pending in the outbox after this call (0 on a fully clean flush). */
  readonly remaining: number;
}

const DEFAULT_BACKOFF_MS = [50, 200, 500] as const;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

interface DedupeCheck {
  readonly found: boolean;
  readonly nextCursor: number;
}

/**
 * The exactly-once mechanism: checked BEFORE retrying a failed append, not
 * just against local outbox state, because the failure being guarded
 * against is "the server applied it and only the response was lost" — from
 * the client's point of view that is indistinguishable from a genuine
 * failure until it re-reads the sheet.
 */
async function wasAlreadyApplied(
  workbookStore: WorkbookStore,
  eventId: EventId,
  sinceCursor: number,
): Promise<DedupeCheck> {
  const page = await workbookStore.inventoryEvents.readFrom(sinceCursor);
  return { found: page.rows.some((row) => row.id === eventId), nextCursor: page.nextCursor };
}

interface FlushOneOutcome {
  readonly ok: boolean;
  readonly nextCursor: number;
  readonly error?: unknown;
}

async function flushOne(
  event: InventoryEvent,
  workbookStore: WorkbookStore,
  sleep: (ms: number) => Promise<void>,
  backoffMs: readonly number[],
  sinceCursorIn: number,
): Promise<FlushOneOutcome> {
  let sinceCursor = sinceCursorIn;
  const maxAttempts = backoffMs.length + 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await workbookStore.inventoryEvents.append(event);
      return { ok: true, nextCursor: sinceCursor };
    } catch (err) {
      const check = await wasAlreadyApplied(workbookStore, event.id, sinceCursor);
      sinceCursor = check.nextCursor;
      if (check.found) {
        // The append DID happen; only the confirmation was lost. Treat as
        // success without a second append — this is the exactly-once path.
        return { ok: true, nextCursor: sinceCursor };
      }
      if (attempt === maxAttempts) {
        return { ok: false, nextCursor: sinceCursor, error: err };
      }
      const delay = backoffMs[attempt - 1] ?? 0;
      await sleep(delay);
    }
  }
  /* istanbul ignore next -- loop above always returns before falling through */
  return { ok: false, nextCursor: sinceCursor, error: new Error("flushOne: unreachable") };
}

/**
 * Flushes the outbox in FIFO order. See module header for the exactly-once
 * mechanism; see `FlushOutboxResult` for how a partial flush is reported.
 */
export async function flushOutbox(deps: FlushOutboxDeps): Promise<FlushOutboxResult> {
  const { outbox, workbookStore } = deps;
  const sleep = deps.sleep ?? defaultSleep;
  const backoffMs = deps.backoffMs ?? DEFAULT_BACKOFF_MS;
  let sinceCursor = deps.sinceCursor ?? 0;

  const flushed: EventId[] = [];
  const pending = await outbox.pending();

  for (const event of pending) {
    const outcome = await flushOne(event, workbookStore, sleep, backoffMs, sinceCursor);
    sinceCursor = outcome.nextCursor;
    if (!outcome.ok) {
      const remaining = (await outbox.pending()).length;
      return { flushed, failure: { eventId: event.id, error: outcome.error }, remaining };
    }
    await outbox.acknowledge(event.id);
    flushed.push(event.id);
  }

  const remaining = (await outbox.pending()).length;
  return { flushed, remaining };
}
