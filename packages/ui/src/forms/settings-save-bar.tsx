"use client";

import { Button } from "../components/button.tsx";
import { useTranslations } from "../i18n/use-translations.tsx";
import { cn } from "../lib/cn.ts";

/**
 * The one save bar of a settings screen (docs/design/settings-page-layout.md
 * §A, §C), taken from the Branding page.
 *
 * **Two places, one bar.** `sticky` is the page's own bar: it sticks to the
 * bottom of the window while its card is in view. `footer` is a card's own
 * save, the last child inside the card under its body. The states are the same
 * in both, so a person learns them once.
 *
 * **Save is always pressable** unless the form is being sent, so an admin can
 * save again. Discard is pressable only when something is unsaved. The bar
 * owns no form state: the page says what is unsaved and what the server
 * answered, and the buttons reach the form through `form={formId}`.
 */

export interface SettingsSaveBarProps {
  readonly mode: "sticky" | "footer";
  /** The `id` of the form the two buttons act on. */
  readonly formId: string;
  /** Labels of the parts that changed and are not saved yet. */
  readonly unsaved: readonly string[];
  /** What the server said after a save, or null. */
  readonly saved: string | null;
  /** Why the last save was refused, or null. */
  readonly error: string | null;
  /** The form is being sent: both buttons are off. */
  readonly pending: boolean;
  /** Whether Save is the press being sent. Defaults to `pending`. */
  readonly savePending?: boolean;
  /** Shown when nothing is unsaved, saved or refused. */
  readonly idleHint?: string;
  /** Hides the idle hint, for a page that shows its own refusal text. */
  readonly hideIdle?: boolean;
  readonly "data-testid"?: string;
  /** Test id of the status line that lists the unsaved parts. */
  readonly unsavedTestId?: string;
}

export function SettingsSaveBar({
  mode,
  formId,
  unsaved,
  saved,
  error,
  pending,
  savePending,
  idleHint,
  hideIdle = false,
  "data-testid": testId,
  unsavedTestId,
}: SettingsSaveBarProps) {
  const { t } = useTranslations();
  const idle = unsaved.length === 0 && saved === null && error === null;
  return (
    <div
      data-testid={testId}
      className={cn(
        "flex flex-wrap items-center justify-between gap-3",
        mode === "sticky"
          ? "sticky bottom-3 z-10 rounded-lg border border-line bg-surface px-4 py-3"
          : "border-t border-line px-3.5 py-2.5",
        mode === "sticky" && unsaved.length > 0 && "border-brand-line",
      )}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        {idle && !hideIdle ? (
          <p className="text-sm text-ink-3">
            {idleHint ?? t("common.noChanges")}
          </p>
        ) : null}
        <p
          role="status"
          className="text-sm font-medium text-ink"
          data-testid={unsavedTestId}
        >
          {unsaved.length > 0
            ? t("common.notSavedYet", { parts: unsaved.join(", ") })
            : ""}
        </p>
        {saved === null ? null : (
          <p role="status" className="text-xs text-ink-2">
            {saved}
          </p>
        )}
        {error === null ? null : (
          <p role="alert" className="text-xs text-bad">
            {error}
          </p>
        )}
      </div>
      <div className="flex flex-none items-center gap-2">
        <Button
          type="reset"
          form={formId}
          variant="ghost"
          size="sm"
          disabled={pending || unsaved.length === 0}
        >
          {t("common.discard")}
        </Button>
        <Button
          type="submit"
          form={formId}
          name="intent"
          value="save"
          variant="primary"
          size="sm"
          disabled={pending}
          pending={savePending ?? pending}
        >
          {pending ? t("common.saving") : t("common.saveChanges")}
        </Button>
      </div>
    </div>
  );
}
