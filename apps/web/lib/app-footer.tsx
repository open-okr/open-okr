import { DEFAULT_INSTANCE_NAME } from "@openokr/core";
import { Kbd } from "@openokr/ui";
import { getTranslations } from "./translations";
import { VersionFooter } from "./version-footer.tsx";

/**
 * The foot of every signed-in screen (docs/design/version-footer.md §8, 2
 * November 2026; the owner chose the white band of three prototypes).
 *
 * **A band of its own.** A hairline over a surface-coloured band, the width of
 * the content pane, so the page visibly ends before the footer begins. It was
 * one grey line of text under the content, for administrators only.
 *
 * **Something for everyone.** The instance's name; the two shortcuts the topbar teaches (⌘J only while the
 * copilot can answer, since an AI affordance is hidden when the provider is
 * off); the running version; and, for an administrator, a newer release.
 *
 * **Always in view on a wide screen.** Sticky to the foot of the content pane,
 * so it stays put while the page scrolls under it (the owner's choice). A
 * sticky offset is measured from inside `main`'s padding, so it is the padding
 * taken back: 18px.
 *
 * **Not on a phone.** Below the phone breakpoint it ends the page instead. Its
 * two lines took 63px of a phone's height on every screen, on top of the 56px
 * tab bar (Q-10b, 0.8.0 acceptance test).
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
      className="z-[5] -mx-4.5 mt-6 -mb-6 flex flex-col items-start gap-x-4 gap-y-1.5 border-t border-line bg-surface px-4.5 py-3 text-xs text-ink-3 md:sticky md:-bottom-4.5 md:-mb-4.5 md:flex-row md:flex-wrap md:items-center"
    >
      {/* An instance nobody has named shows nothing here. The "Built on
          OpenOKR" credit was removed at the owner's request (4 November
          2026), so the default name would only repeat the product. */}
      {instanceName === DEFAULT_INSTANCE_NAME ? null : (
        <span className="font-semibold text-ink-2">{instanceName}</span>
      )}
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
