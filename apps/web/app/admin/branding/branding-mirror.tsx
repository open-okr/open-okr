"use client";

import { useTranslations } from "@openokr/ui";
import type { CSSProperties, ReactNode } from "react";
import type { Mirror } from "../../../lib/branding-mirror.ts";

/**
 * The live mirror on Branding (docs/design/branding-page.md §2): a small copy
 * of this workspace's own screen, in light and dark side by side, drawn with
 * whatever is chosen before it is saved.
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

const PART = {
  colour: "admin.branding.mirror.part.colour",
  logo: "admin.branding.mirror.part.logo",
  favicon: "admin.branding.mirror.part.favicon",
} as const;

export function BrandingMirror({
  mirror,
  workspaceName,
  initials,
  actions,
}: {
  readonly mirror: Mirror;
  readonly workspaceName: string;
  readonly initials: string;
  /** The page's Save and Discard, under the list of what they would save. */
  readonly actions?: ReactNode;
}) {
  const { t } = useTranslations();
  // Only the fill is overridden: the stops derived from it are the layout's
  // business once the colour is saved.
  const brand: Record<string, string> = mirror.brand
    ? { "--brand": mirror.brand }
    : {};
  const unsaved = mirror.unsaved.map((part) => t(PART[part]));

  return (
    <section
      aria-labelledby="branding-mirror-title"
      data-testid="branding-mirror"
      className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4"
    >
      <h2 id="branding-mirror-title" className="text-sm font-semibold text-ink">
        {t("admin.branding.images.preview")}
      </h2>
      <div className="grid grid-cols-2 gap-2">
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
      <figure className="flex flex-col gap-1">
        <div className="flex items-end gap-3">
          <div
            style={LIGHT as CSSProperties}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-t-control border border-b-0 border-line bg-surface px-3 py-2 text-ink"
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
        </div>
        <figcaption className="text-xs text-ink-4">
          {t("admin.branding.images.browserTab")}
        </figcaption>
      </figure>
      <p
        role="status"
        className="min-h-4 text-xs font-medium text-ink-3"
        data-testid="branding-mirror-unsaved"
      >
        {unsaved.length > 0
          ? t("admin.branding.mirror.notSaved", { parts: unsaved.join(", ") })
          : ""}
      </p>
      {actions}
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
  return (
    <figure className="flex min-w-0 flex-col gap-1">
      <div
        style={vars as CSSProperties}
        className="flex flex-col gap-2 rounded-control border border-line bg-surface p-2.5 text-ink [&_*]:transition-colors [&_*]:duration-150 motion-reduce:[&_*]:transition-none"
      >
        <div className="flex min-w-0 items-center gap-1.5">
          {mirror.logoUrl ? (
            // biome-ignore lint/performance/noImgElement: a stored blob or an object URL, which next/image cannot load.
            <img
              src={mirror.logoUrl}
              alt=""
              className="size-6 flex-none rounded-control object-contain"
            />
          ) : (
            <span
              aria-hidden="true"
              className="grid size-6 flex-none place-items-center rounded-control bg-brand text-[10px] font-extrabold text-on-brand"
            >
              {initials}
            </span>
          )}
          <span className="truncate text-xs font-semibold">
            {workspaceName}
          </span>
        </div>
        <div className="flex items-center gap-1.5 rounded-control bg-raised px-1.5 py-1 text-xs">
          <span
            aria-hidden="true"
            className="h-3 w-0.5 rounded-full bg-brand"
          />
          <span className="truncate">
            {t("admin.branding.mirror.sampleRow")}
          </span>
        </div>
        <span className="w-fit rounded-control bg-brand px-2 py-1 text-[11px] font-semibold text-on-brand">
          {t("admin.branding.mirror.sampleButton")}
        </span>
        <span
          aria-hidden="true"
          className="block h-1.5 overflow-hidden rounded-full bg-raised"
        >
          <span className="block h-full w-3/5 rounded-full bg-brand" />
        </span>
      </div>
      <figcaption className="text-xs text-ink-4">{label}</figcaption>
    </figure>
  );
}
