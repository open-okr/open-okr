"use client";

import { Button, useTranslations } from "@openokr/ui";
import { ImageUp } from "lucide-react";
import {
  type DragEvent,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  type BrandingImageRules,
  brandingImageProblem,
} from "../../../lib/branding-image.ts";
import { removeBrandingImage } from "./actions.ts";
import type {
  BrandingImageResult,
  BrandingImageSlot,
} from "./branding-state.ts";

/**
 * The logo section and the favicon section of Branding (screen S-36,
 * docs/design/workspace-logo-favicon.md §3, docs/design/branding-page.md §3).
 *
 * **A chosen file is shown before anything is sent.** It is read in the
 * browser through an object URL and handed to the page's mirror, which draws
 * it in a light and a dark sidebar or a browser tab. The page's one Save
 * sends it with the colour and the other picture; Cancel forgets it.
 *
 * **The drop zone is the file picker.** A label wraps the file input, so a
 * click, Enter or Space opens the picker and the label names the control; a
 * file dragged onto it is put into the same input, so Save posts it either
 * way.
 */

const TITLE = {
  logo: "admin.branding.images.logoTitle",
  favicon: "admin.branding.images.faviconTitle",
} as const;

const HINT = {
  logo: "admin.branding.images.logoHint",
  favicon: "admin.branding.images.faviconHint",
} as const;

