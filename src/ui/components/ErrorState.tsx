import type { ReactNode } from "react";
import { WarningCircle } from "../icons.ts";
import styles from "./ErrorState.module.css";

export interface ErrorStateProps {
  readonly title: string;
  readonly description?: ReactNode;
  readonly onRetry?: () => void;
  readonly retryLabel?: string;
}

/** Shared error surface (UI_DESIGN.md §10) — distinct from a toast: for a whole view/section that failed to load, not a transient notification. */
export function ErrorState({ title, description, onRetry, retryLabel = "Try again" }: ErrorStateProps) {
  return (
    <div className={styles.root} role="alert">
      <WarningCircle size={32} aria-hidden="true" className={styles.icon} />
      <p className={styles.title}>{title}</p>
      {description ? <p className={styles.description}>{description}</p> : null}
      {onRetry ? (
        <button type="button" className={styles.retry} onClick={onRetry}>
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}
