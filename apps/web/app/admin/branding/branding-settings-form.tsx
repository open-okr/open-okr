"use client";

import { statusHueOf } from "@openokr/formats";
import { Button, ColourInput, useTranslations } from "@openokr/ui";
import { REFUSED_HUE } from "./branding-state.ts";

/**
 * The colour section of Branding (screen S-36, P2-T08, completeness review
 * M-14, docs/design/branding-page.md).
 *
 * **What it says is in force now is in force** (completeness review M-14). The
 * card said a saved colour was "in force across this workspace" while every
 * screen stayed indigo, because nothing read the setting. The root layout now
 * turns it into the brand tokens, so the sentence is true, and the section
 * says the two things it could otherwise hide: when the colour was too light
 * to carry white text and a darker shade was used, and when a stored colour is
 * a status hue and is not applied at all.
 *
 * **Part of the page's one form since the revamp.** The field posts with the
 * logo and the favicon when the page's Save is pressed, and the colour as it
 * was drawn travels beside it, so the server writes the colour only when it
 * changed. Reset is still this section's own button: it submits the same form
 * with `intent=reset`, which touches the colour alone.
 */

export interface BrandingStatus {
  /** The stored colour when it is a six-digit hex, otherwise null. */
  readonly stored: string | null;
  /** `--brand` as the layout applies it, or null when nothing is applied. */
  readonly fill: string | null;
  /** The chosen colour was too light for white text and was darkened. */
  readonly adjusted: boolean;
}

/** The product's own brand fill, `--brand` in tokens.css: what an empty field means. */
const PRODUCT_BRAND = "#4f46e5";

export function BrandingSettingsForm({
  status,
  error,
  disabled,
  resetting,
  onColourChange,
}: {
  status: BrandingStatus;
  /** Why the last save refused the colour, when it did. */
  error?: string | null;
  disabled?: boolean;
  /** The reset itself is what is being sent, so its button spins. */
  resetting?: boolean;
  /** A whole, accepted colour as it is typed or picked, for the mirror. */
  onColourChange?: (hex: string | null) => void;
}) {
  const { t } = useTranslations();

  const { stored, fill, adjusted } = status;
  const statusLine =
    stored === null
      ? `${t("admin.branding.brandingSettingsForm.productDefault", { colour: PRODUCT_BRAND })} ${t("admin.branding.brandingSettingsForm.emptyIsTheDefault")}`
      : fill === null
        ? t("admin.branding.brandingSettingsForm.notApplied", {
            colour: stored,
          })
        : adjusted
          ? t("admin.branding.brandingSettingsForm.adjusted", {
              colour: stored,
              fill,
            })
          : t("admin.branding.brandingSettingsForm.inForce", {
              colour: stored,
            });

  return (
    <section
      aria-labelledby="branding-colour-title"
      className="flex flex-col gap-3"
    >
      <h2 id="branding-colour-title" className="text-sm font-semibold text-ink">
        {t("admin.branding.colourTitle")}
      </h2>
      {/* What the field was drawn with, so the server can tell a change. */}
      <input type="hidden" name="storedColour" value={stored ?? ""} />
      {/* Picked or typed, and a status hue refused as it is chosen rather
          than after Save (guided-inputs §4.11). */}
      <ColourInput
        id="primaryColor"
        name="primaryColor"
        label={t("admin.branding.brandingSettingsForm.primaryColourHex")}
        defaultValue={stored ?? ""}
        description={statusLine}
        error={error ?? null}
        check={(hex) => {
          const family = statusHueOf(hex);
          return family === null
            ? null
            : t(REFUSED_HUE[family], { colour: hex });
        }}
        className="max-w-sm"
        fallback={fill ?? PRODUCT_BRAND}
        onValueChange={onColourChange}
        trailing={
          // The colour in force, drawn rather than described. It is the fill
          // the layout applies, which is not the typed colour when that one
          // was darkened. `aria-hidden` because the sentence below says the
          // same in text.
          <span
            aria-hidden
            data-testid="brand-swatch"
            className="size-7 flex-none rounded-control border border-line-2"
            style={{ backgroundColor: fill ?? PRODUCT_BRAND }}
          />
        }
      />
      <div>
        <Button
          type="submit"
          name="intent"
          value="reset"
          size="sm"
          disabled={disabled}
          pending={resetting}
          // Reset whatever the box holds, a refused colour included.
          formNoValidate
        >
          {t("common.resetToDefaults")}
        </Button>
      </div>
    </section>
  );
}
