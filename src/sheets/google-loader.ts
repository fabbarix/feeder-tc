/**
 * Loads a third-party <script> once per src and caches the in-flight/settled
 * promise, so calling it twice (e.g. sign-in clicked twice, or auth.ts and
 * picker.ts both needing gapi) never injects a duplicate <script> tag.
 *
 * Deliberately NOT called at module load time anywhere in this package - the
 * first call happens inside `signIn()`/`openPicker()`, both of which only run
 * from a real user gesture (a click handler upstream). That is what "no
 * Google API call before user gesture" (WP-10 success criterion) means in
 * practice: importing src/sheets must be side-effect-free.
 */

const loaded = new Map<string, Promise<void>>();

export function loadScriptOnce(src: string): Promise<void> {
  const existing = loaded.get(src);
  if (existing) return existing;

  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(script);
  });

  loaded.set(src, promise);
  return promise;
}

/** Test-only escape hatch: forgets cached script promises between unit tests. */
export function resetScriptCacheForTests(): void {
  loaded.clear();
}
