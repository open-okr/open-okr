/**
 * What one domain's import did, in the shape every domain reports it
 * (TECHNICAL-PLAN §7.1 step 7, P6-T03a).
 *
 * **A reconciliation, not a log.** The question a person asks after a migration
 * is "did everything come across", and the only honest answer is a count from
 * the source beside a count in the target with the difference named. A list of
 * lines that says what happened cannot answer it, because a row that was never
 * read leaves no line.
 *
 * **`read` comes from the source and `created` plus `matched` from the target.**
 * A clean domain is one where they agree: everything read is either a row this
 * run wrote or a row an earlier run already wrote, and nothing was skipped. That
 * is the property the acceptance criterion turns on, and it is checked here
 * rather than by eye.
 */

export interface SkippedRow {
  /** The source table and id, as `legacyIdFor` writes them. */
  readonly source: string;
  readonly reason: string;
}

export interface DomainReconciliation {
  readonly domain: string;
  /** Rows the source held for this company. */
  readonly read: number;
  /** Rows this run wrote. */
  readonly created: number;
  /** Rows an earlier run had already written, found by their legacy key. */
  readonly matched: number;
  readonly skipped: readonly SkippedRow[];
  /** True when everything read is accounted for and nothing was skipped. */
  readonly clean: boolean;
}

/** Builds one domain's reconciliation and works out whether it is clean. */
export class DomainTally {
  /**
   * Declared, not a parameter property.
   *
   * Every entry point in this repository runs under Node's
   * `--experimental-strip-types`, which erases types without transpiling and
   * refuses `constructor(readonly domain: string)` outright. Vitest transpiles,
   * so the tests passed and only running the command found it.
   */
  readonly domain: string;
  private read = 0;
  private created = 0;
  private matched = 0;
  private readonly skipped: SkippedRow[] = [];

  constructor(domain: string) {
    this.domain = domain;
  }

  sawRow(): void {
    this.read += 1;
  }

  wrote(created: boolean): void {
    if (created) {
      this.created += 1;
    } else {
      this.matched += 1;
    }
  }

  skip(source: string, reason: string): void {
    this.skipped.push({ source, reason });
  }

  finish(): DomainReconciliation {
    return {
      domain: this.domain,
      read: this.read,
      created: this.created,
      matched: this.matched,
      skipped: this.skipped,
      // Deliberately strict. A domain with one skipped row is not clean, even
      // though the skip was reported: "clean" has to mean "nothing to look at"
      // or nobody will look.
      clean:
        this.skipped.length === 0 && this.created + this.matched === this.read,
    };
  }
}

/** The sentence a report prints for one domain. */
export function describeDomain(domain: DomainReconciliation): string {
  const parts = [
    `${domain.read} read`,
    `${domain.created} created`,
    `${domain.matched} already here`,
  ];
  if (domain.skipped.length > 0) {
    parts.push(`${domain.skipped.length} skipped`);
  }
  return `${domain.domain}: ${parts.join(", ")}`;
}
