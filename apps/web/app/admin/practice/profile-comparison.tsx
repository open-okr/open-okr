"use client";

import { Dialog } from "@base-ui-components/react/dialog";
import type { ProfileComparisonRow, ProfileKey } from "@openokr/method";
import { Button, Chip, MethodHint, useTranslations } from "@openokr/ui";
import { X } from "lucide-react";

/**
 * The five profiles side by side (METHOD.md §12.3), opened from the profile
 * card.
 *
 * **The rows are `compareProfiles`**, worked out on the server: the function
 * `method:check` holds METHOD.md §12.3 to, so this dialog and the document
 * cannot show different tables. Nothing here names a setting or a profile.
 *
 * Only what some profile changes is a row. A value that differs from
 * Recommended is a bold pill, and the bold is what carries it for a reader
 * who cannot see the colour. Each row's name has a hint saying what the row
 * decides, so the table reads without METHOD.md beside it.
 */
export function ProfileComparison({
  rows,
  profiles,
  inUse,
  methodLinks,
}: {
  readonly rows: readonly ProfileComparisonRow[];
  readonly profiles: readonly {
    readonly key: ProfileKey;
    readonly label: string;
  }[];
  /** The profile this workspace runs, marked in its column's heading. */
  readonly inUse: string;
  /** METHOD.md's address for each section, this table's own included. */
  readonly methodLinks: Readonly<Record<string, string>>;
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
          className={
            /* direction-neutral: Keep the element centered in its container. */
            "fixed top-1/2 left-1/2 z-50 flex max-h-[85vh] w-[calc(100vw-2rem)] max-w-5xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-line bg-surface shadow-(--shadow-popover) outline-none"
          }
        >
          <header className="flex flex-none items-start gap-3 border-b border-line px-4 py-3">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <Dialog.Title className="text-base font-semibold text-ink">
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
            <table className="w-full min-w-176 table-fixed border-collapse text-sm">
              <caption className="sr-only">{title}</caption>
              <thead>
                <tr>
                  <th
                    scope="col"
                    className="sticky top-0 start-0 z-20 w-[30%] border-b border-line bg-raised px-3 py-2 text-start align-top text-xs font-semibold text-ink-2"
                  >
                    {t("admin.practice.compare.setting")}
                  </th>
                  {profiles.map((profile) => (
                    <th
                      key={profile.key}
                      scope="col"
                      className="sticky top-0 z-10 border-b border-line bg-raised px-3 py-2 text-start align-top text-xs font-semibold text-ink-2"
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
                      className="sticky start-0 bg-surface px-3 py-2.5 text-start align-top text-sm font-medium text-ink"
                    >
                      <span className="flex items-start gap-1.5">
                        {row.name}
                        <MethodHint
                          name={row.name}
                          href={methodLinks[row.section]}
                        >
                          <p>{row.about}</p>
                        </MethodHint>
                      </span>
                    </th>
                    {profiles.map((profile) => (
                      <td
                        key={profile.key}
                        className="px-1.5 py-2 align-top text-ink-3"
                      >
                        {row.differs.includes(profile.key) ? (
                          <span className="inline-flex rounded-sm bg-brand-weak px-1.5 py-0.5 font-semibold text-brand-text">
                            {row.values[profile.key]}
                          </span>
                        ) : (
                          <span className="inline-flex px-1.5 py-0.5">
                            {row.values[profile.key]}
                          </span>
                        )}
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
              href={methodLinks["12.3"]}
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
