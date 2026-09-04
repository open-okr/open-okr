/**
 * People, spaces and cycles (TECHNICAL-PLAN §7.2, P6-T03a).
 *
 * **This runs first and everything else resolves against it.** An objective
 * names a champion and a reviewer, a key result hangs off a cycle, a task names
 * assignees. Until a source user id answers with a member id there is nothing
 * the later mappers can write, which is why the four domains here are one row
 * of the plan and not four.
 *
 * **Nothing is invented.** A team whose leader is not a member of the company
 * gets no manager and a report row. A cycle whose dates are impossible is
 * skipped by name. A person with no address becomes no member at all, because a
 * placeholder that cannot ever be claimed is a row nobody can act on.
 */
import { type ActionCallContext, callAction } from "@openokr/core";
import { legacyKeyFor } from "../legacy.ts";
import type { Source } from "../source.ts";
import { type DomainReconciliation, DomainTally } from "./reconcile.ts";
import type { Resolver } from "./resolve.ts";

export interface OrganisationResult {
  readonly domains: readonly DomainReconciliation[];
  /** How deep the source's team tree was. One means it was already flat. */
  readonly teamTreeDepth: number;
}

interface MapperOptions {
  readonly source: Source;
  readonly context: ActionCallContext;
  readonly companyId: number;
  readonly resolver: Resolver;
  /** False writes nothing and reports what a real run would do. */
  readonly write: boolean;
}

export async function importOrganisation(
  options: MapperOptions,
): Promise<OrganisationResult> {
  const members = await importMembers(options);
  const { tally: spaces, depth } = await importSpaces(options);
  const spaceMembers = await importSpaceMembers(options);
  const cycles = await importCycles(options);

  return {
    domains: [members, spaces, spaceMembers, cycles],
    teamTreeDepth: depth,
  };
}

interface SourceUser {
  id: number;
  name: string | null;
  email: string | null;
  timezone: string | null;
  status: string | null;
  title: string | null;
}

/**
 * Every person the company knows, as a member or a placeholder.
 *
 * **Keyed by `users`, not by `employee_details`.** Every FlowyTeam person is a
 * `users` row; the employee row is optional detail that a company using only
 * the OKR module may never have filled in. Keying by the optional one would
 * mean half a company imports and the other half silently does not.
 */
async function importMembers(
  options: MapperOptions,
): Promise<DomainReconciliation> {
  const tally = new DomainTally("members");
  const rows = await options.source.query<SourceUser>(
    `select u.id, u.name, u.email, u.timezone, u.status,
            d.name as title
       from users u
       left join employee_details e
         on e.user_id = u.id and e.company_id = u.company_id and e.deleted_at is null
       left join designations d on d.id = e.designation_id
      where u.company_id = ?
      order by u.id`,
    [options.companyId],
  );

  for (const row of rows) {
    tally.sawRow();
    const source = `users:${row.id}`;
    const email = (row.email ?? "").trim();
    if (email === "") {
      // A member with no address can never be claimed by the person it stands
      // for, and every later mapper that names them would point at a row nobody
      // owns. Better to leave them out and say so.
      tally.skip(source, "This person has no email address in the source.");
      continue;
    }
    const name = (row.name ?? "").trim() || email;

    if (!options.write) {
      const already = await options.resolver.resolve("users", row.id);
      tally.wrote(already === undefined);
      continue;
    }

    const result = await callAction(options.context, "people.importMember", {
      name,
      email,
      ...(row.title ? { title: String(row.title).slice(0, 200) } : {}),
      ...(row.timezone ? { timezone: String(row.timezone).slice(0, 64) } : {}),
      legacy: legacyKeyFor("users", row.id),
    });
    options.resolver.remember("users", row.id, result.memberId);
    tally.wrote(result.created);
  }

  return tally.finish();
}

interface SourceTeam {
  id: number;
  team_name: string | null;
  parent_id: number | null;
  leader_id: number | null;
  description: string | null;
}

/**
 * Teams and departments into spaces, flattened.
 *
 * **The tree is flattened to siblings and the depth is recorded**, which is
 * §7.2's own instruction. OpenOKR spaces are flat by design: a space is a team
 * that runs a rhythm, and a department that contains four of them is an
 * org-chart fact rather than a place where check-ins happen. Nesting them would
 * mean inventing a containment the product does not model.
 */
