/**
 * The domains a run imports, and what each one needs before it (P6-T04d).
 *
 * **`--only` selects from this table, and the order is enforced rather than
 * assumed.** Until now the run called seven mappers in a fixed sequence, and
 * the reason each one came after the last lived in a comment beside the call.
 * A flag that lets somebody import three of them turns those comments into
 * rules, because a person naming `objectives` on its own has not said "skip
 * the people the objectives are championed by".
 *
 * **A prerequisite is added rather than refused.** `--only objectives` runs the
 * organisation first and the report says it did. Refusing would be defensible
 * and useless: a second run of a domain is a no-op, because every mapper looks
 * its rows up by legacy key before writing, so adding a prerequisite costs a
 * pass over rows that are already there and saves somebody from a refusal they
 * can do nothing about except type more.
 *
 * The dependencies are facts about the data, not preferences:
 *
 * - an objective names a champion, a reviewer, a cycle and a space, and all
 *   four come from the organisation;
 * - a check-in belongs to an objective and moves its key results;
 * - a KPI names an owner and a space;
 * - a task carries a key result link and sits in a space;
 * - a comment hangs on a task and a watcher watches one;
 * - an attachment hangs on a task and an inline image rewrites a comment.
 */
import type { FileStorage } from "@openokr/adapters";
import type { ActionCallContext } from "@openokr/core";
import { importCheckIns } from "./mappers/check-ins.ts";
import { importCollaboration } from "./mappers/collaboration.ts";
import { importFiles } from "./mappers/files.ts";
import { importKpis } from "./mappers/kpis.ts";
import { importKeyResultValues, importOkrs } from "./mappers/okrs.ts";
import { importOrganisation } from "./mappers/organisation.ts";
import type { DomainReconciliation } from "./mappers/reconcile.ts";
import type { Resolver } from "./mappers/resolve.ts";
import { importWork } from "./mappers/work.ts";
import type { Source } from "./source.ts";

/** What every domain hands back, whatever its mapper's own shape. */
interface DomainOutcome {
  readonly domains: readonly DomainReconciliation[];
  /** Notes for the report, in the words a person should read. */
  readonly notes: readonly string[];
}

/**
 * What every mapper is handed, built once per run in `run.ts`.
 *
 * Declared here rather than in each mapper because the table below has to name
 * the type its entries take. Each mapper keeps its own narrower interface, and
 * they are structurally satisfied by this one, so a mapper that needs three of
 * these fields still says so in its own file.
 */
interface MapperContext {
  readonly source: Source;
  readonly context: ActionCallContext;
  readonly companyId: number;
  readonly resolver: Resolver;
  readonly actingMemberId: string;
  readonly write: boolean;
  /** Where this instance keeps its own bytes. Absent in a dry run. */
  readonly storage?: FileStorage;
  /** The source's storage directory, from `--files-root`. */
  readonly filesRoot?: string;
}

interface ImportDomain {
  readonly key: string;
  /** One line for the usage text. */
  readonly summary: string;
  /** Domains that have to run before this one, by key. */
  readonly requires: readonly string[];
  run(options: MapperContext): Promise<DomainOutcome>;
}

/**
 * In dependency order, which is also the order a full run uses. A domain never
 * appears before something it requires, and the selection below relies on
 * that rather than sorting.
 */
