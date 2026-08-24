import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useWorkbookContext } from "../workbook-context.ts";
import { EmptyState, ErrorState, FreshnessMeter, Skeleton } from "../ui/components";
import { PhotoMedia, type PhotoMediaProps } from "../ui/photo/index.ts";
import { CalendarBlank, CookingPot, Package } from "../ui/icons";
import { addDays, computeShoppingList, daysBetween, formatQuantity, type PlanSlot } from "../domain/index.ts";
import { getPhotoDataUrl } from "../photos/index.ts";
import { usePantryInventory } from "./pantry/usePantryInventory.ts";
import { EXPIRING_SOON_DAYS } from "./pantry/pantry-options.ts";
import { formatLongDate, weekdayLabel } from "./date-format.ts";
import { useHomeData } from "./useHomeData.ts";
import styles from "./home.module.css";

/** "Good morning" / "Good afternoon" / "Good evening" from the injected Clock's current timestamp — local wall-clock hour (design/mock-screens.html's `.greet`: "Good evening, Fabio"). */
function greetingWord(nowIso: string): string {
  const hour = new Date(nowIso).getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** "Synced just now" / "Synced 2m ago" / "Synced 1h ago". */
function formatSyncStatus(nowIso: string, syncedAtIso: string): string {
  const minutes = Math.max(0, Math.round((Date.parse(nowIso) - Date.parse(syncedAtIso)) / 60_000));
  if (minutes < 1) return "synced just now";
  if (minutes < 60) return `synced ${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return `synced ${hours}h ago`;
}

interface WeekRowContent {
  readonly name: string;
  readonly secondary: string;
  readonly badge: "Planned" | "Leftover";
}

/**
 * Household dashboard (WP-VC2, design/mock-screens.html #home) — cross-
 * domain aggregation done HERE, in the route/container, never inside
 * `src/ui/**` (UI_DESIGN.md §7): plan slots + recipes come straight from
 * `WorkbookStore`, the pantry snapshot comes from `usePantryInventory`
 * (WP-21's own sync stack, reused rather than reimplemented), and "items to
 * buy this week" is `computeShoppingList` (WP-14) run over a rolling 7-day
 * window from today — the same engine `/shopping` will eventually render,
 * just consumed here for a count rather than a list.
 *
 * Every card has its own empty state (never one big blocking screen): a
 * brand-new workbook has no plan and no lots, and the dashboard still has
 * to say what to do next in each of Tonight / Rest of the week / Use these
 * first individually.
 */
export function Home() {
  const { store, clock, user } = useWorkbookContext();
  const pantry = usePantryInventory();
  const { loading, error, recipes, recipeIngredients, planSlots, settings, syncedAt, retry, markingSlotId, markSlotCooked } =
    useHomeData();
  // "Synced 2m ago" (mock's `.p-meta`/`.dt-sub`) — re-rendered every 30s via
  // `nowTick` so the relative text stays roughly fresh for a session left
  // open, against `syncedAt` (set once, by `useHomeData`'s own load promise
  // resolving). This is a per-visit "how stale is what's on screen right
  // now" indicator, not a tracked cross-route last-sync timestamp — no such
  // thing exists elsewhere in the app to read from, and `usePantryInventory`
  // exposes no timestamp of its own either.
  const [nowTick, setNowTick] = useState(() => clock.now());

  const today = clock.today();

  useEffect(() => {
    const id = window.setInterval(() => setNowTick(clock.now()), 30_000);
    return () => window.clearInterval(id);
  }, [clock]);

  const recipesById = useMemo(() => new Map(recipes.map((r) => [r.id, r] as const)), [recipes]);

  const toBuyCount = useMemo(() => {
    if (!settings) return 0;
    const range = { start: today, end: addDays(today, 6) };
    return computeShoppingList({ range, planSlots, recipes, recipeIngredients, settings, lots: pantry.lots }).length;
  }, [settings, today, planSlots, recipes, recipeIngredients, pantry.lots]);

  const expiring = useMemo(
    () =>
      pantry.lots
        .filter((lot) => lot.location !== "freezer" && daysBetween(today, lot.expiry) <= EXPIRING_SOON_DAYS)
        .slice()
        .sort((a, b) => daysBetween(today, a.expiry) - daysBetween(today, b.expiry)),
    [pantry.lots, today],
  );

  const tonightSlot = useMemo(
    () => planSlots.find((s) => s.date === today && s.slotType === "dinner" && s.filling.kind !== "empty"),
    [planSlots, today],
  );

  const restOfWeek = useMemo(() => {
    const end = addDays(today, 6);
    return planSlots
      .filter((s) => s.date > today && s.date <= end && s.state !== "skipped" && s.filling.kind !== "empty")
      .slice()
      .sort((a, b) => (a.date === b.date ? a.slotIndex - b.slotIndex : a.date < b.date ? -1 : 1));
  }, [planSlots, today]);

  function weekRowContent(slot: PlanSlot): WeekRowContent | undefined {
    if (slot.filling.kind === "recipe") {
      const recipe = recipesById.get(slot.filling.recipeId);
      const bought = recipe?.kind === "bought";
      return {
        name: recipe?.name ?? "Unknown recipe",
        secondary: `${weekdayLabel(slot.date)} ${slot.slotType}${bought ? " · bought" : ""}`,
        badge: "Planned",
      };
    }
    if (slot.filling.kind === "leftover") {
      // Captured into a local BEFORE the closure below, not read as
      // `slot.filling.lotId` inside it: TS's control-flow narrowing of
      // `slot.filling.kind === "leftover"` does not survive into a nested
      // arrow function (the closure could in principle run later, so TS
      // conservatively widens `slot.filling` back to the full union
      // there) — a plain `const` identifier's narrowing does survive.
      const lotId = slot.filling.lotId;
      const lot = pantry.lots.find((l) => l.id === lotId);
      const ingredient = lot ? pantry.ingredientsById.get(lot.ingredientId) : undefined;
      return {
        name: ingredient?.name ?? "Leftovers",
        secondary: `${weekdayLabel(slot.date)} ${slot.slotType}${lot ? ` · ${formatQuantity(lot.quantity)}` : ""}`,
        badge: "Leftover",
      };
    }
    if (slot.filling.kind === "leftover-projected") {
      const recipe = recipesById.get(slot.filling.recipeId);
      return {
        name: recipe ? `Leftover: ${recipe.name}` : "Leftover",
        secondary: `${weekdayLabel(slot.date)} ${slot.slotType} · not made yet`,
        badge: "Leftover",
      };
    }
    return undefined;
  }

  function tonightSecondary(slot: PlanSlot): string {
    if (slot.filling.kind === "recipe") {
      const recipe = recipesById.get(slot.filling.recipeId);
      if (!recipe) return "Dinner";
      const servings = slot.filling.scaleServings ?? recipe.baseServings;
      const parts = [
        "Dinner",
        recipe.kind === "cooked" ? `${recipe.prepMinutes} min prep` : undefined,
        `${recipe.cookMinutes} min cook`,
        `serves ${servings}`,
      ].filter((p): p is string => p !== undefined);
      return parts.join(" · ");
    }
    if (slot.filling.kind === "leftover") {
      const lotId = slot.filling.lotId;
      const lot = pantry.lots.find((l) => l.id === lotId);
      return lot ? `Dinner · ${formatQuantity(lot.quantity)}` : "Dinner";
    }
    if (slot.filling.kind === "leftover-projected") return "Dinner · not made yet";
    return "Dinner";
  }

  function tonightName(slot: PlanSlot): string {
    if (slot.filling.kind === "recipe") return recipesById.get(slot.filling.recipeId)?.name ?? "Unknown recipe";
    if (slot.filling.kind === "leftover") {
      const lotId = slot.filling.lotId;
      const lot = pantry.lots.find((l) => l.id === lotId);
      const ingredient = lot ? pantry.ingredientsById.get(lot.ingredientId) : undefined;
      return ingredient?.name ?? "Leftovers";
    }
    if (slot.filling.kind === "leftover-projected") {
      const recipe = recipesById.get(slot.filling.recipeId);
      return recipe ? `Leftover: ${recipe.name}` : "Leftovers";
    }
    return "";
  }

  /**
   * Photo props for a plan slot's leading thumbnail (Tonight / Rest of the
   * week) — a recipe slot photographs the recipe, a leftover slot
   * photographs the ingredient it's made from (same resolution
   * `tonightName`/`weekRowContent` already do). Returns `undefined` for an
   * empty filling (never rendered — callers only reach this for a slot
   * already known to have one), or for a leftover whose lot has vanished.
   */
  function slotPhotoProps(slot: PlanSlot): Pick<PhotoMediaProps, "kind" | "hasPhoto" | "fetchPhoto"> | undefined {
    if (slot.filling.kind === "recipe") {
      const recipeId = slot.filling.recipeId;
      const recipe = recipesById.get(recipeId);
      return { kind: "recipe", hasPhoto: recipe?.hasPhoto, fetchPhoto: () => getPhotoDataUrl(store, "recipe", recipeId) };
    }
    if (slot.filling.kind === "leftover") {
      const lotId = slot.filling.lotId;
      const lot = pantry.lots.find((l) => l.id === lotId);
      if (!lot) return undefined;
      const ingredientId = lot.ingredientId;
      const ingredient = pantry.ingredientsById.get(ingredientId);
      return {
        kind: "ingredient",
        hasPhoto: ingredient?.hasPhoto,
        fetchPhoto: () => getPhotoDataUrl(store, "ingredient", ingredientId),
      };
    }
    if (slot.filling.kind === "leftover-projected") {
      const recipeId = slot.filling.recipeId;
      const recipe = recipesById.get(recipeId);
      return { kind: "recipe", hasPhoto: recipe?.hasPhoto, fetchPhoto: () => getPhotoDataUrl(store, "recipe", recipeId) };
    }
    return undefined;
  }

  // Stale-save handling (re-read the freshest row, never resurrect a
  // cleared slot) lives in `useHomeData.ts`'s `markSlotCooked` now — see
  // that hook's own doc comment for the full reasoning.
  async function handleMarkTonightCooked(): Promise<void> {
    if (!tonightSlot) return;
    await markSlotCooked(tonightSlot.id);
  }

  const combinedLoading = loading || pantry.loading;
  const combinedError = error ?? pantry.error;
  const combinedRetry = (): void => {
    retry();
    pantry.retry();
  };

  const firstName = user?.name.trim().split(/\s+/)[0] ?? "there";
  const greeting = `${greetingWord(clock.now())}, ${firstName}`;
  const syncStatus = syncedAt ? formatSyncStatus(nowTick, syncedAt) : undefined;

  const restOfWeekRows = restOfWeek
    .map((slot) => ({ slot, content: weekRowContent(slot) }))
    .filter((row): row is { slot: PlanSlot; content: WeekRowContent } => row.content !== undefined);

  return (
    <section>
      {/* Always exactly one h1, unconditionally — required for axe's
          `page-has-heading-one` (e2e/wp-15-a11y.spec.ts's "/" case): axe
          scans as soon as `<main>` is visible, which happens well before
          this route's two async loads (its own + `usePantryInventory`'s)
          resolve, so a heading gated behind `!combinedLoading` can be
          legitimately absent at scan time — this hit in practice, not just
          in theory. Falls back to "Feeder" while loading/on error, same
          pattern as RecipeDetail.tsx's "Recipe" fallback. */}
      {combinedLoading || combinedError || !settings ? <h1>Feeder</h1> : null}

      {combinedLoading ? (
        <div className={styles.loadingStack}>
          <Skeleton height="2em" width="50%" />
          <Skeleton height="1.2em" width="35%" />
          <Skeleton height="4.5em" />
          <Skeleton height="10em" />
        </div>
      ) : null}

      {!combinedLoading && combinedError ? (
        <ErrorState
          title="Couldn't load your dashboard"
          description={combinedError}
          onRetry={combinedRetry}
        />
      ) : null}

      {!combinedLoading && !combinedError && settings ? (
        <>
          <h1 className={styles.greet}>{greeting}</h1>
          <p className={styles.greetSub}>
            {formatLongDate(today)} · household of {settings.householdSize}
            {syncStatus ? ` · ${syncStatus}` : ""}
          </p>

          <div className={styles.heroStat}>
            <div className={styles.hstat}>
              <div className={styles.n}>{toBuyCount}</div>
              <div className={styles.l}>to buy this week</div>
            </div>
            <div className={`${styles.hstat} ${styles.hstatWarn}`}>
              <div className={styles.n}>{expiring.length}</div>
              <div className={styles.l}>expiring in {EXPIRING_SOON_DAYS} days</div>
            </div>
          </div>

          <div className={styles.cols}>
            <div className={styles.main}>
              <div className={styles.card}>
                <h2 className={styles.cardHead}>Tonight</h2>
                <div className={styles.cardPad}>
                  {!tonightSlot ? (
                    <EmptyState
                      icon={CookingPot}
                      title="Nothing planned for tonight"
                      description="Plan a week to see tonight's meal here."
                      action={
                        <Link to="/plan" className={styles.emptyLink}>
                          Go to Plan
                        </Link>
                      }
                    />
                  ) : (() => {
                      const photo = slotPhotoProps(tonightSlot);
                      const rowMain = (
                        <span className={styles.rowMain}>
                          {/* Tonight is the single most prominent thing on
                              the page — the only row that earns the larger
                              64px thumbnail (mock-responsive.html's own
                              note: "prominence is position and weight",
                              never past what recognition needs). */}
                          {photo ? <PhotoMedia size="listLg" alt={tonightName(tonightSlot)} {...photo} /> : null}
                          <span className={styles.rowText}>
                            <span className={styles.rowName}>{tonightName(tonightSlot)}</span>
                            <span className={styles.rowSub}>{tonightSecondary(tonightSlot)}</span>
                          </span>
                        </span>
                      );
                      return tonightSlot.state === "cooked" ? (
                        <div className={styles.row}>
                          {rowMain}
                          <span className={`${styles.badge} ${styles.badgeOk}`}>Cooked</span>
                        </div>
                      ) : (
                        <div className={styles.row}>
                          {rowMain}
                          <button
                            type="button"
                            className={styles.markCookedButton}
                            onClick={() => void handleMarkTonightCooked()}
                            disabled={markingSlotId === tonightSlot.id}
                          >
                            {markingSlotId === tonightSlot.id ? "Marking…" : "Mark cooked"}
                          </button>
                        </div>
                      );
                    })()}
                </div>
              </div>

              <div className={styles.card}>
                <h2 className={styles.cardHead}>Rest of the week</h2>
                <div className={styles.cardPad}>
                  {restOfWeekRows.length === 0 ? (
                    <EmptyState
                      icon={CalendarBlank}
                      title="Nothing else planned this week"
                      description="Add meals to the rest of the week from the Plan tab."
                      action={
                        <Link to="/plan" className={styles.emptyLink}>
                          Go to Plan
                        </Link>
                      }
                    />
                  ) : (
                    restOfWeekRows.map(({ slot, content }) => {
                      const photo = slotPhotoProps(slot);
                      return (
                        <div className={styles.row} key={slot.id}>
                          <span className={styles.rowMain}>
                            {photo ? <PhotoMedia size="list" alt={content.name} {...photo} /> : null}
                            <span className={styles.rowText}>
                              <span className={styles.rowName}>{content.name}</span>
                              <span className={styles.rowSub}>{content.secondary}</span>
                            </span>
                          </span>
                          <span
                            className={`${styles.badge} ${content.badge === "Leftover" ? styles.badgeAccent : styles.badgeOk}`}
                          >
                            {content.badge}
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            <div className={styles.rail}>
              <div className={styles.card}>
                <h2 className={styles.cardHead}>Use these first</h2>
                <div className={styles.cardPad}>
                  {expiring.length === 0 ? (
                    pantry.lots.length === 0 ? (
                      <EmptyState
                        icon={Package}
                        title="Your pantry is empty"
                        description="Add what's in your kitchen to see what needs using first."
                        action={
                          <Link to="/pantry" className={styles.emptyLink}>
                            Go to Pantry
                          </Link>
                        }
                      />
                    ) : (
                      <EmptyState icon={Package} title="Nothing expiring soon" description="You're all caught up." />
                    )
                  ) : (
                    expiring.map((lot) => {
                      const ingredient = pantry.ingredientsById.get(lot.ingredientId);
                      const reference = lot.openedAt ?? lot.purchaseDate;
                      const totalDays = Math.max(1, daysBetween(reference, lot.expiry));
                      const daysLeft = daysBetween(today, lot.expiry);
                      const fraction = daysLeft / totalDays;
                      const tone = daysLeft < 0 ? styles.badgeCrit : daysLeft <= EXPIRING_SOON_DAYS ? styles.badgeWarn : styles.badgeOk;
                      return (
                        <div className={styles.plotRow} key={lot.id}>
                          {/* The thumbnail sits beside the meter, never
                              behind or instead of it — colour is still the
                              only alarm on this page (mock-responsive.html's
                              own "Home" note). */}
                          <PhotoMedia
                            kind="ingredient"
                            hasPhoto={ingredient?.hasPhoto}
                            size="list"
                            fetchPhoto={() => getPhotoDataUrl(store, "ingredient", lot.ingredientId)}
                            alt={ingredient?.name ?? ""}
                          />
                          <div className={styles.plot}>
                            <div className={styles.plotTop}>
                              <span className={styles.rowName}>{ingredient?.name ?? lot.ingredientId}</span>
                              <span className={`${styles.badge} ${tone}`}>
                                {daysLeft < 0 ? "Expired" : daysLeft === 0 ? "Today" : `${daysLeft} days`}
                              </span>
                            </div>
                            <FreshnessMeter
                              fractionRemaining={fraction}
                              label={daysLeft >= 0 ? `${daysLeft} of ${totalDays} days remaining` : "Expired"}
                            />
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}
