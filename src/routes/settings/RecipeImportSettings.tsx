import { useState } from "react";
import { ConfirmDialog } from "../../ui/components";
import {
  clearRecipeImportSettings,
  isRecipeImportConfigured,
  readRecipeImportSettings,
  saveRecipeImportSettings,
  type RecipeImportSettings as RecipeImportSettingsValue,
} from "../../import/settings.ts";
import { Stepper } from "../Stepper.tsx";
import { TextField } from "../fields.tsx";
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
 */
export function RecipeImportSettings() {
  const [settings, setSettings] = useState<RecipeImportSettingsValue>(() => readRecipeImportSettings());
  const [showKey, setShowKey] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const configured = isRecipeImportConfigured(settings);

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

  return (
    <div className={settingsStyles.card}>
      <div className={settingsStyles.cardHead}>Reading recipes from text or a link</div>
      <div className={settingsStyles.cardBody}>
        <p className={forms.hint}>
          To read a pasted recipe into a draft you can check over, Feeder sends the text you paste to an address you
          choose and pay for — usually a paid AI service, or a computer of your own set up to do this. Feeder never
          sends your pantry, plan, or any other household data — only the recipe text you paste, at the moment you
          tap &ldquo;Read this recipe&rdquo;.
        </p>
        <TextField
          label="The address to send recipes to"
          value={settings.baseUrl}
          onChange={(baseUrl) => update({ baseUrl })}
          placeholder="e.g. https://api.openai.com/v1"
        />
        <div className={forms.field}>
          <label htmlFor="recipe-import-key">The password for that address</label>
          <div className={forms.row}>
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
            This is stored only on this device, and is only ever sent to the address above. If your provider lets
            you create a limited-use password with its own spending cap, use that one instead of your main one.
          </p>
        </div>
        <TextField
          label="Which recipe reader to use (optional)"
          value={settings.model}
          onChange={(model) => update({ model })}
          placeholder="Leave blank to use a sensible default"
        />
        <Stepper
          label="Most recipes to read per day"
          unit="recipes"
          unitOne="recipe"
          min={1}
          value={settings.dailyLimit}
          onChange={(dailyLimit) => update({ dailyLimit })}
        />
        <p className={forms.hint}>
          Feeder stops after this many for the day, as a safety net — the address you set up above may also let you
          set your own spending limit there, which is the only real backstop against a much larger bill.
        </p>
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
            Turn this on only if the address above can fetch a page itself — most cannot. When it&rsquo;s on, the
            &ldquo;Add from a recipe you found online&rdquo; screen gets a second option: give it the page&rsquo;s
            address and Feeder opens it and reads the recipe itself. Pasting the recipe&rsquo;s text always works
            regardless of this setting.
          </p>
        </div>
        {settings.linkEnabled ? (
          <TextField
            label="The address of your own web-reading helper (optional)"
            value={settings.toolServerUrl}
            onChange={(toolServerUrl) => update({ toolServerUrl })}
            placeholder="Leave blank unless you were told to fill this in"
          />
        ) : null}
        {settings.linkEnabled ? (
          <p className={forms.hint}>
            Most households leave this blank. Only fill it in if whoever set up the address above told you it needs
            a second, separate address to actually open a page.
          </p>
        ) : null}
        {configured ? (
          <button type="button" className={forms.cancelButton} onClick={() => setConfirmingRemove(true)}>
            Remove this password
          </button>
        ) : null}
      </div>
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
