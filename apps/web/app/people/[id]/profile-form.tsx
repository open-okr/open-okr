"use client";

import {
  Card,
  CardBody,
  CardHeader,
  RefusedFields,
  RichTextField,
  SelectInput,
  SettingsSaveBar,
  TimeRangeInput,
  TimezoneSelect,
  useTranslations,
} from "@openokr/ui";
import {
  type FormEvent,
  startTransition,
  useActionState,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ProfileResult } from "../actions.ts";

const FORM_ID = "profile-details-form";

type Part = "timezone" | "channel" | "quiet" | "bio";

/**
 * The self-edit form on Your account (P6-G09, screen S-33), the "Profile
 * details" card.
 *
 * Timezone, primary channel, quiet hours and the bio. **The bio is rich text**
 * (TECHNICAL-PLAN §4.1 names `bio` as rich), so it is written in the compact
 * rich text field and validated again at the action's boundary. It
 * was deferred at P6-G09 and nothing else could edit it, which completeness
 * review M-22 recorded. No mentions and no attachments: a bio is a few lines
 * about somebody, and a picture of them is the picture row's.
 *
 * **Sent only when it changed.** Every save writes a new bio version, so a
 * form that sent the bio whenever somebody changed their timezone would
 * version a bio nobody touched.
 *
 * **Footer-saved** (docs/design/settings-page-layout.md): the save bar is the
 * card's last child and names what is unsaved. The form is submitted through a
 * transition, because React resets a form after its action and a refusal
 * should keep what was typed.
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
  const [dirty, setDirty] = useState<ReadonlySet<Part>>(new Set());
  // Bumped by Discard, so the timezone list starts again from what is stored.
  const [discarded, setDiscarded] = useState(0);
  // Bumped by Discard and by a save, so the bio editor starts again from what
  // is stored.
  const [generation, setGeneration] = useState(0);
  const bioBox = useRef<HTMLDivElement>(null);

  const mark = useCallback(
    (part: Part, isChanged: boolean) =>
      setDirty((current) => {
        if (current.has(part) === isChanged) {
          return current;
        }
        const next = new Set(current);
        if (isChanged) {
          next.add(part);
        } else {
          next.delete(part);
        }
        return next;
      }),
    [],
  );

  // The bio field sends nothing until it is edited, so its hidden input
  // appearing is the sign that the bio changed.
  useEffect(() => {
    const box = bioBox.current;
    if (!box) {
      return undefined;
    }
    const watch = new MutationObserver(() =>
      mark("bio", box.querySelector('input[name="bio"]') !== null),
    );
    watch.observe(box, { childList: true, subtree: true });
    return () => watch.disconnect();
  }, [mark]);

  // A saved form has nothing unsaved. The bio field starts again, so the next
  // save does not send an unchanged bio.
  useEffect(() => {
    if (state?.ok) {
      setDirty(new Set());
      setGeneration((count) => count + 1);
    }
  }, [state]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => action(data));
  };

  const labels: Record<Part, string> = {
    timezone: t("common.timezone"),
    channel: t("common.primaryChannel"),
    quiet: t("people.detail.profileForm.quietHoursLeaveEmpty"),
    bio: t("people.detail.bio"),
  };
  const unsaved = (["timezone", "channel", "quiet", "bio"] as const)
    .filter((part) => dirty.has(part))
    .map((part) => labels[part]);

  return (
    <Card data-testid="profile-card">
      <CardHeader>
        <div className="flex flex-col gap-0.5">
          <h2 className="text-sm font-semibold text-ink">
            {t("account.profile.details")}
          </h2>
          <p className="text-xs text-ink-3">
            {t("account.profile.detailsHint")}
          </p>
        </div>
      </CardHeader>
      <CardBody>
        <form
          id={FORM_ID}
          action={action}
          onSubmit={submit}
          onReset={() => {
            setDirty(new Set());
            setDiscarded((count) => count + 1);
            setGeneration((count) => count + 1);
          }}
          aria-busy={pending}
          className="grid grid-cols-12 gap-x-6 gap-y-4 [&>ul]:col-span-12"
        >
          <input type="hidden" name="memberId" value={memberId} />

          {/* Each field shows what was refused about it (U1b). */}
          <RefusedFields fields={state?.fields}>
            <div className="col-span-12 md:col-span-6">
              <TimezoneSelect
                key={`timezone-${discarded}`}
                label={t("common.timezone")}
                name="timezone"
                zones={zones}
                defaultValue={timezone}
                onValueChange={(zone) =>
                  mark("timezone", (zone ?? null) !== (timezone ?? null))
                }
              />
            </div>

            <SelectInput
              label={t("common.primaryChannel")}
              name="primaryChannel"
              defaultValue={primaryChannel ?? "app"}
              className="col-span-12 md:col-span-6"
              onChange={(event) =>
                mark(
                  "channel",
                  event.currentTarget.value !== (primaryChannel ?? "app"),
                )
              }
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
            </SelectInput>

            <TimeRangeInput
              label={t("people.detail.profileForm.quietHoursLeaveEmpty")}
              startLabel={t("people.detail.profileForm.quietStart")}
              endLabel={t("people.detail.profileForm.quietEnd")}
              startName="quietStart"
              endName="quietEnd"
              defaultValue={quietHours ?? null}
              layout="grid"
              className="col-span-12"
              onValueChange={(range) =>
                mark(
                  "quiet",
                  (range.start ?? "") !== (quietHours?.start ?? "") ||
                    (range.end ?? "") !== (quietHours?.end ?? ""),
                )
              }
            />

            <div ref={bioBox} className="col-span-12">
              <RichTextField
                key={`bio-${generation}`}
                label={t("people.detail.bio")}
                name="bio"
                content={bio ?? null}
                placeholder={t("people.detail.profileForm.aFewLinesAbout")}
                description={t("people.detail.profileForm.emptyTheBioTo")}
              />
            </div>
          </RefusedFields>
        </form>
      </CardBody>
      <SettingsSaveBar
        mode="footer"
        formId={FORM_ID}
        unsaved={unsaved}
        saved={state?.ok === true ? state.message : null}
        error={state?.ok === false && !state.fields ? state.message : null}
        pending={pending}
      />
    </Card>
  );
}
