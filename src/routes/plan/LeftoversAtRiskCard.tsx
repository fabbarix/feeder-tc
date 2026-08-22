import { Link } from "react-router-dom";
import { BowlFood, CaretRight, CheckCircle } from "../../ui/icons.ts";
import { daysBetween } from "../../domain/index.ts";
import type { IsoDate } from "../../domain/index.ts";
import { expiryBadge, expiryTone, type ExpiryTone } from "../pantry/pantry-format.ts";
import { LEFTOVERS_AT_RISK_LIMIT, type LeftoverAtRisk } from "./plan-derive.ts";
import styles from "./plan.module.css";

const TONE_CLASS: Record<ExpiryTone, string | undefined> = {
  ok: styles.leftoverToneOk,
  warn: styles.leftoverToneWarn,
  crit: styles.leftoverToneCrit,
};

export interface LeftoversAtRiskCardProps {
  readonly items: readonly LeftoverAtRisk[];
  readonly today: IsoDate;
}

/**
 * Fills the weekend band's 4th `.week4` cell (tablet, 768–1439px —
 * Plan.tsx's own comment explains why that band needs a 4th cell at all).
 * Used to be a bare `aria-hidden` filler div, matching the mock exactly; a
 * round-2 tablet review found that read as a missing column rather than
 * deliberate space, and the owner chose leftovers-at-risk as the content
 * (over a shopping summary or an "add a meal" affordance) — decision-useful
 * at exactly this altitude, already in the app's own vocabulary (a
 * `slotLeftover` card's "Leftover: X" / "→ N leftover" badges), and it ties
 * the plan back to the pantry, the app's whole thesis.
 *
 * Reuses `.day`'s own visual weight (background/border/radius/padding/
 * min-height) so it reads as a peer of Fri/Sat/Sun rather than an
 * afterthought, but its own heading says "Leftovers", never a weekday — it
 * matches a day card's WEIGHT without impersonating one to a screen-reader
 * user scanning headings across the band.
 *
 * `items` is already sorted soonest-first and unbounded by
 * `deriveLeftoversAtRisk` (plan-derive.ts); this component caps what it
 * renders at `LEFTOVERS_AT_RISK_LIMIT` and links out to Pantry for the rest
 * rather than growing — `.week4` uses `align-items: start` specifically so
 * one tall cell can't inflate its whole band (plan.module.css), and an
 * unbounded list here would be exactly that cell.
 */
export function LeftoversAtRiskCard({ items, today }: LeftoversAtRiskCardProps) {
  const visible = items.slice(0, LEFTOVERS_AT_RISK_LIMIT);
  const overflow = items.length - visible.length;

  return (
    <div className={`${styles.day} ${styles.leftoversCard}`}>
      <h2 className={styles.dayHeading}>Leftovers</h2>
      {visible.length === 0 ? (
        // Reassuring, not a shrug (owner's brief) — and neutral rather than
        // green/"ok"-coloured, matching UI_DESIGN.md §13's "only exceptions
        // get colour": nothing here is an exception.
        <div className={styles.leftoversEmpty}>
          <CheckCircle size={18} aria-hidden="true" className={styles.leftoversEmptyIcon} />
          <p className={styles.leftoversEmptyText}>Nothing at risk this week</p>
        </div>
      ) : (
        <ul className={styles.leftoversList}>
          {visible.map(({ ingredient, lot, totalPortions }) => {
            const daysLeft = daysBetween(today, lot.expiry);
            const badge = expiryBadge(daysLeft, lot.expiry);
            return (
              <li key={ingredient.id}>
                {/* The lot's detail — same navigation idiom as Pantry's own
                    aggregated row (Pantry.tsx's `Link to={`/pantry/${id}`}`),
                    the closest existing thing to "click a leftover to act on
                    it" since a filled Plan slot itself doesn't link anywhere. */}
                <Link to={`/pantry/${ingredient.id}`} className={styles.leftoverEntry}>
                  <BowlFood size={16} aria-hidden="true" className={styles.leftoverEntryIcon} />
                  <span className={styles.leftoverEntryBody}>
                    <span className={styles.leftoverEntryName} title={ingredient.name}>
                      {ingredient.name}
                    </span>
                    <span className={styles.leftoverEntryMeta}>
                      {totalPortions} {totalPortions === 1 ? "portion" : "portions"} ·{" "}
                      <span className={TONE_CLASS[expiryTone(daysLeft)]}>{badge.label}</span>
                    </span>
                  </span>
                  <CaretRight size={14} aria-hidden="true" className={styles.leftoverEntryCaret} />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {overflow > 0 ? (
        <Link to="/pantry" className={styles.leftoversMore}>
          +{overflow} more in Pantry
        </Link>
      ) : null}
    </div>
  );
}
