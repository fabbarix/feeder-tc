import { expect, type Locator } from "@playwright/test";

/**
 * True if two boxes' rectangles intersect at all (not just adjacency on one
 * axis) — the generic invariant this repo needs is "no stepper button ever
 * paints over the unit-suffix text it sits beside", not "button N is to the
 * left/right of the suffix", which would silently stop checking the moment
 * someone reorders the control's children.
 */
function boxesOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/**
 * The shared invariant behind the "servings"/"min" clipping defect
 * (QuantityInput.module.css's `.stepper` — see that file's own comment):
 * whatever unit-bearing text sits in a stepper control, NEITHER flanking
 * +/- button may visually overlap it, at any viewport width and for any
 * unit length. Generic over which stepper implementation is under test
 * (`QuantityInput`'s `.control` or `Stepper.tsx`/`ShoppingRow`'s `.qty`) —
 * callers pass the unit-bearing element and the button locator directly
 * rather than this helper assuming one DOM shape.
 */
export async function expectStepperDoesNotClipUnit(unit: Locator, buttons: Locator): Promise<void> {
  const unitBox = await unit.boundingBox();
  expect(unitBox, "unit-bearing element has no box — is it actually rendered/visible?").not.toBeNull();
  const count = await buttons.count();
  expect(count, "expected at least one stepper button").toBeGreaterThan(0);
  for (let i = 0; i < count; i += 1) {
    const button = buttons.nth(i);
    const buttonBox = await button.boundingBox();
    expect(buttonBox, `stepper button ${i} has no box — is it actually rendered/visible?`).not.toBeNull();
    const overlap = boxesOverlap(unitBox!, buttonBox!);
    expect(
      overlap,
      `stepper button ${i} (x=${buttonBox!.x}, w=${buttonBox!.width}) overlaps the unit text ` +
        `"${await unit.textContent()}" (x=${unitBox!.x}, w=${unitBox!.width}, right edge=${
          unitBox!.x + unitBox!.width
        })`,
    ).toBe(false);
  }
}
