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
import { type BrandingState, NOTHING_SAVED } from "./branding-state.ts";

/**
 * The Branding page's body (docs/design/branding-page.md §2, §3): one form
 * holding the colour, the logo and the favicon as three sections of one card,
 * and beside it the live mirror with the page's one Save.
 *
 * **One Save, beside what it saves.** The mirror lists what is not saved yet,
 * and Save and Discard sit under that list. They belong to the form through
 * the `form` attribute, so they can live in the preview panel.
 *
 * **Keyed on what is stored.** A save that wrote anything comes back with new
 * stored values, which remounts the form: the field shows the saved colour,
 * the pickers are empty, and nothing is pending any more.
 */

const FORM_ID = "branding-form";

interface Props {
  readonly status: BrandingStatus;
  readonly logoUrl: string | null;
  readonly faviconUrl: string | null;
  readonly workspaceName: string;
  readonly initials: string;
  readonly rules: BrandingImageRules;
}

export function BrandingStudio(props: Props) {
  // Outside the keyed body, so "Saved." outlives the remount it causes.
  const [state, formAction, pending] = useActionState(
    saveBranding,
    NOTHING_SAVED,
  );
  return (
    <StudioBody
      key={`${props.status.stored ?? ""}|${props.logoUrl ?? ""}|${props.faviconUrl ?? ""}`}
      {...props}
      state={state}
      formAction={formAction}
      pending={pending}
    />
  );
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
}: Props & {
  readonly state: BrandingState;
  readonly formAction: (data: FormData) => void;
  readonly pending: boolean;
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
    startTransition(() => formAction(data));
  };

  const actions = (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
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
        <Button
          type="reset"
          form={FORM_ID}
          variant="ghost"
          size="sm"
          disabled={pending || mirror.unsaved.length === 0}
        >
          {t("admin.branding.discard")}
        </Button>
      </div>
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
  );

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      {/* Below 1024 px the preview comes first, so a change is seen above
          the control that made it. */}
      <div className="lg:sticky lg:top-4 lg:order-2">
        <BrandingMirror
          mirror={mirror}
          workspaceName={workspaceName}
          initials={initials}
          actions={actions}
        />
      </div>
      <Card className="lg:order-1">
        <CardBody>
          <form
            id={FORM_ID}
            onSubmit={submit}
            onReset={() => {
              setColour(null);
              setDiscarded((count) => count + 1);
            }}
            aria-busy={pending}
            className="flex flex-col gap-5"
          >
            <BrandingSettingsForm
              status={status}
              disabled={pending}
              onColourChange={setColour}
            />
            <div className="border-t border-line pt-5">
              <BrandingImageCard
                key={`logo-${discarded}`}
                slot="logo"
                storedUrl={logoUrl}
                initials={initials}
                rules={rules}
                disabled={pending}
                onChosen={setLogo}
              />
            </div>
            <div className="border-t border-line pt-5">
              <BrandingImageCard
                key={`favicon-${discarded}`}
                slot="favicon"
                storedUrl={faviconUrl}
                initials={initials}
                rules={rules}
                disabled={pending}
                onChosen={setFavicon}
              />
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
