/**
 * A finder for personal data in text a workspace saves for a model to read
 * (plan 0.7.0 A7, agent-instructions.md I7; the same check A9 applies to a
 * prompt). The finder is the adapters' `redactPersonalData`, which core cannot
 * import, so the web server installs it at boot the way it installs A9's
 * prompt evaluator. Where nothing is installed, as in a unit test, the check
 * finds nothing: it is a hygiene check on an administrator's own words, not
 * the egress guard, which runs on every request whatever was saved.
 */
export type PersonalDataFinder = (text: string) => {
  readonly emails: number;
  readonly phones: number;
};

const globals = globalThis as typeof globalThis & {
  openokrPersonalDataFinder?: PersonalDataFinder;
};

export function setPersonalDataFinder(finder: PersonalDataFinder): void {
  globals.openokrPersonalDataFinder = finder;
}

/** What the installed finder sees, or nothing when none is installed. */
export function findPersonalData(text: string): {
  readonly emails: number;
  readonly phones: number;
} {
  return globals.openokrPersonalDataFinder?.(text) ?? { emails: 0, phones: 0 };
}