export function BrandingImageCard({
  slot,
  storedUrl,
  initials,
  rules,
  onChosen,
  disabled,
  removal = null,
  onRemoval,
}: {
  readonly slot: BrandingImageSlot;
  /** The stored picture's address, or null for the default. */
  readonly storedUrl: string | null;
  /** The tile the sidebar draws when there is no logo. */
  readonly initials: string;
  readonly rules: BrandingImageRules;
  /** An object URL of the chosen, unsaved file, or null when none is. */
  readonly onChosen?: (url: string | null) => void;
  /** While the page saves, nothing here may change under it. */
  readonly disabled?: boolean;
  /**
   * What the last Remove answered. Held by the page rather than here, because
   * a removal changes what is stored and that remounts this section.
   */
  readonly removal?: BrandingImageResult | null;
  readonly onRemoval?: (result: BrandingImageResult | null) => void;
}) {
  const { t } = useTranslations();
  const input = useRef<HTMLInputElement>(null);
  const [chosen, setChosen] = useState<{
    url: string;
    name: string;
    size: number;
  } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [removing, startRemoving] = useTransition();

  // An object URL holds the file in memory until it is revoked.
  useEffect(() => {
    if (!chosen) {
      return;
    }
    return () => URL.revokeObjectURL(chosen.url);
  }, [chosen]);

  useEffect(() => {
    onChosen?.(chosen?.url ?? null);
  }, [chosen, onChosen]);

  const forget = () => {
    setChosen(null);
    setProblem(null);
    if (input.current) {
      input.current.value = "";
    }
  };

  const choose = (file: File | undefined) => {
    onRemoval?.(null);
    if (!file) {
      forget();
      return;
    }
    const why = brandingImageProblem(file, rules);
    if (why !== null) {
      forget();
      setProblem(
        t(
          why === "type"
            ? "admin.branding.images.wrongType"
            : why === "size"
              ? "admin.branding.images.tooLarge"
              : "admin.branding.images.chooseFirst",
        ),
      );
      return;
    }
    setProblem(null);
    setChosen({
      url: URL.createObjectURL(file),
      name: file.name,
      size: file.size,
    });
  };

  const drop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setOver(false);
    const file = event.dataTransfer.files[0];
    if (!file || !input.current) {
      return;
    }
    // Into the input itself, so the form posts the dropped file on Save.
    const carried = new DataTransfer();
    carried.items.add(file);
    input.current.files = carried.files;
    choose(file);
  };

  const busy = disabled || removing;
  const answer = busy ? null : removal;

  return (
    <section
      data-testid={`branding-${slot}`}
      aria-labelledby={`branding-${slot}-title`}
      className="flex flex-col gap-3"
    >
      {/* Title and what is in use on one line, the hint under both at full
          width, so the two picture columns line up. */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-3">
          <h2
            id={`branding-${slot}-title`}
            className="text-sm font-semibold text-ink"
          >
            {t(TITLE[slot])}
          </h2>
          <div className="flex flex-none items-center gap-2">
            {slot === "logo" ? (
              <LogoTile url={storedUrl} initials={initials} />
            ) : (
              // biome-ignore lint/performance/noImgElement: a stored blob behind the session cookie, which next/image cannot fetch.
              <img
                src={storedUrl ?? "/icon.svg"}
                alt=""
                className="size-7 rounded-control object-contain"
              />
            )}
            <span className="text-xs text-ink-3">
              {storedUrl === null
                ? t("admin.branding.images.default")
                : t("admin.branding.images.inUse")}
            </span>
          </div>
        </div>
        <p className="max-w-prose text-xs text-ink-3">{t(HINT[slot])}</p>
      </div>

      <div className="flex flex-col gap-2">
        <label
          onDragOver={(event) => {
            event.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={drop}
          className={`flex cursor-pointer items-center gap-3 rounded-control border border-dashed px-3 py-3 transition-colors duration-150 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand-strong motion-reduce:transition-none ${
            over
              ? "border-brand bg-brand-weak"
              : "border-line-2 bg-raised hover:border-ink-4"
          }`}
        >
          <ImageUp aria-hidden="true" className="size-5 flex-none text-ink-3" />
          <span className="flex flex-col">
            <span className="text-sm font-medium text-ink">
              {storedUrl
                ? t("admin.branding.images.replace")
                : t("admin.branding.images.choose")}
            </span>
            <span className="text-xs text-ink-3">
              {t("admin.branding.images.dropHint")}
            </span>
          </span>
          <input
            ref={input}
            name={slot}
            disabled={busy}
            type="file"
            accept={rules.types.join(",")}
            onChange={(event) => choose(event.currentTarget.files?.[0])}
            className="sr-only"
          />
        </label>

        {problem ? (
          <p role="alert" className="text-xs text-bad">
            {problem}
          </p>
        ) : null}

        {chosen ? (
          <div
            data-testid={`branding-${slot}-preview`}
            className="flex flex-wrap items-center gap-2"
          >
            <span className="min-w-0 flex-1 truncate text-xs text-ink-3">
              {t("admin.branding.images.fileSummary", {
                name: chosen.name,
                size: Math.max(1, Math.round(chosen.size / 1024)),
              })}
            </span>
            <Button type="button" size="sm" disabled={busy} onClick={forget}>
              {t("admin.branding.images.cancel")}
            </Button>
          </div>
        ) : null}
      </div>

      {storedUrl && !chosen ? (
        <div>
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={() =>
              startRemoving(async () => {
                onRemoval?.(await removeBrandingImage(slot));
              })
            }
          >
            {t("admin.branding.images.remove")}
          </Button>
        </div>
      ) : null}

      {answer?.ok === true ? (
        <p role="status" className="text-xs text-good">
          {answer.message}
        </p>
      ) : null}
      {answer?.ok === false ? (
        <p role="alert" className="text-xs text-bad">
          {answer.message}
        </p>
      ) : null}
    </section>
  );
}

/** The sidebar's brandmark, with the logo or the initials. */
function LogoTile({
  url,
  initials,
}: {
  readonly url: string | null;
  readonly initials: string;
}) {
  if (url) {
    return (
      // biome-ignore lint/performance/noImgElement: a stored blob behind the session cookie, which next/image cannot fetch.
      <img
        src={url}
        alt=""
        className="size-7 flex-none rounded-control object-contain"
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="grid size-7 flex-none place-items-center rounded-control bg-brand text-xs font-extrabold text-on-brand"
    >
      {initials}
    </span>
  );
}
