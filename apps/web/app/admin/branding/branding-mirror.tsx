"use client";

import { useTranslations } from "@openokr/ui";
import type { CSSProperties } from "react";
import type { Mirror } from "../../../lib/branding-mirror.ts";

/**
 * The live mirror on Branding (docs/design/branding-page.md §2): a copy of
 * this workspace's own screen, sidebar and content, in light and dark side by
 * side, drawn with whatever is chosen before it is saved.
 *
 * **The width of the page, above the settings.** It sat in a 20rem column
 * beside them, where each frame was a thumbnail nobody could read (owner
 * review, 2 November 2026). Each frame is now about half the content width.
 *
 * **Both themes whatever the page is in.** The tokens are `@theme inline`, so
 * a utility reads the custom property where it is used: each frame sets the
 * theme's own values on itself and everything inside follows. The values are
 * the light and dark blocks of `packages/ui/src/styles/tokens.css`.
 */

const LIGHT = {
  "--surface": "#ffffff",
  "--raised": "#eff3f9",
  "--line": "#e4e9f2",
  "--ink": "#0f172a",
  "--ink-3": "#55637a",
} as const;

const DARK = {
  "--surface": "#111827",
  "--raised": "#1a2332",
  "--line": "#1e293b",
  "--ink": "#f1f5f9",
  "--ink-3": "#94a3b8",
} as const;

export function BrandingMirror({
  mirror,
  workspaceName,
  initials,
}: {
  readonly mirror: Mirror;
  readonly workspaceName: string;
  readonly initials: string;
}) {
  const { t } = useTranslations();
  // Only the fill is overridden: the stops derived from it are the layout's
  // business once the colour is saved.
  const brand: Record<string, string> = mirror.brand
    ? { "--brand": mirror.brand }
    : {};

  return (
    <section
      aria-labelledby="branding-mirror-title"
      data-testid="branding-mirror"
      className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2
          id="branding-mirror-title"
          className="text-sm font-semibold text-ink"
        >
          {t("admin.branding.images.preview")}
        </h2>
        <figure className="flex items-center gap-2">
          <figcaption className="text-xs text-ink-4">
            {t("admin.branding.images.browserTab")}
          </figcaption>
          <div
            style={LIGHT as CSSProperties}
            className="flex w-44 items-center gap-2 rounded-t-control border border-b-0 border-line bg-surface px-3 py-1.5 text-ink"
          >
            {/* biome-ignore lint/performance/noImgElement: a stored blob or an object URL, which next/image cannot load. */}
            <img
              src={mirror.faviconUrl ?? "/icon.svg"}
              alt=""
              className="size-4 flex-none object-contain"
            />
            <span className="truncate text-xs">{workspaceName}</span>
          </div>
          {/* The same icon at 32 pixels, where a pinned tab or a bookmark
              shows it. */}
          {/* biome-ignore lint/performance/noImgElement: a stored blob or an object URL, which next/image cannot load. */}
          <img
            src={mirror.faviconUrl ?? "/icon.svg"}
            alt=""
            className="size-8 flex-none rounded-control object-contain"
          />
        </figure>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Frame
          vars={{ ...LIGHT, ...brand }}
          label={t("admin.branding.images.light")}
          mirror={mirror}
          workspaceName={workspaceName}
          initials={initials}
        />
        <Frame
          vars={{ ...DARK, ...brand }}
          label={t("admin.branding.images.dark")}
          mirror={mirror}
          workspaceName={workspaceName}
          initials={initials}
        />
      </div>
    </section>
  );
}

function Frame({
  vars,
  label,
  mirror,
  workspaceName,
  initials,
}: {
  readonly vars: Record<string, string>;
  readonly label: string;
  readonly mirror: Mirror;
  readonly workspaceName: string;
  readonly initials: string;
}) {
  const { t } = useTranslations();
  const home = t("admin.branding.mirror.sampleRow");
  return (
    <figure className="flex min-w-0 flex-col gap-1.5">
      <div
        style={vars as CSSProperties}
        className="grid min-h-60 grid-cols-[minmax(0,2fr)_minmax(0,3fr)] overflow-hidden rounded-control border border-line bg-surface text-ink [&_*]:transition-colors [&_*]:duration-150 motion-reduce:[&_*]:transition-none"
      >
        {/* The sidebar: brandmark, the active row, and rows standing in for
            the rest of the navigation. */}
        <div className="flex flex-col gap-2 border-r border-line bg-raised p-3">
          <div className="flex min-w-0 items-center gap-2">
            {mirror.logoUrl ? (
              // biome-ignore lint/performance/noImgElement: a stored blob or an object URL, which next/image cannot load.
              <img
                src={mirror.logoUrl}
                alt=""
                className="size-8 flex-none rounded-control object-contain"
              />
            ) : (
              <span
                aria-hidden="true"
                className="grid size-8 flex-none place-items-center rounded-control bg-brand text-xs font-extrabold text-on-brand"
              >
                {initials}
              </span>
            )}
            <span className="truncate text-sm font-semibold">
              {workspaceName}
            </span>
          </div>
          <div className="mt-2 flex items-center gap-2 rounded-control bg-surface px-2 py-1.5 text-sm font-medium">
            <span
              aria-hidden="true"
              className="h-4 w-0.5 flex-none rounded-full bg-brand"
            />
            <span className="truncate">{home}</span>
          </div>
          {["w-3/4", "w-2/3", "w-4/5"].map((width) => (
            <span
              key={width}
              aria-hidden="true"
              className={`mx-2 my-1.5 block h-2 rounded-full bg-line ${width}`}
            />
          ))}
        </div>
        {/* The content: a page title, the primary button, and a goal card
            with its progress bar. */}
        <div className="flex min-w-0 flex-col gap-3 p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-base font-semibold">{home}</span>
            <span className="flex-none rounded-control bg-brand px-2.5 py-1 text-xs font-semibold text-on-brand">
              {t("admin.branding.mirror.sampleButton")}
            </span>
          </div>
          {["w-3/5", "w-2/5"].map((progress, index) => (
            <div
              key={progress}
              aria-hidden="true"
              className="flex flex-col gap-2 rounded-control border border-line p-3"
            >
              <span
                className={`block h-2 rounded-full bg-ink-3/40 ${index === 0 ? "w-2/3" : "w-1/2"}`}
              />
              <span className="block h-1.5 overflow-hidden rounded-full bg-raised">
                <span
                  className={`block h-full rounded-full bg-brand ${progress}`}
                />
              </span>
            </div>
          ))}
        </div>
      </div>
      <figcaption className="text-xs text-ink-4">{label}</figcaption>
    </figure>
  );
}
