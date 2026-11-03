"use client";

import { Dialog } from "@base-ui-components/react/dialog";
import type { ProfileComparisonRow, ProfileKey } from "@openokr/method";
import { Button, Chip, cn, useTranslations } from "@openokr/ui";
import { X } from "lucide-react";

/**
 * The five profiles side by side (METHOD.md §12.3), opened from the profile
 * card.
 *
 * **The rows are `compareProfiles`**, worked out on the server: the function
 * `method:check` holds METHOD.md §12.3 to, so this dialog and the document
 * cannot show different tables. Nothing here names a setting or a profile.
 *
 * Only what some profile changes is a row. A cell that differs from
 * Recommended is bold on a tint, and the bold is what carries it for a reader
 * who cannot see the tint.
 */
export function ProfileComparison({
  rows,
  profiles,
  inUse,
  methodUrl,
}: {
  readonly rows: readonly ProfileComparisonRow[];
  readonly profiles: readonly {
    readonly key: ProfileKey;
    readonly label: string;
  }[];
  /** The profile this workspace runs, marked in its column's heading. */
  readonly inUse: string;
  /** METHOD.md's own copy of this table, for the reasons behind each row. */
  readonly methodUrl: string;
}) {
  const { t } = useTranslations();
  const title = t("admin.practice.compare.title");

  return (
    <Dialog.Root>
      <Dialog.Trigger
        render={<Button size="sm" data-testid="practice-compare-open" />}
      >
        {t("admin.practice.compare.open")}
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-ink/20 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup
          data-testid="practice-compare"
          className="fixed top-1/2 left-1/2 z-50 flex max-h-[85vh] w-[calc(100vw-2rem)] max-w-5xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-line bg-surface shadow-(--shadow-popover) outline-none"
        >
          <header className="flex flex-none items-start gap-3 border-b border-line px-4 py-3">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <Dialog.Title className="text-lg font-bold text-ink">
                {title}
              </Dialog.Title>
              <Dialog.Description className="text-sm text-ink-3">
                {t("admin.practice.compare.description")}
              </Dialog.Description>
            </div>
            <Dialog.Close
              aria-label={t("admin.practice.compare.close")}
              className="flex size-7 flex-none items-center justify-center rounded-control text-ink-3 hover:bg-raised hover:text-ink"
            >
              <X className="size-4" aria-hidden="true" />
            </Dialog.Close>
          </header>
          {/* Focusable, so the table scrolls sideways by keyboard on a phone. */}
          <section
            aria-label={title}
            // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling region has to take focus to be scrolled without a pointer.
            tabIndex={0}
            className="min-h-0 flex-1 overflow-auto"
          >
            <table className="w-full min-w-176 border-collapse text-sm">
              <caption className="sr-only">{title}</caption>
              <thead>
                <tr>
                  <th
                    scope="col"
                    className="sticky top-0 left-0 z-20 bg-surface px-3 py-2 text-left text-xs font-bold tracking-wide text-ink-4 uppercase"
                  >
                    {t("admin.practice.compare.setting")}
                  </th>
                  {profiles.map((profile) => (
                    <th
                      key={profile.key}
                      scope="col"
                      className="sticky top-0 z-10 bg-surface px-3 py-2 text-left align-bottom font-semibold text-ink"
                    >
                      <span className="flex flex-wrap items-center gap-1.5">
                        {profile.label}
                        {profile.key === inUse ? (
                          <Chip tone="brand">
                            {t("admin.practice.profile.inUse")}
                          </Chip>
                        ) : null}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key} className="border-t border-line">
                    <th
                      scope="row"
                      className="sticky left-0 w-40 bg-surface px-3 py-2 text-left align-top font-medium text-ink sm:w-64"
                    >
                      {row.name}
                    </th>
                    {profiles.map((profile) => (
                      <td
                        key={profile.key}
                        className={cn(
                          "px-3 py-2 align-top",
                          row.differs.includes(profile.key)
                            ? "bg-brand-weak font-semibold text-ink"
                            : "text-ink-3",
                        )}
                      >
                        {row.values[profile.key]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <footer className="flex flex-none flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-t border-line px-4 py-3 text-sm">
            <p className="text-ink-3">{t("admin.practice.compare.legend")}</p>
            <a
              href={methodUrl}
              target="_blank"
              rel="noreferrer"
              data-testid="practice-compare-method-link"
              className="font-semibold text-brand-text underline"
            >
              {t("admin.practice.compare.readMethod")}
              <span className="sr-only">
                {" "}
                {t("admin.practice.opensInNewTab")}
              </span>
            </a>
          </footer>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
