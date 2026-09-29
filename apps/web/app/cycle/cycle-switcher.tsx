import { Button } from "@openokr/ui";
import Link from "next/link";
import { getTranslations } from "../../lib/translations";

/**
 * The mode toggle and the cycle picker in the cycle workspace's header
 * (UIUX-PLAN.md §4 S-04, completeness review M-06).
 *
 * **S-04 puts a mode toggle in the header, and the header had a chip.** The
 * page always read `cycles.current` in quarterly mode, so an annual cycle could
 * exist and never be opened: phase 0, the annual frame and the year's
 * objectives were reachable only as panels inside the quarter. METHOD.md §2.1
 * runs the two horizons side by side, and this is where the reader chooses
 * which one they are working in.
 *
 * **The picker opens any cycle in the chosen horizon, not only the current
 * one.** Planning happens before a period starts (§2.4: three weeks before the
 * quarter, six before the year), which is exactly when the cycle being planned
 * is not the one containing today. A plain form rather than a script, so it
 * works before the page hydrates and scales to a workspace with many cycles.
 */

export interface SwitchableCycle {
  readonly id: string;
  readonly name: string;
  readonly mode: "annual" | "quarterly";
}

const MODES = ["quarterly", "annual"] as const;

export async function CycleSwitcher({
  mode,
  cycles,
  currentId,
}: {
  readonly mode: "annual" | "quarterly";
  readonly cycles: readonly SwitchableCycle[];
  readonly currentId: string | null;
}) {
  const { t } = await getTranslations();
  const inMode = cycles.filter((one) => one.mode === mode);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <nav
        aria-label={t("cycle.switcher.horizon")}
        className="flex items-center gap-0.5 rounded-md border border-line p-0.5"
      >
        {MODES.map((one) => (
          <Link
            key={one}
            href={`/cycle?mode=${one}`}
            aria-current={one === mode ? "true" : undefined}
            data-testid={`cycle-mode-${one}`}
            className={
              one === mode
                ? "rounded px-2.5 py-1 text-xs font-semibold text-surface bg-ink"
                : "rounded px-2.5 py-1 text-xs font-medium text-ink-2 hover:bg-raised"
            }
          >
            {one === "annual"
              ? t("cycle.switcher.annual")
              : t("cycle.switcher.quarterly")}
          </Link>
        ))}
      </nav>

      {inMode.length > 1 ? (
        <form
          action="/cycle"
          method="get"
          className="flex items-center gap-1.5"
        >
          <select
            name="cycle"
            defaultValue={currentId ?? undefined}
            aria-label={t("cycle.switcher.whichCycle")}
            data-testid="cycle-picker"
            className="rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink"
          >
            {inMode.map((one) => (
              <option key={one.id} value={one.id}>
                {one.name}
              </option>
            ))}
          </select>
          <Button type="submit" variant="ghost" size="sm">
            {t("cycle.switcher.open")}
          </Button>
        </form>
      ) : null}
    </div>
  );
}
