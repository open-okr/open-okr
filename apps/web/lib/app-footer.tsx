import { DEFAULT_INSTANCE_NAME } from "@openokr/core";
import { Kbd } from "@openokr/ui";
import { getTranslations } from "./translations";
import { VersionFooter } from "./version-footer.tsx";

/** Where the software is developed, for "Built on OpenOKR". */
const SOURCE_URL = "https://github.com/open-okr/open-okr";

/**
 * The foot of every signed-in screen (docs/design/version-footer.md §8, 2
 * November 2026; the owner chose the white band of three prototypes).
 *
 * **A band of its own.** A hairline over a surface-coloured band, the width of
 * the content pane, so the page visibly ends before the footer begins. It was
 * one grey line of text under the content, for administrators only.
 *
 * **Something for everyone.** The instance's name and where the software
 * comes from; the two shortcuts the topbar teaches (⌘J only while the
 * copilot can answer, since an AI affordance is hidden when the provider is
 * off); and, for an administrator, the running version and a newer release.
 *
 * **Always in view.** Sticky to the foot of the content pane, so it stays put
 * while the page scrolls under it (the owner's choice). A sticky offset is
 * measured from inside `main`'s padding, so it is the padding taken back: 18px
 * on a wide screen, and on a phone 24px of the 80px kept for the fixed 56px
 * tab bar, which leaves the band sitting on the tab bar.
 *
 * **Pulled out to the pane's edges.** `main` pads its content, so the band
 * takes that padding back as negative margins. On a phone `main` leaves 80px
 * under the content for the tab bar; the band takes back only 24px of it, so
 * at the end of the page it still stands clear of the tab bar rather than
 * under it.
 */
export async function AppFooter({
  level,
  instanceName,
  askAvailable,
}: {
  readonly level: number;
  readonly instanceName: string;
  /** Whether ⌘J opens a copilot that can answer. */
  readonly askAvailable: boolean;
}) {
  const { t } = await getTranslations();
  return (
    <footer
      data-testid="app-footer"
      className="sticky -bottom-6 z-[5] -mx-4.5 mt-6 -mb-6 flex flex-col items-start gap-x-4 gap-y-1.5 border-t border-line bg-surface px-4.5 py-3 text-xs text-ink-3 md:-bottom-4.5 md:-mb-4.5 md:flex-row md:flex-wrap md:items-center"
    >
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
        {/* Not twice: an instance nobody has named is the software itself,
            which the credit beside it already names. */}
        {instanceName === DEFAULT_INSTANCE_NAME ? null : (
          <span className="font-semibold text-ink-2">{instanceName}</span>
        )}
        <a
          href={SOURCE_URL}
          target="_blank"
          rel="noreferrer"
          className="underline-offset-3 hover:text-ink hover:underline"
        >
          {t("shell.footer.builtOn")}
        </a>
      </div>
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 md:ml-auto">
        {/* A phone has no ⌘ key, so the shortcuts are for wider screens. */}
        <span className="hidden items-center gap-1.5 md:inline-flex">
          <Kbd>⌘K</Kbd>
          <span>{t("shell.footer.search")}</span>
        </span>
        {askAvailable ? (
          <span className="hidden items-center gap-1.5 md:inline-flex">
            <Kbd>⌘J</Kbd>
            <span>{t("shell.footer.ask")}</span>
          </span>
        ) : null}
        <VersionFooter level={level} />
      </div>
    </footer>
  );
}
