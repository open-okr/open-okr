/** The translate function a server page already holds. */
type Translate = (
  key: string,
  values?: Readonly<Record<string, string | number>>,
) => string;

/**
 * The cycle's phase chip, in words (OKRGoal UX review, T6).
 *
 * "1 of 7 done" counted passed phases in any order, which Guided mode allows
 * (METHOD.md §2.3), so a cycle with phase 4 ticked and phase 1 open read as a
 * miscount. Naming the phases done and the first one open says the same
 * thing without the reader having to guess which one counted.
 */
export function phaseProgress(
  t: Translate,
  phases: readonly {
    readonly phase: number;
    readonly state: "pass" | "todo" | "not_applicable";
  }[],
): { readonly text: string; readonly complete: boolean } {
  const applicable = phases.filter((entry) => entry.state !== "not_applicable");
  const done = applicable
    .filter((entry) => entry.state === "pass")
    .map((entry) => entry.phase);
  const open = applicable.find((entry) => entry.state === "todo")?.phase;
  if (open === undefined) {
    return {
      text: t("cycle.phaseRail.allDone", { count: applicable.length }),
      complete: true,
    };
  }
  if (done.length === 0) {
    return { text: t("cycle.phaseRail.openOnly", { open }), complete: false };
  }
  return {
    text: t(
      done.length === 1
        ? "cycle.phaseRail.doneAndOpenOne"
        : "cycle.phaseRail.doneAndOpenOther",
      { phases: done.join(", "), open },
    ),
    complete: false,
  };
}
