import {
  BRANDING_IMAGE_MAX_BYTES,
  BRANDING_IMAGE_TYPES,
  callAction,
  deriveBrandPalette,
} from "@openokr/core";
import { HEX_COLOUR_PATTERN } from "@openokr/formats";
import { getPool } from "../../../lib/auth";
import { brandingImageUrl } from "../../../lib/branding-image";
import { getTranslations } from "../../../lib/translations";
import { requireWorkspace } from "../../../lib/workspace";
import { initialsOf } from "../../../lib/workspace-initials";
import { BrandingImageCard } from "./branding-image-card";
import {
  BrandingSettingsForm,
  type BrandingStatus,
} from "./branding-settings-form";

/**
 * Matched before a stored value is used, never after. It reaches an inline
 * `style` as the swatch, and a colour that has not been matched against this
 * is a string from the database going into CSS.
 */
const HEX = HEX_COLOUR_PATTERN;

export default async function BrandingSettingsPage() {
  const { t } = await getTranslations();

  const { session, workspace } = await requireWorkspace();
  const read = await callAction(
    {
      pool: getPool(),
      workspaceId: workspace.workspaceId,
      actor: { kind: "human", userId: session.user.id },
    },
    "settings.readWorkspaceSettings",
    {},
  );

  // Worked out with the same function the root layout applies, so what the
  // card says is in force is what every screen is drawn in (M-14).
  const branding = (read.settings.branding as Record<string, unknown>) ?? {};
  const colour = String(branding.primaryColor ?? "");
  const stored = HEX.test(colour) ? colour : null;
  const palette = stored === null ? null : deriveBrandPalette(stored);
  const status: BrandingStatus = {
    stored,
    fill: palette?.fill ?? null,
    adjusted: palette?.adjusted ?? false,
  };

  const rules = {
    types: [...BRANDING_IMAGE_TYPES],
    maxBytes: BRANDING_IMAGE_MAX_BYTES,
  };

  return (
    <>
      <h1 className="text-lg font-bold text-ink">
        {t("admin.branding.branding")}
      </h1>
      <BrandingSettingsForm status={status} />
      {/* docs/design/workspace-logo-favicon.md §3. */}
      {(["logo", "favicon"] as const).map((slot) => {
        const id = branding[`${slot}BlobId`];
        return (
          <BrandingImageCard
            key={slot}
            slot={slot}
            storedUrl={brandingImageUrl(typeof id === "string" ? id : null)}
            workspaceName={workspace.name}
            initials={initialsOf(workspace.name)}
            rules={rules}
          />
        );
      })}
    </>
  );
}
