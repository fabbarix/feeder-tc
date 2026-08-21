/**
 * The photo encoder's byte-budget search (WP-PHOTO — DESIGN_PHOTOS.md §4,
 * reusing DESIGN_PRODUCTS.md §5's measured limits verbatim).
 *
 * Pure and browser-independent on purpose: `src/photos/encode.ts` is the
 * module that actually touches canvas/createImageBitmap (browser-only,
 * deliberately outside `src/domain/**`, which must stay I/O-free — see this
 * package's own README/HANDOVER §5). Everything *decision-shaped* about the
 * encoder — which (size, quality) attempt to try next, and when to stop —
 * lives here instead, injected with a `measure` callback, so it is
 * unit-testable with fabricated byte counts and never needs a real canvas.
 *
 * The core rule this file exists to enforce (DESIGN_PRODUCTS.md §5):
 * **quality alone does not predict size**. Measured on a real noisy product
 * shot, q80 -> q50 saved only 1% (71 KB -> 70.9 KB) — sensor noise is
 * incompressible detail. So the budget is enforced by MEASURING each
 * attempt's actual output bytes, never by trusting "q65 should be small
 * enough" and skipping the check.
 */

/** One (resize, quality) attempt in the ladder below. */
export interface EncodeAttempt {
  readonly sizePx: number;
  readonly quality: number;
}

/** 512px longest side, WebP, q85 down to q35 — DESIGN_PHOTOS.md §4's first pass. */
export const TARGET_SIZE_PX = 512;
export const QUALITY_LADDER: readonly number[] = [0.85, 0.75, 0.65, 0.55, 0.45, 0.35];
/** If every quality step at 512px is still over budget, downscale instead, at a fixed q60. */
export const DOWNSCALE_LADDER: readonly number[] = [448, 384, 320];
export const DOWNSCALE_QUALITY = 0.6;
/** 32 KB — headroom under the ~36.6 KB (50,000-char cell / 4×3 base64) hard ceiling (`MAX_PHOTO_DATA_URL_LENGTH`, domain/types.ts). */
export const BYTE_BUDGET = 32 * 1024;

/** The full ordered ladder of attempts DESIGN_PHOTOS.md §4 specifies: q85→q35 at 512px, then 448/384/320px at a fixed q60. */
export function encodeAttempts(): readonly EncodeAttempt[] {
  const attempts: EncodeAttempt[] = QUALITY_LADDER.map((quality) => ({ sizePx: TARGET_SIZE_PX, quality }));
  for (const sizePx of DOWNSCALE_LADDER) {
    attempts.push({ sizePx, quality: DOWNSCALE_QUALITY });
  }
  return attempts;
}

export interface BudgetResult<T> {
  readonly attempt: EncodeAttempt;
  readonly bytes: number;
  readonly result: T;
  /** False only if every attempt in the ladder was measured and none fit — the caller (encode.ts) still returns the smallest one found; the hard refusal lives at the codec layer (src/sheets/codecs/photos.ts), not here. */
  readonly withinBudget: boolean;
}

/**
 * Walks `attempts` in order, calling `measure` for each and stopping at the
 * first one whose measured byte size fits `budgetBytes`. If none fit, returns
 * the LAST attempt tried (the smallest/most-compressed one in the standard
 * ladder) with `withinBudget: false` — a best-effort result, not a thrown
 * error: this function makes no policy decision about what "still too big"
 * means, that is `src/sheets/codecs/photos.ts`'s hard-refusal job on write.
 *
 * `measure` is async so the real encoder (encode.ts) can do actual
 * canvas/WebP work per attempt; a unit test instead hands this a synchronous
 * table of fabricated sizes (see byte-budget.test.ts) to prove the search
 * logic itself — no browser required.
 */
export async function pickUnderBudget<T>(
  measure: (attempt: EncodeAttempt) => Promise<{ readonly bytes: number; readonly result: T }>,
  budgetBytes: number = BYTE_BUDGET,
  attempts: readonly EncodeAttempt[] = encodeAttempts(),
): Promise<BudgetResult<T>> {
  const first = attempts[0];
  if (!first) {
    throw new Error("pickUnderBudget requires at least one attempt");
  }
  let last: BudgetResult<T> | undefined;
  for (const attempt of attempts) {
    // Deliberately sequential, not Promise.all: each attempt only runs if
    // the previous one missed budget — trying a smaller/lower-quality
    // encode is wasted work once an earlier attempt already fit.
    const { bytes, result } = await measure(attempt);
    const withinBudget = bytes <= budgetBytes;
    last = { attempt, bytes, result, withinBudget };
    if (withinBudget) return last;
  }
  return last!;
}
