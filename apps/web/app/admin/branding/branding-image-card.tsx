"use client";

import {
  Button,
  Card,
  CardBody,
  CardHeader,
  useTranslations,
} from "@openokr/ui";
import {
  useActionState,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  type BrandingImageRules,
  brandingImageProblem,
} from "../../../lib/branding-image.ts";
import { removeBrandingImage, uploadBrandingImage } from "./actions.ts";
import type {
  BrandingImageResult,
  BrandingImageSlot,
} from "./branding-state.ts";

/**
 * The logo card and the favicon card on Branding (screen S-36,
 * docs/design/workspace-logo-favicon.md §3).
 *
 * **The preview is drawn before anything is sent.** The chosen file is read
 * in the browser through an object URL and shown where it will appear, so an
 * administrator sees a logo that vanishes on the dark theme, or a favicon that
 * is a smudge at 16 pixels, before it reaches every member. Save sends it;
 * Cancel forgets it.
 *
 * **The mocks carry their own colours.** A light and a dark sidebar are shown
 * side by side whatever theme the administrator is in, which the theme tokens
 * cannot do: they follow the page.
 */

const SAVE_LABEL = {
  logo: "admin.branding.images.logoTitle",
  favicon: "admin.branding.images.faviconTitle",
} as const;

export function BrandingImageCard({
  slot,
  storedUrl,
  workspaceName,
  initials,
  rules,
}: {
  readonly slot: BrandingImageSlot;
  /** The stored picture's address, or null for the default. */
  readonly storedUrl: string | null;
  readonly workspaceName: string;
  /** The tile the sidebar draws when there is no logo. */
  readonly initials: string;
  readonly rules: BrandingImageRules;
}) {
  const { t } = useTranslations();
  const input = useRef<HTMLInputElement>(null);
  const [chosen, setChosen] = useState<{
    url: string;
    name: string;
    size: number;
  } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [uploaded, upload, uploading] = useActionState(
    uploadBrandingImage,
    null,
  );
  const [removal, setRemoval] = useState<BrandingImageResult | null>(null);
  const [removing, startRemoving] = useTransition();

  // An object URL holds the file in memory until it is revoked.
  useEffect(() => {
    if (!chosen) {
      return;
    }
    return () => URL.revokeObjectURL(chosen.url);
  }, [chosen]);

  // A saved picture is now the stored one, so the preview has done its job.
  useEffect(() => {
    if (uploaded?.ok) {
      setChosen(null);
      if (input.current) {
        input.current.value = "";
      }
    }
  }, [uploaded]);

  const forget = () => {
    setChosen(null);
    setProblem(null);
    if (input.current) {
      input.current.value = "";
    }
  };

  const choose = (file: File | undefined) => {
    setRemoval(null);
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

  const busy = uploading || removing;
  const answer = busy ? null : (removal ?? uploaded);

  return (
    <Card data-testid={`branding-${slot}`}>
      <CardHeader>
        <h2 className="text-sm font-bold text-ink">{t(SAVE_LABEL[slot])}</h2>
      </CardHeader>
      <CardBody className="flex flex-col gap-3">
        <p className="text-xs text-ink-3">
          {t(
            slot === "logo"
              ? "admin.branding.images.logoHint"
              : "admin.branding.images.faviconHint",
          )}
        </p>

        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold text-ink-3">
            {t("admin.branding.images.inUse")}
          </span>
          {slot === "logo" ? (
            <LogoTile url={storedUrl} initials={initials} />
          ) : (
            // The product's own icon is the default tab icon.
            // biome-ignore lint/performance/noImgElement: a stored blob behind the session cookie, which next/image cannot fetch.
            <img
              src={storedUrl ?? "/icon.svg"}
              alt=""
              className="size-8 rounded-control object-contain"
            />
          )}
          {storedUrl === null ? (
            <span className="text-xs text-ink-4">
              {t("admin.branding.images.default")}
            </span>
          ) : null}
        </div>

        <form
          action={upload}
          className="flex flex-col gap-3"
          aria-busy={uploading}
        >
          <input type="hidden" name="slot" value={slot} />
          <label className="flex flex-col gap-1 text-xs text-ink-3">
            {storedUrl
              ? t("admin.branding.images.replace")
              : t("admin.branding.images.choose")}
            <input
              ref={input}
              name="image"
              type="file"
              accept={rules.types.join(",")}
              onChange={(event) => choose(event.currentTarget.files?.[0])}
              className="text-sm text-ink"
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
              className="flex flex-col gap-3 rounded-lg border border-line bg-raised p-3"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-bold text-ink">
                  {t("admin.branding.images.preview")}
                </span>
                <span className="truncate text-xs text-ink-3">
                  {t("admin.branding.images.fileSummary", {
                    name: chosen.name,
                    size: Math.max(1, Math.round(chosen.size / 1024)),
                  })}
                </span>
              </div>
              {slot === "logo" ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  <SidebarMock
                    url={chosen.url}
                    name={workspaceName}
                    label={t("admin.branding.images.light")}
                    dark={false}
                  />
                  <SidebarMock
                    url={chosen.url}
                    name={workspaceName}
                    label={t("admin.branding.images.dark")}
                    dark
                  />
                </div>
              ) : (
                <TabMock
                  url={chosen.url}
                  name={workspaceName}
                  label={t("admin.branding.images.browserTab")}
                />
              )}
              <div className="flex gap-2">
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={busy}
                >
                  {uploading
                    ? t("admin.branding.images.saving")
                    : t("admin.branding.images.save")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={busy}
                  onClick={forget}
                >
                  {t("admin.branding.images.cancel")}
                </Button>
              </div>
            </div>
          ) : null}
        </form>

        {storedUrl && !chosen ? (
          <div>
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={() =>
                startRemoving(async () => {
                  setRemoval(await removeBrandingImage(slot));
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
      </CardBody>
    </Card>
  );
}

/** The sidebar's 28-pixel brandmark, with the logo or the initials. */
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
      className="grid size-7 flex-none place-items-center rounded-control bg-brand text-sm font-extrabold text-on-brand"
    >
      {initials}
    </span>
  );
}

function SidebarMock({
  url,
  name,
  label,
  dark,
}: {
  readonly url: string;
  readonly name: string;
  readonly label: string;
  readonly dark: boolean;
}) {
  return (
    <figure className="flex flex-col gap-1">
      <div
        className={
          dark
            ? "flex items-center gap-2 rounded-md border border-[#2a2f3a] bg-[#14161c] p-2 text-[#f3f4f6]"
            : "flex items-center gap-2 rounded-md border border-[#e5e7eb] bg-[#f8fafc] p-2 text-[#111827]"
        }
      >
        {/* biome-ignore lint/performance/noImgElement: an object URL of a file not yet uploaded, which next/image cannot load. */}
        <img
          src={url}
          alt=""
          className="size-7 flex-none rounded-[8px] object-contain"
        />
        <span className="truncate text-sm font-semibold">{name}</span>
      </div>
      <figcaption className="text-xs text-ink-4">{label}</figcaption>
    </figure>
  );
}

function TabMock({
  url,
  name,
  label,
}: {
  readonly url: string;
  readonly name: string;
  readonly label: string;
}) {
  return (
    <figure className="flex flex-col gap-1">
      <div className="flex items-end gap-3">
        <div className="flex w-56 items-center gap-2 rounded-t-lg border border-b-0 border-[#d1d5db] bg-white px-3 py-2 text-[#111827]">
          {/* biome-ignore lint/performance/noImgElement: an object URL of a file not yet uploaded, which next/image cannot load. */}
          <img src={url} alt="" className="size-4 flex-none object-contain" />
          <span className="truncate text-xs">{name}</span>
        </div>
        {/* biome-ignore lint/performance/noImgElement: an object URL of a file not yet uploaded, which next/image cannot load. */}
        <img src={url} alt="" className="size-8 object-contain" />
      </div>
      <figcaption className="text-xs text-ink-4">{label}</figcaption>
    </figure>
  );
}
