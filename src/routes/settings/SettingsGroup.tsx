import { useId, type ReactNode } from "react";
import styles from "./settings.module.css";

/**
 * One titled group of settings rows: a small-caps heading (with an optional
 * status on the right, e.g. "Saving…", so it never shifts the rows), an
 * optional one-line note saying who the settings affect, then the rows in a
 * single bordered card.
 */
export function SettingsGroup({
  title,
  note,
  aside,
  id,
  children,
}: {
  readonly title: string;
  readonly note?: string;
  readonly aside?: ReactNode;
  readonly id?: string;
  readonly children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section className={styles.group} aria-labelledby={headingId} id={id}>
      <div className={styles.groupHead}>
        <h2 id={headingId} className={styles.groupTitle}>
          {title}
        </h2>
        {aside}
      </div>
      {note ? <p className={styles.groupNote}>{note}</p> : null}
      <div className={styles.card}>{children}</div>
    </section>
  );
}
