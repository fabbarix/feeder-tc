import { Fragment } from "react";
import { Mark } from "./Mark.tsx";
import { ErrorState } from "./components/ErrorState.tsx";
import type { missingEnvVars } from "../env.ts";
import styles from "./ConfigMissingScreen.module.css";

export interface ConfigMissingScreenProps {
  /** Names of the required `VITE_GOOGLE_*` vars that are unset (`env.ts`'s `missingEnvVars()`). Never empty when this screen is rendered — see `App.tsx`. */
  readonly missing: ReturnType<typeof missingEnvVars>;
}

/**
 * Rendered by `App.tsx` INSTEAD OF the router/shell when `missingEnvVars()`
 * finds a required `VITE_GOOGLE_*` var absent — a build without them (a
 * fresh clone with no `.env.local`, a fork that forgot to set the repo
 * Actions variables). Without this gate, `ShellContainer` reads
 * `env.googleClientId`/`env.googleApiKey` inside
 * `useState(createGoogleWiring)` on its very first render; `env.ts`'s
 * getters throw on a missing value, and an uncaught throw during render
 * unmounts the whole React tree, leaving nothing on screen and no clue why
 * (STATUS.md "Known debt"). Production always supplies both vars
 * (`.github/workflows/deploy.yml`), so reaching this screen means the BUILD
 * is misconfigured — the fix is to set the vars, never to fake a value here
 * to get past it.
 */
export function ConfigMissingScreen({ missing }: ConfigMissingScreenProps) {
  return (
    <div className={styles.root}>
      <Mark size={40} />
      <ErrorState
        title="Feeder isn't configured"
        description={
          <>
            This build is missing {missing.length === 1 ? "a required setting" : "required settings"}:{" "}
            {missing.map((name, index) => (
              <Fragment key={name}>
                {index > 0 ? ", " : ""}
                <code className={styles.code}>{name}</code>
              </Fragment>
            ))}
            . Copy <code className={styles.code}>.env.local.example</code> to{" "}
            <code className={styles.code}>.env.local</code> in the repo root and fill in your own Google Cloud
            values, then restart the dev server — or, if this is a deployed build, set them as repository Actions
            variables. See README.md's &ldquo;Self-hosting / forking&rdquo; section for where to get a client ID and
            API key.
          </>
        }
      />
    </div>
  );
}
