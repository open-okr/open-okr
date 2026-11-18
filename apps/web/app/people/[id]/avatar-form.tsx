"use client";

import { Avatar, Button, useTranslations } from "@openokr/ui";
import { useActionState, useState, useTransition } from "react";
import type { ProfileResult } from "../actions.ts";

/**
 * The signed-in member's own picture (screen S-33, completeness review M-22).
 *
 * REQUIREMENTS §4 lists the avatar among a profile's facts and nothing could
 * set one. The picture goes through the one upload path, so it is re-encoded
 * and given the thumbnail this card and the header show; the file input
 * offers only the four image types that path keeps.
 *
 * **Bare, since the account settings layout** (docs/design/
 * settings-page-layout.md): it draws no card of its own, because it sits in
 * the "Name and picture" card on Your account. It stays its own form, and it
 * applies at once, so it has no save bar.
 *
 * **Every state says itself.** Choosing nothing and pressing the button is a
 * sentence, a refusal is the action's own words in an alert, and while the
 * upload runs the button says so and cannot be pressed twice.
 */
export function AvatarForm({
  name,
  avatarUrl,
  uploadAvatar,
  removeAvatar,
}: {
  readonly name: string;
  /** The thumbnail's address, or null when there is no picture. */
  readonly avatarUrl: string | null;
  readonly uploadAvatar: (
    previous: ProfileResult | null,
    form: FormData,
  ) => Promise<ProfileResult>;
  readonly removeAvatar: () => Promise<ProfileResult>;
}) {
  const { t } = useTranslations();
  const [uploaded, upload, uploading] = useActionState(uploadAvatar, null);
  const [removal, setRemoval] = useState<ProfileResult | null>(null);
  const [removing, startRemoving] = useTransition();
  // Whichever happened last is what the card reports: an upload clears the
  // removal's answer as it starts.
  const state = removing || uploading ? null : (removal ?? uploaded);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <Avatar
          name={name}
          src={avatarUrl}
          size="lg"
          className="size-12 text-base"
        />
        <form
          action={upload}
          onSubmit={() => setRemoval(null)}
          className="flex flex-wrap items-center gap-2"
          aria-busy={uploading}
        >
          {/* Allowed to shrink: the native control's own width ran 4 px past
              a 390 px phone (UAT 0.8.0 F-11). */}
          <label className="flex min-w-0 max-w-full flex-col gap-1 text-xs text-ink-3">
            {t("people.detail.avatarForm.choosePicture")}
            <input
              name="avatar"
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              className="min-w-0 max-w-full text-sm text-ink"
            />
          </label>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={uploading || removing}
          >
            {uploading
              ? t("people.detail.avatarForm.uploading")
              : t("people.detail.avatarForm.usePicture")}
          </Button>
          {avatarUrl ? (
            <Button
              type="button"
              size="sm"
              disabled={uploading}
              pending={removing}
              onClick={() =>
                startRemoving(async () => {
                  setRemoval(await removeAvatar());
                })
              }
            >
              {t("people.detail.avatarForm.removePicture")}
            </Button>
          ) : null}
          <span className="rounded-full bg-raised px-2 text-xs font-semibold text-ink-3">
            {t("common.appliesAtOnce")}
          </span>
        </form>
      </div>
      {state?.ok === true ? (
        <p className="text-xs text-good" role="status">
          {state.message}
        </p>
      ) : null}
      {state?.ok === false ? (
        <p className="text-xs text-bad" role="alert">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