async function importSpaces(
  options: MapperOptions,
): Promise<{ tally: DomainReconciliation; depth: number }> {
  const tally = new DomainTally("spaces");
  const rows = await options.source.query<SourceTeam>(
    `select id, team_name, parent_id, leader_id, description
       from teams
      where company_id = ? and deleted_at is null
      order by id`,
    [options.companyId],
  );

  const byId = new Map(rows.map((row) => [row.id, row]));
  let depth = rows.length === 0 ? 0 : 1;
  for (const row of rows) {
    depth = Math.max(depth, depthOf(row, byId));
  }

  for (const row of rows) {
    tally.sawRow();
    const source = `teams:${row.id}`;
    const name = (row.team_name ?? "").trim();
    if (name === "") {
      tally.skip(source, "This team has no name in the source.");
      continue;
    }

    if (!options.write) {
      const already = await options.resolver.resolve("teams", row.id);
      tally.wrote(already === undefined);
      continue;
    }

    const existing = await options.resolver.resolve("teams", row.id);
    if (existing) {
      // A space this run already imported. Renaming it here would undo an edit
      // somebody made in the product after the first run, which is not what a
      // second run of an import is for.
      tally.wrote(false);
      continue;
    }

    const manager = row.leader_id
      ? await options.resolver.resolve("users", row.leader_id)
      : undefined;
    if (row.leader_id && !manager) {
      tally.skip(
        source,
        `Imported without a manager: the source names user ${row.leader_id} as its leader and that person did not import.`,
      );
    }

    const created = await callAction(options.context, "spaces.create", {
      name: name.slice(0, 80),
      ...(row.description
        ? { mission: String(row.description).trim().slice(0, 280) }
        : {}),
      ...(manager ? { managerMemberId: manager } : {}),
      legacy: legacyKeyFor("teams", row.id),
    });
    options.resolver.remember("teams", row.id, created.id);
    tally.wrote(true);
  }

  return { tally: tally.finish(), depth };
}

/** How many teams deep this one sits, counting itself as one. */
function depthOf(
  team: SourceTeam,
  byId: ReadonlyMap<number, SourceTeam>,
): number {
  let depth = 1;
  const seen = new Set<number>([team.id]);
  let current = team;
  while (current.parent_id !== null) {
    const parent = byId.get(current.parent_id);
    // A parent outside this company, a deleted one, or a cycle in the source's
    // own tree. All three end the walk rather than looping forever.
    if (!parent || seen.has(parent.id)) {
      break;
    }
    seen.add(parent.id);
    current = parent;
    depth += 1;
  }
  return depth;
}

/** The secondary membership pivot: who else is in a team. */
async function importSpaceMembers(
  options: MapperOptions,
): Promise<DomainReconciliation> {
  const tally = new DomainTally("space members");
  const seen = new Map<string, Set<string>>();
  const rows = await options.source.query<{ user_id: number; team_id: number }>(
    `select o.user_id, o.team_id
       from other_departments o
       join teams t on t.id = o.team_id
      where t.company_id = ? and t.deleted_at is null
      order by o.id`,
    [options.companyId],
  );

  for (const row of rows) {
    tally.sawRow();
    const source = `other_departments:${row.team_id}/${row.user_id}`;
    const spaceId = await options.resolver.resolve("teams", row.team_id);
    const memberId = await options.resolver.resolve("users", row.user_id);
    if (!spaceId || !memberId) {
      tally.skip(
        source,
        !spaceId
          ? `Team ${row.team_id} did not import, so nobody could be added to it.`
          : `User ${row.user_id} did not import, so they could not be added to team ${row.team_id}.`,
      );
      continue;
    }
    // **Read the space's members once, then compare.** `spaces.addMember` is
    // an upsert: adding somebody who is already there succeeds and says
    // nothing, so calling it blind would report every second run as writing
    // rows it did not write. Idempotency has to be visible in the report or
    // nobody can tell a clean re-run from a duplicating one.
    const already = await membersOf(options, spaceId, seen);
    if (already.has(memberId)) {
      tally.wrote(false);
      continue;
    }

    if (!options.write) {
      tally.wrote(true);
      continue;
    }
    try {
      await callAction(options.context, "spaces.addMember", {
        spaceId,
        memberId,
        role: "member",
      });
      already.add(memberId);
      tally.wrote(true);
    } catch (error) {
      tally.skip(source, messageOf(error));
    }
  }

  return tally.finish();
}

