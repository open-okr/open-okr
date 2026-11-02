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
import type { BrandingStatus } from "./branding-settings-form";
import { BrandingStudio } from "./branding-studio";

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

  const imageUrl = (slot: "logo" | "favicon") => {
    const id = branding[`${slot}BlobId`];
    return brandingImageUrl(typeof id === "string" ? id : null);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-bold text-ink">
          {t("admin.branding.branding")}
        </h1>
        <p className="max-w-prose text-sm text-ink-3">
          {t("admin.branding.intro")}
        </p>
      </div>
      {/* docs/design/branding-page.md: one card and its live mirror. */}
      <BrandingStudio
        status={status}
        logoUrl={imageUrl("logo")}
        faviconUrl={imageUrl("favicon")}
        workspaceName={workspace.name}
        initials={initialsOf(workspace.name)}
        rules={rules}
      />
    </div>
  );
}
