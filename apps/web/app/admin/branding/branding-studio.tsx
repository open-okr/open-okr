"use client";

import { Button, Card, CardBody, useTranslations } from "@openokr/ui";
import {
  type FormEvent,
  startTransition,
  useActionState,
  useState,
} from "react";
import type { BrandingImageRules } from "../../../lib/branding-image.ts";
import { mirrorOf } from "../../../lib/branding-mirror.ts";
import { saveBranding } from "./actions.ts";
import { BrandingImageCard } from "./branding-image-card.tsx";
import { BrandingMirror } from "./branding-mirror.tsx";
import {
  BrandingSettingsForm,
  type BrandingStatus,
} from "./branding-settings-form.tsx";
import {
  type BrandingImageResult,
  type BrandingImageSlot,
  type BrandingState,
  NOTHING_SAVED,
} from "./branding-state.ts";

/**
 * The Branding page's body (docs/design/branding-page.md §2, §3): the live
 * mirror across the top, then one form holding the colour, the logo and the
 * favicon as three columns of one card, then the page's one Save.
 *
 * **Save follows the fields.** It sits in a bar under the card that sticks to
 * the bottom of the window while the card is in view, and says what is not
 * saved yet. On a phone the order is preview, fields, Save, so Save is never
 * met before what it saves.
 *
 * **Keyed on what is stored.** A save that wrote anything comes back with new
 * stored values, which remounts the form: the field shows the saved colour,
 * the pickers are empty, and nothing is pending any more.
 */

const FORM_ID = "branding-form";

const PART = {
  colour: "admin.branding.mirror.part.colour",
  logo: "admin.branding.mirror.part.logo",
  favicon: "admin.branding.mirror.part.favicon",
} as const;

interface Props {
  readonly status: BrandingStatus;
  readonly logoUrl: string | null;
  readonly faviconUrl: string | null;
  readonly workspaceName: string;
  readonly initials: string;
  readonly rules: BrandingImageRules;
}

export function BrandingStudio(props: Props) {
  // Outside the keyed body, so "Saved." and "Removed." outlive the remount
  // they cause.
  const [state, formAction, pending] = useActionState(
    saveBranding,
    NOTHING_SAVED,
  );
  const [removal, setRemoval] = useState<Removal | null>(null);
  return (
    <StudioBody
      key={`${props.status.stored ?? ""}|${props.logoUrl ?? ""}|${props.faviconUrl ?? ""}`}
      {...props}
      state={state}
      formAction={formAction}
      pending={pending}
      removal={removal}
      onRemoval={setRemoval}
    />
  );
}

interface Removal {
  readonly slot: BrandingImageSlot;
  readonly result: BrandingImageResult;
}

function StudioBody({
  status,
  logoUrl,
  faviconUrl,
  workspaceName,
  initials,
  rules,
  state,
  formAction,
  pending,
  removal,
  onRemoval,
}: Props & {
  readonly state: BrandingState;
  readonly formAction: (data: FormData) => void;
  readonly pending: boolean;
  readonly removal: Removal | null;
  readonly onRemoval: (removal: Removal | null) => void;
}) {
  const { t } = useTranslations();
  const [colour, setColour] = useState<string | null>(null);
  const [logo, setLogo] = useState<string | null>(null);
  const [favicon, setFavicon] = useState<string | null>(null);
  // Bumped by Discard, so the two picture sections forget their files.
  const [discarded, setDiscarded] = useState(0);

  const mirror = mirrorOf(
    { stored: status.stored, fill: status.fill, logoUrl, faviconUrl },
    { colour, logoUrl: logo, faviconUrl: favicon },
  );

  // Carries the pressed button's `intent`, which a FormData built from the
  // form alone would leave out. A transition, so a refused colour stays in
  // the field under the sentence explaining why.
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const data = new FormData(event.currentTarget, submitter);
    onRemoval(null);
    startTransition(() => formAction(data));
  };

  const unsaved = mirror.unsaved.map((part) => t(PART[part]));

  return (
    <div className="flex flex-col gap-4">
      <BrandingMirror
        mirror={mirror}
        workspaceName={workspaceName}
        initials={initials}
      />
      <Card>
        <CardBody>
          <form
            id={FORM_ID}
            onSubmit={submit}
            onReset={() => {
              setColour(null);
              setDiscarded((count) => count + 1);
            }}
            aria-busy={pending}
            className="grid gap-5 lg:grid-cols-3 lg:gap-0"
          >
            <div className="lg:pr-5">
              <BrandingSettingsForm
                status={status}
                disabled={pending}
                onColourChange={setColour}
              />
            </div>
            <div className="border-t border-line pt-5 lg:border-t-0 lg:border-l lg:px-5 lg:pt-0">
              <BrandingImageCard
                key={`logo-${discarded}`}
                slot="logo"
                storedUrl={logoUrl}
                initials={initials}
                rules={rules}
                disabled={pending}
                onChosen={setLogo}
                removal={removal?.slot === "logo" ? removal.result : null}
                onRemoval={(result) =>
                  onRemoval(result ? { slot: "logo", result } : null)
                }
              />
            </div>
            <div className="border-t border-line pt-5 lg:border-t-0 lg:border-l lg:pl-5 lg:pt-0">
              <BrandingImageCard
                key={`favicon-${discarded}`}
                slot="favicon"
                storedUrl={faviconUrl}
                initials={initials}
                rules={rules}
                disabled={pending}
                onChosen={setFavicon}
                removal={removal?.slot === "favicon" ? removal.result : null}
                onRemoval={(result) =>
                  onRemoval(result ? { slot: "favicon", result } : null)
                }
              />
            </div>
          </form>
        </CardBody>
      </Card>
      <div
        data-testid="branding-save-bar"
        className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface px-4 py-3"
      >
        <div className="flex min-w-0 flex-col gap-0.5">
          {unsaved.length > 0 ||
          state.saved !== null ||
          state.error !== null ? null : (
            <p className="text-sm text-ink-3">
              {t("admin.branding.nothingChanged")}
            </p>
          )}
          <p
            role="status"
            className="text-sm font-medium text-ink"
            data-testid="branding-mirror-unsaved"
          >
            {unsaved.length > 0
              ? t("admin.branding.mirror.notSaved", {
                  parts: unsaved.join(", "),
                })
              : ""}
          </p>
          {state.saved === null ? null : (
            <p role="status" className="text-xs text-ink-2">
              {state.saved}
            </p>
          )}
          {state.error === null ? null : (
            <p role="alert" className="text-xs text-bad">
              {state.error}
            </p>
          )}
        </div>
        <div className="flex flex-none items-center gap-2">
          <Button
            type="reset"
            form={FORM_ID}
            variant="ghost"
            size="sm"
            disabled={pending || mirror.unsaved.length === 0}
          >
            {t("admin.branding.discard")}
          </Button>
          <Button
            type="submit"
            form={FORM_ID}
            name="intent"
            value="save"
            variant="primary"
            size="sm"
            disabled={pending}
          >
            {pending
              ? t("admin.branding.images.saving")
              : t("admin.branding.saveChanges")}
          </Button>
        </div>
      </div>
    </div>
  );
}