const DOMAINS: readonly ImportDomain[] = [
  {
    key: "organisation",
    summary: "people, spaces, space membership and cycles",
    requires: [],
    async run(options) {
      const result = await importOrganisation(options);
      return {
        domains: result.domains,
        notes: [
          result.teamTreeDepth > 1
            ? `The source's team tree was ${result.teamTreeDepth} deep and imported flat. OpenOKR spaces do not nest: a space is a team that runs a rhythm, and a department containing four of them is an org-chart fact rather than a place where check-ins happen.`
            : "The source's teams were already flat.",
        ],
      };
    },
  },
  {
    key: "objectives",
    summary: "objectives, key results and their alignment",
    requires: ["organisation"],
    async run(options) {
      const result = await importOkrs(options);
      return {
        domains: result.domains,
        notes: [
          "Every objective's score, health and alignment is recomputed by the engines after load. The source's own stored figures are not carried, because they are a fact about the old system rather than about this one.",
          ...(result.rescored > 0
            ? [
                `${result.rescored} objectives carried a stored score in the source. Every one is recomputed here from the key results that imported, so a figure that has moved is the engine correcting the old one rather than data lost.`,
              ]
            : []),
          ...(result.truncatedValues
            ? [
                "Some key result values are not whole numbers. FlowyTeam changed these columns to bigint in 2023 and truncated whatever fractional targets were there at the time, so a target that looks wrong in the source will look the same here.",
              ]
            : []),
        ],
      };
    },
  },
  {
    key: "checkins",
    summary: "check-ins, their reviews and key result history",
    requires: ["objectives"],
    async run(options) {
      const checkIns = await importCheckIns(options);
      // Values last, because they defer to the check-ins: a record replayed
      // after one would overwrite a dated movement with an undated one.
      const values = await importKeyResultValues(options);
      return {
        domains: [...checkIns.domains, values],
        notes: [
          "Confidence votes are not imported: a private vote with a synchronised reveal is an OpenOKR concept and the source records one confidence per check-in.",
        ],
      };
    },
  },
  {
    key: "kpis",
    summary: "KPI categories, KPIs and their records",
    requires: ["organisation"],
    async run(options) {
      const result = await importKpis(options);
      return {
        domains: result.domains,
        notes: [
          "Every KPI arrives with no tree. FlowyTeam has no named driver tree, and building one from the parent chain would name something nobody chose.",
        ],
      };
    },
  },
  {
    key: "work",
    summary: "initiatives, tasks and checklists",
    // Objectives too, and not only the organisation: a task can carry a key
    // result link, and importing work without them would drop it silently.
    requires: ["objectives"],
    async run(options) {
      const result = await importWork(options);
      return { domains: result.domains, notes: result.unmodelled };
    },
  },
  {
    key: "collaboration",
    summary: "task comments and the people watching them",
    requires: ["work"],
    async run(options) {
      const result = await importCollaboration(options);
      return { domains: result.domains, notes: result.unmodelled };
    },
  },
  {
    key: "files",
    summary: "task files, and the images inline in comment markup",
    // Collaboration and not only work: the file pass rewrites the comment
    // bodies that held an image, and there is nothing to rewrite otherwise.
    requires: ["collaboration"],
    async run(options) {
      const result = await importFiles(options);
      return { domains: result.domains, notes: result.unmodelled };
    },
  },
];

export const DOMAIN_KEYS: readonly string[] = DOMAINS.map(
  (domain) => domain.key,
);

export interface Selection {
  /** In dependency order. */
  readonly domains: readonly ImportDomain[];
  /** Keys added because something asked for depends on them. */
  readonly added: readonly string[];
}

/**
 * The domains to run, with every prerequisite pulled in.
 *
 * `undefined` means all of them, which is what a run with no `--only` does.
 * An unknown key throws, because a typo in a flag that silently imports less
 * than somebody asked for is the worst of the options here.
 */
export function selectDomains(only: readonly string[] | undefined): Selection {
  if (only === undefined || only.length === 0) {
    return { domains: DOMAINS, added: [] };
  }

  const asked = new Set<string>();
  for (const key of only) {
    const trimmed = key.trim().toLowerCase();
    if (trimmed === "") {
      continue;
    }
    if (!DOMAIN_KEYS.includes(trimmed)) {
      throw new UnknownDomainError(trimmed);
    }
    asked.add(trimmed);
  }
  if (asked.size === 0) {
    return { domains: DOMAINS, added: [] };
  }

  const wanted = new Set(asked);
  // One pass backwards through the table is enough, and only because the table
  // is in dependency order: everything a domain requires sits before it, so by
  // the time the walk reaches a domain, every domain that could have asked for
  // it has already been seen.
  for (let index = DOMAINS.length - 1; index >= 0; index -= 1) {
    const domain = DOMAINS[index] as ImportDomain;
    if (!wanted.has(domain.key)) {
      continue;
    }
    for (const required of domain.requires) {
      wanted.add(required);
    }
  }

  return {
    domains: DOMAINS.filter((domain) => wanted.has(domain.key)),
    added: [...wanted].filter((key) => !asked.has(key)),
  };
}

export class UnknownDomainError extends Error {
  readonly key: string;

  constructor(key: string) {
    super(
      `"${key}" is not a domain this imports. Choose from ${DOMAIN_KEYS.join(", ")}.`,
    );
    this.key = key;
    this.name = "UnknownDomainError";
  }
}