/** Who is in this space now, read once per space and kept for the run. */
async function membersOf(
  options: MapperOptions,
  spaceId: string,
  seen: Map<string, Set<string>>,
): Promise<Set<string>> {
  const cached = seen.get(spaceId);
  if (cached) {
    return cached;
  }
  const space = await callAction(options.context, "spaces.read", {
    id: spaceId,
  });
  const members = new Set(space.members.map((member) => member.memberId));
  seen.set(spaceId, members);
  return members;
}

interface SourceCycle {
  id: number;
  name: string | null;
  cycle_type: string | null;
  type: string | null;
  started_at: string | null;
  finished_at: string | null;
}

/**
 * FlowyTeam's six cycle types onto this product's four cadences.
 *
 * **Weekly and biweekly have no cadence here, and are not widened into one.**
 * METHOD.md's cycle is a planning period a room sets objectives for; a weekly
 * FlowyTeam cycle is a check-in rhythm wearing the same table. One live
 * instance holds 5799 of them, and importing each as a monthly OpenOKR cycle
 * would produce hundreds of cycles nobody planned. They are skipped by name and
 * raised as an open question, which is what §7 asks for when something cannot
 * map cleanly.
 */
const CADENCE: Readonly<Record<string, string>> = {
  annually: "annual",
  semiannually: "semiannual",
  quarterly: "quarterly",
  monthly: "monthly",
};

async function importCycles(
  options: MapperOptions,
): Promise<DomainReconciliation> {
  const tally = new DomainTally("cycles");
  const rows = await options.source.query<SourceCycle>(
    `select id, name, cycle_type, type, started_at, finished_at
       from performance_cycles
      where company_id = ? and deleted_at is null
      order by started_at, id`,
    [options.companyId],
  );

  for (const row of rows) {
    tally.sawRow();
    const source = `performance_cycles:${row.id}`;

    if (row.type === "mindmap") {
      // The Planning module, which §11 puts out of scope.
      tally.skip(source, "This belongs to the Planning module, not to OKRs.");
      continue;
    }
    const cadence = CADENCE[String(row.cycle_type ?? "").toLowerCase()];
    if (!cadence) {
      tally.skip(
        source,
        `This is a "${row.cycle_type}" cycle and OpenOKR has no cadence that short. A planning period is not a check-in rhythm; the check-in frequency is a rhythm setting instead.`,
      );
      continue;
    }
    if (!row.started_at || !row.finished_at) {
      tally.skip(source, "This cycle has no start or no end in the source.");
      continue;
    }
    if (row.finished_at < row.started_at) {
      tally.skip(
        source,
        `This cycle ends on ${row.finished_at}, before it starts on ${row.started_at}.`,
      );
      continue;
    }

    if (!options.write) {
      const already = await options.resolver.resolve(
        "performance_cycles",
        row.id,
      );
      tally.wrote(already === undefined);
      continue;
    }
    if (await options.resolver.resolve("performance_cycles", row.id)) {
      tally.wrote(false);
      continue;
    }

    try {
      const created = await callAction(options.context, "cycles.create", {
        on: row.started_at.slice(0, 10),
        cadence: cadence as "annual" | "semiannual" | "quarterly" | "monthly",
        firstCycle: false,
        ...(row.name ? { name: String(row.name).slice(0, 120) } : {}),
        legacy: legacyKeyFor("performance_cycles", row.id),
      });
      options.resolver.remember("performance_cycles", row.id, created.id);
      tally.wrote(true);
    } catch (error) {
      // Two source cycles falling in one period. The product holds one cycle
      // per period by design, so the second is a report row rather than a
      // second cycle with the same dates.
      tally.skip(source, messageOf(error));
    }
  }

  return tally.finish();
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "Something went wrong importing that row.";
}
