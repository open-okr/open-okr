"use client";

import {
  Button,
  Card,
  CardBody,
  CardHeader,
  useTranslations,
} from "@openokr/ui";
import { useActionState } from "react";
import type { ProfileResult } from "../actions.ts";

/**
 * The self-edit form on the profile page (P6-G09, screen S-33).
 *
 * Timezone, primary channel and quiet hours. Bio editing through the TipTap
 * editor is deferred: the editor is a client component that needs draft
 * autosave, mentions and slash commands, and wiring all of that for a bio
 * field is more scope than the directory task warrants. The bio is shown
 * as rendered HTML above, and editable through /account/channels until a
 * dedicated editor lands.
 */
export function ProfileForm({
  memberId,
  timezone,
  primaryChannel,
  updateProfile,
}: {
  readonly memberId: string;
  readonly timezone: string | null;
  readonly primaryChannel: string | null;
  readonly updateProfile: (
    previous: ProfileResult | null,
    form: FormData,
  ) => Promise<ProfileResult>;
}) {
  const { t } = useTranslations();

  const [state, action, pending] = useActionState(updateProfile, null);

  return (
    <Card>
      <CardHeader>
        <h2 className="text-sm font-bold text-ink">
          {t("people.detail.profileForm.editYourProfile")}
        </h2>
      </CardHeader>
      <CardBody>
        <form action={action} className="flex flex-col gap-2">
          <input type="hidden" name="memberId" value={memberId} />

          <label className="flex flex-col gap-1 text-xs text-ink-3">
            {t("common.timezone")}
            <input
              name="timezone"
              defaultValue={timezone ?? ""}
              placeholder={t("people.detail.profileForm.eGAsiaKuala")}
              className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs text-ink-3">
            {t("common.primaryChannel")}
            <select
              name="primaryChannel"
              defaultValue={primaryChannel ?? "app"}
              className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
            >
              <option value="app">
                {t("people.detail.profileForm.inApp")}
              </option>
              <option value="email">
                {t("people.detail.profileForm.email")}
              </option>
              <option value="slack">
                {t("people.detail.profileForm.slack")}
              </option>
              <option value="teams">
                {t("people.detail.profileForm.teams")}
              </option>
              <option value="whatsapp">
                {t("people.detail.profileForm.whatsapp")}
              </option>
              <option value="telegram">
                {t("people.detail.profileForm.telegram")}
              </option>
            </select>
          </label>

          <fieldset className="flex flex-col gap-1">
            <legend className="text-xs text-ink-3">
              {t("people.detail.profileForm.quietHoursLeaveEmpty")}
            </legend>
            <div className="flex gap-2">
              <input
                name="quietStart"
                type="time"
                className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
              />
              <span className="self-center text-xs text-ink-3">
                {t("common.to")}
              </span>
              <input
                name="quietEnd"
                type="time"
                className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
              />
            </div>
          </fieldset>

          <div className="flex items-center gap-3 pt-1">
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? "Saving..." : "Save"}
            </Button>
            {state?.ok === true ? (
              <span className="text-xs text-good">{state.message}</span>
            ) : null}
            {state?.ok === false ? (
              <span className="text-xs text-bad" role="alert">
                {state.message}
              </span>
            ) : null}
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
