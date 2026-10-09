"use client";

import {
  Button,
  Card,
  CardBody,
  CardHeader,
  RichTextField,
  TimezoneSelect,
  useTranslations,
} from "@openokr/ui";
import { useActionState } from "react";
import type { ProfileResult } from "../actions.ts";

/**
 * The self-edit form on the profile page (P6-G09, screen S-33).
 *
 * Timezone, primary channel, quiet hours and the bio. **The bio is rich text**
 * (TECHNICAL-PLAN §4.1 names `bio` as rich), so it is written in the compact
 * rich text field and validated again at the action's boundary. It
 * was deferred at P6-G09 and nothing else could edit it, which completeness
 * review M-22 recorded. No mentions and no attachments: a bio is a few lines
 * about somebody, and a picture of them is the avatar card's.
 *
 * **Sent only when it changed.** Every save writes a new bio version, so a
 * form that sent the bio whenever somebody changed their timezone would
 * version a bio nobody touched.
 */
export function ProfileForm({
  memberId,
  timezone,
  zones,
  primaryChannel,
  quietHours,
  bio,
  updateProfile,
}: {
  readonly memberId: string;
  readonly timezone: string | null;
  /** The server's own list, so the form offers only what it will accept. */
  readonly zones: readonly string[];
  readonly primaryChannel: string | null;
  /** The saved window, shown so a save that does not touch it keeps it. */
  readonly quietHours: { readonly start: string; readonly end: string } | null;
  /** The stored document, or null for no bio. */
  readonly bio: unknown;
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

          <TimezoneSelect
            label={t("common.timezone")}
            name="timezone"
            zones={zones}
            defaultValue={timezone}
          />

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

          <RichTextField
            label={t("people.detail.bio")}
            name="bio"
            content={bio ?? null}
            placeholder={t("people.detail.profileForm.aFewLinesAbout")}
            description={t("people.detail.profileForm.emptyTheBioTo")}
          />

          <fieldset className="flex flex-col gap-1">
            <legend className="text-xs text-ink-3">
              {t("people.detail.profileForm.quietHoursLeaveEmpty")}
            </legend>
            <div className="flex gap-2">
              <input
                name="quietStart"
                type="time"
                defaultValue={quietHours?.start ?? ""}
                aria-label={t("people.detail.profileForm.quietStart")}
                className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
              />
              <span className="self-center text-xs text-ink-3">
                {t("common.to")}
              </span>
              <input
                name="quietEnd"
                type="time"
                defaultValue={quietHours?.end ?? ""}
                aria-label={t("people.detail.profileForm.quietEnd")}
                className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
              />
            </div>
          </fieldset>

          <div className="flex items-center gap-3 pt-1">
            <Button type="submit" variant="primary" disabled={pending}>
              {pending
                ? t("people.detail.profileForm.saving")
                : t("common.save")}
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
