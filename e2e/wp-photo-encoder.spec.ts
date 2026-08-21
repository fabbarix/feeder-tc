import { expect, test } from "@playwright/test";

/**
 * The one part of the photo encoder (src/photos/encode.ts) that CANNOT be
 * proven in Vitest: jsdom has no real `HTMLCanvasElement.getContext()` /
 * `canvas.toBlob` WebP encoder (see the harmless "Not implemented:
 * HTMLCanvasElement's getContext()" warnings `npm test` prints — TESTING.md
 * §"Accessibility checks" notes the same jsdom limitation for a different
 * feature). `src/photos/byte-budget.test.ts` already proves the ladder
 * SEARCH logic against a fabricated measurement table; this spec instead
 * runs the real encoder, with a real Chromium WebP encoder, against a
 * genuinely noisy synthetic image — DESIGN_PRODUCTS.md §5's own measured
 * table found a real noisy product shot barely shrinks with quality alone
 * (q80->q50 saved 1%) and needs the downscale ladder to actually fit. A
 * smooth gradient would pass this trivially at q85 and prove nothing about
 * that fallback path.
 *
 * No app UI is involved (this package is data + pipeline only, per the task
 * brief) — the dev server Playwright already starts (playwright.config.ts)
 * serves any project source file as an on-demand ES module, so this
 * `page.evaluate` dynamically imports src/photos/encode.ts directly and
 * calls it, exactly like a future consumer package would.
 */
test("encodePhotoDataUrl lands a noisy synthetic image under the 32 KB budget", async ({ page }) => {
  await page.goto(""); // any page served by the dev server — nothing about this test touches the app's UI or auth state.

  const result = await page.evaluate(async () => {
    // A synthetic "noisy packaging shot": a smooth colour base (like
    // printed artwork) plus per-pixel additive noise (like sensor noise
    // under indoor lighting) — texture that WebP genuinely struggles to
    // compress at high quality, unlike a flat gradient.
    function makeNoisyPngBlob(size: number, noiseAmplitude: number): Promise<Blob> {
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2D context");
      const imageData = ctx.createImageData(size, size);
      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
          const i = (y * size + x) * 4;
          const base = [
            Math.floor((x / size) * 180) + 30,
            Math.floor((y / size) * 180) + 30,
            128 + Math.floor(64 * Math.sin(x / 17) * Math.cos(y / 23)),
          ];
          for (let c = 0; c < 3; c += 1) {
            const noise = (Math.random() - 0.5) * 2 * noiseAmplitude;
            const value = base[c]! + noise;
            imageData.data[i + c] = Math.min(255, Math.max(0, Math.round(value)));
          }
          imageData.data[i + 3] = 255;
        }
      }
      ctx.putImageData(imageData, 0, 0);
      return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("toBlob returned null"))), "image/png");
      });
    }

    // A non-literal specifier deliberately: `tsc -b` (this project's
    // typecheck/build) resolves a LITERAL dynamic-import string at compile
    // time, and `/src/photos/encode.ts` is not a module path from e2e/'s
    // own perspective — it only resolves at runtime, in the browser, once
    // Vite's dev server serves it. Routing the path through a variable
    // keeps this a plain runtime `Promise<any>` import as far as tsc is
    // concerned, same trick as any other genuinely-dynamic import path.
    const encoderModulePath = "/src/photos/encode.ts";
    const mod = await import(encoderModulePath);
    // Larger than the encoder's 512px target so a real resize happens too,
    // not just a re-encode at the source's own size.
    const source = await makeNoisyPngBlob(1024, 40);
    const dataUrl = await mod.encodePhotoDataUrl(source);

    const commaIndex = dataUrl.indexOf(",");
    const base64Length = dataUrl.length - commaIndex - 1;
    const approxBytes = Math.floor((base64Length * 3) / 4);

    return {
      isWebp: dataUrl.startsWith("data:image/webp;base64,"),
      dataUrlLength: dataUrl.length,
      approxBytes,
    };
  });

  expect(result.isWebp).toBe(true);
  // The 32 KB budget the encoder targets (DESIGN_PHOTOS.md §4) — this is
  // the actual measured output of a real WebP encoder on a genuinely noisy
  // source, not a fabricated number.
  expect(result.approxBytes).toBeLessThanOrEqual(32 * 1024);
  // Comfortably under the hard 50,000-character Sheets cell ceiling too
  // (MAX_PHOTO_DATA_URL_LENGTH) — the codec is the backstop that enforces
  // this one absolutely, but a correctly-budgeted encoder should never even
  // approach it.
  expect(result.dataUrlLength).toBeLessThan(50_000);
});
