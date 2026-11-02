"use client";

import { Card, CardBody } from "@openokr/ui";
import { useState } from "react";
import type { BrandingImageRules } from "../../../lib/branding-image.ts";
import { mirrorOf } from "../../../lib/branding-mirror.ts";
import { BrandingImageCard } from "./branding-image-card.tsx";
import { BrandingMirror } from "./branding-mirror.tsx";
import {
  BrandingSettingsForm,
  type BrandingStatus,
} from "./branding-settings-form.tsx";

/**
 * The Branding page's body (docs/design/branding-page.md §2): one card with
 * the colour, the logo and the favicon as three sections, because they make
 * one look, and beside it the live mirror of that look.
 *
 * Holds only what is chosen and not saved. What is stored arrives from the
 * server and comes back new after each save.
 */
export function BrandingStudio({
  status,
  logoUrl,
  faviconUrl,
  workspaceName,
  initials,
  rules,
}: {
  readonly status: BrandingStatus;
  readonly logoUrl: string | null;
  readonly faviconUrl: string | null;
  readonly workspaceName: string;
  readonly initials: string;
  readonly rules: BrandingImageRules;
}) {
  const [colour, setColour] = useState<string | null>(null);
  const [logo, setLogo] = useState<string | null>(null);
  const [favicon, setFavicon] = useState<string | null>(null);

  const mirror = mirrorOf(
    { stored: status.stored, fill: status.fill, logoUrl, faviconUrl },
    { colour, logoUrl: logo, faviconUrl: favicon },
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
        />
      </div>
      <Card className="lg:order-1">
        <CardBody className="flex flex-col gap-5">
          <BrandingSettingsForm status={status} onColourChange={setColour} />
          <div className="border-t border-line pt-5">
            <BrandingImageCard
              slot="logo"
              storedUrl={logoUrl}
              initials={initials}
              rules={rules}
              onChosen={setLogo}
            />
          </div>
          <div className="border-t border-line pt-5">
            <BrandingImageCard
              slot="favicon"
              storedUrl={faviconUrl}
              initials={initials}
              rules={rules}
              onChosen={setFavicon}
            />
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
