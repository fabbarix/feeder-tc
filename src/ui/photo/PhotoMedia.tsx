import { useEffect, useState } from "react";
import type { PhotoOwnerKind } from "../../domain/types.ts";
import { CookingPot, Carrot, Package } from "../icons.ts";
import { Skeleton } from "../components/Skeleton.tsx";
import styles from "./PhotoMedia.module.css";

export type PhotoSize = "grid" | "list" | "listLg" | "detail" | "step";

const SIZE_CLASS: Record<PhotoSize, string> = {
  grid: styles.grid!,
  list: styles.list!,
  listLg: styles.listLg!,
  detail: styles.detail!,
  step: styles.step!,
};

/** Calm, neutral placeholder glyph per owner kind (DESIGN_PHOTOS.md §6: "the no-photo state is the default, not an edge case") — reuses the same kitchen-vocabulary icons already established elsewhere (DESIGN.md), never a "broken image" look. */
const PLACEHOLDER_ICON: Record<PhotoOwnerKind, typeof CookingPot> = {
  recipe: CookingPot,
  "recipe-step": CookingPot,
  ingredient: Carrot,
  product: Package,
};

export interface PhotoMediaProps {
  /** Selects the placeholder glyph — matches `PhotoOwnerKind` (types.ts), not imported as a stronger type here since `src/ui/**` may not depend on `contracts.ts`, and this prop is purely cosmetic anyway. */
  readonly kind: PhotoOwnerKind;
  /**
   * Denormalised hint (`Recipe.hasPhoto`/`RecipeStep.hasPhoto`/
   * `Ingredient.hasPhoto`) — `!== true` skips fetching entirely, which is
   * the whole point: no `Photos.get()` round trip for the 104 seeded
   * ingredients with no photo. Typed `boolean | undefined` (not a bare
   * optional) so a caller can pass an entity's own possibly-`undefined`
   * field straight through under this project's `exactOptionalPropertyTypes`.
   */
  readonly hasPhoto?: boolean | undefined;
  readonly size: PhotoSize;
  /**
   * Fetches this one photo's data URL, or `undefined` if none exists.
   * `src/ui/**` may not import `WorkbookStore` (UI_DESIGN.md §7 — "data
   * arrives via props"), so the caller (a route/container) closes over its
   * own store call, e.g. `() => getPhotoDataUrl(store, "ingredient", id)`
   * (`src/photos/read.ts`). Only ever invoked when `hasPhoto` is `true`.
   */
  readonly fetchPhoto: () => Promise<string | undefined>;
  /** Decorative by default (empty alt) — every context this renders in already shows the owner's name as adjacent text (DESIGN_PHOTOS.md §6: "text never waits on an image"), so the image itself carries no information a screen reader needs restated. */
  readonly alt?: string;
}

/**
 * The one shared "reserve the square, then show a photo / a calm neutral
 * placeholder / a loading shimmer" primitive (DESIGN_PHOTOS.md §5/§6,
 * mock-responsive.html's `.media` family) — recipe cards, ingredient rows,
 * pantry rows, Home's Tonight/Rest-of-week/Use-these-first, the recipe
 * detail inset and step images all render through this SAME component at a
 * different `size`, never a bespoke per-route thumbnail.
 *
 * Lazy fetch, gated on the `hasPhoto` hint alone (not true viewport
 * intersection — every call site here is a normal, unvirtualized list short
 * enough that "rendered" and "visible" are already close enough; see the
 * WP-PHOTO-UI handover report for that trade-off): `hasPhoto !== true`
 * renders the empty placeholder immediately with no I/O at all, so a grid of
 * 104 photo-less ingredients costs zero `Photos.get()` calls. Only a `true`
 * hint fetches, showing the kit's own `Skeleton` while in flight.
 *
 * SHARED — reused across recipes/steps/ingredients here; a product-photo
 * affordance (M6/M6-barcode) should reuse this component (`kind: "product"`
 * is already handled) rather than building a second one.
 */
export function PhotoMedia({ kind, hasPhoto = false, size, fetchPhoto, alt = "" }: PhotoMediaProps) {
  const [state, setState] = useState<"empty" | "loading" | "ready">(hasPhoto ? "loading" : "empty");
  const [dataUrl, setDataUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    // `hasPhoto` falsy: the initial `useState` above already computed
    // "empty" for this mount — nothing to fetch, and nothing to
    // synchronise back into state (react-hooks' set-state-in-effect rule:
    // an effect should reach for `setState` only from an async callback,
    // never synchronously in its own body).
    if (!hasPhoto) return;
    let cancelled = false;
    fetchPhoto()
      .then((url) => {
        if (cancelled) return;
        if (url) {
          setDataUrl(url);
          setState("ready");
        } else {
          // hasPhoto said yes but the row is gone/never landed — the calm
          // placeholder, never a "broken image" treatment (DESIGN_PHOTOS.md
          // §6's own "never style it as missing/broken" rule).
          setState("empty");
        }
      })
      .catch(() => {
        if (!cancelled) setState("empty");
      });
    return () => {
      cancelled = true;
    };
    // `fetchPhoto` is a fresh closure every render at most call sites
    // (`() => getPhotoDataUrl(store, kind, id)`) — keying this effect on it
    // would refetch on every parent re-render. `hasPhoto` is the only signal
    // that should ever trigger a (re)fetch here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPhoto]);

  const Icon = PLACEHOLDER_ICON[kind];
  const stateClass = state === "empty" ? styles.empty : state === "loading" ? styles.loading : "";

  return (
    <div className={`${styles.media} ${SIZE_CLASS[size]} ${stateClass}`}>
      {state === "ready" && dataUrl ? <img src={dataUrl} alt={alt} /> : null}
      {state === "empty" ? <Icon size={size === "list" ? 19 : size === "listLg" ? 22 : 24} aria-hidden="true" /> : null}
      {state === "loading" ? <Skeleton height="100%" width="100%" label="Photo loading" /> : null}
    </div>
  );
}
