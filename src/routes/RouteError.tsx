import { isRouteErrorResponse, Link, useRouteError } from "react-router-dom";
import { EmptyState, ErrorState } from "../ui/components";
import { Compass } from "../ui/icons.ts";
import styles from "./RouteError.module.css";

/**
 * UA review finding #1: a bad URL used to replace the ENTIRE app with React
 * Router's own default error page — no header, no way back, addressed to
 * "developer" ("💿 Hey developer 👋..."). Two independent reviewers called
 * it the worst thing in the product.
 *
 * Wired in App.tsx in two places:
 *
 *  - as the `errorElement` on a pathless route wrapping every feature route
 *    (the common case): per React Router's own "wrap child routes in a
 *    pathless route" pattern, an error thrown by a CHILD replaces only that
 *    pathless route's own `<Outlet/>` slot — the parent "/" route's element
 *    (`ShellContainer`/`AppShell`, header + nav) keeps rendering around it
 *    untouched, so the person can still navigate away.
 *  - as the `errorElement` on the root "/" route itself, as a last-resort
 *    net for a crash in `ShellContainer` before any shell has rendered at
 *    all (rare — that component is mostly plumbing). There is no shell left
 *    to preserve in that case, so this renders standalone.
 *
 * A genuine unknown route never actually reaches this component in normal
 * operation — the router's own `path: "*"` catch-all (App.tsx) matches it
 * first and renders `NotFoundPanel` directly as ordinary route content, so
 * the shell is never in question for that case either. The
 * `isRouteErrorResponse`/404 branch below is defence in depth only (e.g. a
 * loader that throws a 404 `Response` some day), so the two cases this
 * finding asked for — "doesn't exist" vs "something went wrong" — stay
 * distinct even if that ever happens.
 *
 * Deliberately never renders the raw `error` itself: no message, no stack,
 * no React Router default copy. `console.error` is the only place the real
 * error goes, so it is still visible to a developer without a bystander
 * ever seeing framework internals addressed at one.
 */
export function RouteError() {
  const error = useRouteError();
  console.error("Route error boundary:", error);

  if (isRouteErrorResponse(error) && error.status === 404) {
    return <NotFoundPanel />;
  }

  return (
    <div className={styles.root}>
      <ErrorState
        title="Something went wrong"
        description="This page hit a snag and couldn't load. Reloading usually fixes it — if not, head back to the home screen and try again."
        // eslint-disable-next-line no-restricted-syntax -- the one deliberate exception (pattern-audit #2/eslint.config.js): an error BOUNDARY has no component state left to preserve, so it genuinely cannot soft-retry.
        onRetry={() => window.location.reload()}
        retryLabel="Reload"
      />
      <Link to="/" className={styles.action}>
        Go to Feeder home
      </Link>
    </div>
  );
}

/** The actual "bad URL" case — a real route match (App.tsx's `path: "*"`), not an error at all, so it renders inside the shell like any other route. */
export function NotFoundPanel() {
  return (
    <div className={styles.root}>
      <EmptyState
        icon={Compass}
        title="That page doesn't exist"
        description="The address you followed doesn't match anything in Feeder. Check it, or head back to the home screen."
        action={
          <Link to="/" className={styles.action}>
            Go to Feeder home
          </Link>
        }
      />
    </div>
  );
}
