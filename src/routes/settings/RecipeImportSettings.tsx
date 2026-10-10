import { useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "../../ui/components";
import { CaretDown } from "../../ui/icons.ts";
import {
  clearRecipeImportSettings,
  isRecipeImportConfigured,
  readRecipeImportSettings,
  saveRecipeImportSettings,
  type RecipeImportSettings as RecipeImportSettingsValue,
} from "../../import/settings.ts";
import { Stepper } from "../Stepper.tsx";
import { TextField } from "../fields.tsx";
import { SettingsGroup } from "./SettingsGroup.tsx";
import settingsStyles from "./settings.module.css";
import forms from "../forms.module.css";

/**
 * "Read a recipe" provider settings — DESIGN_RECIPE_IMPORT.md §1/§8/§11 and
 * decisions §4/§6. Everything here writes straight to `localStorage`
 * (`src/import/settings.ts`), never to the workbook — this is a per-device
 * secret, not a household fact.
 *
 * Disclosure is inline, plain language, before first use — not a settings
 * page nobody opens: what gets sent (the pasted text, plus the address you
 * type below), where (only that address, on an explicit "Read this recipe"
 * tap), and the two independent spend brakes (this app's daily count, and
 * the provider's own spend cap, which only the household can set up on the
 * provider's own site).
 *
 * Folded behind a one-line summary (2026-10-10 Settings redesign): it is the
 * longest group on the page and most households set it up once, if ever.
 * The summary says whether it is set up; arriving via `/settings#recipe-reader`
 * (RecipeImport.tsx's "set up an address first" link) opens it.
 */
export const RECIPE_READER_ANCHOR = "recipe-reader";

export function RecipeImportSettings() {
  const [settings, setSettings] = useState<RecipeImportSettingsValue>(() =>
    readRecipeImportSettings(),
  );
  const [showKey, setShowKey] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const configured = isRecipeImportConfigured(settings);
  // The app uses a browser router, so the real URL carries the hash.
  const linkedHere = window.location.hash === `#${RECIPE_READER_ANCHOR}`;
  // Opened on arrival via the anchor; Settings mounts fresh on that
  // navigation, so initial state is enough — the effect only scrolls.
  const [open, setOpen] = useState(linkedHere);
  const groupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (linkedHere) groupRef.current?.scrollIntoView({ block: "start" });
  }, [linkedHere]);

  function update(next: Partial<RecipeImportSettingsValue>): void {
    setSettings((current) => {
      const updated = { ...current, ...next };
      saveRecipeImportSettings(updated);
      return updated;
    });
  }

  function remove(): void {
    clearRecipeImportSettings();
    setSettings(readRecipeImportSettings());
    setConfirmingRemove(false);
  }

  const summary = configured
    ? `On · up to ${settings.dailyLimit} a day${settings.linkEnabled ? " · links too" : ""}`
    : "Not set up · needed to read a pasted recipe or a link";

  return (
    <div ref={groupRef}>
      <SettingsGroup
        title="Reading recipes"
        note="Stored on this device only."
        id={RECIPE_READER_ANCHOR}
      >
        <details
          className={settingsStyles.disclosure}
          open={open}
          onToggle={(event) => setOpen(event.currentTarget.open)}
        >
          <summary className={settingsStyles.summary}>
            <span className={settingsStyles.summaryText}>
              <span className={settingsStyles.summaryLabel}>Recipe reader</span>
              <span className={forms.hint}>{summary}</span>
            </span>
            <CaretDown size={16} aria-hidden="true" className={settingsStyles.summaryCaret} />
          </summary>
          <div className={settingsStyles.disclosureBody}>
            <p className={forms.hint}>
              Feeder sends the recipe text you paste &mdash; and nothing else from your kitchen
              &mdash; to an address you choose, usually a paid AI service, when you tap &ldquo;Read
              this recipe&rdquo;.
            </p>
            <TextField
              label="The address to send recipes to"
              value={settings.baseUrl}
              onChange={(baseUrl) => update({ baseUrl })}
              placeholder="e.g. https://api.openai.com/v1"
            />
            <div className={forms.field}>
              <label htmlFor="recipe-import-key">The password for that address</label>
              <div className={settingsStyles.keyRow}>
                <input
                  id="recipe-import-key"
                  type={showKey ? "text" : "password"}
                  value={settings.apiKey}
                  autoComplete="off"
                  onChange={(event) => update({ apiKey: event.target.value })}
                />
                <button
                  type="button"
                  className={forms.cancelButton}
                  aria-label={showKey ? "Hide password" : "Show password"}
                  onClick={() => setShowKey((v) => !v)}
                >
                  {showKey ? "Hide" : "Show"}
                </button>
              </div>
              <p className={forms.hint}>
                Only ever sent to the address above. If your provider offers a key with its own
                spending cap, use that.
              </p>
            </div>
            <TextField
              label="Which recipe reader to use (optional)"
              value={settings.model}
              onChange={(model) => update({ model })}
              placeholder="Leave blank for a sensible default"
            />
            <Stepper
              layout="row"
              label="Most recipes per day"
              hint="A safety net. Set a spending cap with your provider too."
              unit="recipes"
              unitOne="recipe"
              min={1}
              value={settings.dailyLimit}
              onChange={(dailyLimit) => update({ dailyLimit })}
            />
            <div className={forms.checkboxField}>
              <label>
                <input
                  type="checkbox"
                  checked={settings.linkEnabled}
                  onChange={(event) => update({ linkEnabled: event.target.checked })}
                />
                This address can open a web link, not just read pasted text
              </label>
              <p className={forms.hint}>
                Most can&rsquo;t. When on, you can also add a recipe by giving Feeder the
                page&rsquo;s address. Pasting text always works.
              </p>
            </div>
            {settings.linkEnabled ? (
              <div className={forms.field}>
                <TextField
                  label="The address of your own web-reading helper (optional)"
                  value={settings.toolServerUrl}
                  onChange={(toolServerUrl) => update({ toolServerUrl })}
                  placeholder="Usually left blank"
                />
                <p className={forms.hint}>
                  Only fill this in if whoever set up the address above told you to.
                </p>
              </div>
            ) : null}
            {configured ? (
              <button
                type="button"
                className={`${forms.cancelButton} ${settingsStyles.removeButton}`}
                onClick={() => setConfirmingRemove(true)}
              >
                Remove this password
              </button>
            ) : null}
          </div>
        </details>
      </SettingsGroup>
      <ConfirmDialog
        open={confirmingRemove}
        title="Remove this password?"
        description="Feeder will forget the address and password stored on this device. You can add them again any time, but reading recipes this way stops working until you do."
        confirmLabel="Remove"
        cancelLabel="Keep it"
        destructive
        onConfirm={remove}
        onCancel={() => setConfirmingRemove(false)}
      />
    </div>
  );
}
