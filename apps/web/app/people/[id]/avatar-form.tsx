"use client";

import {
  Avatar,
  Button,
  Card,
  CardBody,
  CardHeader,
  useTranslations,
} from "@openokr/ui";
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
    <Card>
      <CardHeader>
        <h2 className="text-sm font-bold text-ink">
          {t("people.detail.avatarForm.yourPicture")}
        </h2>
      </CardHeader>
      <CardBody className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <Avatar
            name={name}
            src={avatarUrl}
            size="lg"
            className="size-12 text-base"
          />
          <p className="text-xs text-ink-3">
            {t("people.detail.avatarForm.everybodyInThisWorkspace")}
          </p>
        </div>
        <form
          action={upload}
          onSubmit={() => setRemoval(null)}
          className="flex flex-wrap items-center gap-2"
          aria-busy={uploading}
        >
          <label className="flex flex-col gap-1 text-xs text-ink-3">
            {t("people.detail.avatarForm.choosePicture")}
            <input
              name="avatar"
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              className="text-sm text-ink"
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
              disabled={uploading || removing}
              onClick={() =>
                startRemoving(async () => {
                  setRemoval(await removeAvatar());
                })
              }
            >
              {t("people.detail.avatarForm.removePicture")}
            </Button>
          ) : null}
        </form>
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
      </CardBody>
    </Card>
  );
}
