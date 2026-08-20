import type { ReactNode } from "react";
import type { IconComponent } from "../icons.ts";
import styles from "./EmptyState.module.css";

export interface EmptyStateProps {
  readonly icon?: IconComponent;
  readonly title: string;
  readonly description?: ReactNode;
  readonly action?: ReactNode;
}

/** Shared "nothing here yet" surface (UI_DESIGN.md §10) — kept in the kit so feature packages don't each invent their own empty-state look. */
export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className={styles.root}>
      {Icon ? <Icon size={40} aria-hidden="true" className={styles.icon} /> : null}
      <p className={styles.title}>{title}</p>
      {description ? <p className={styles.description}>{description}</p> : null}
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  );
}
