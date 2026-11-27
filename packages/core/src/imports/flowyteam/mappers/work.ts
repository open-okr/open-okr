/**
 * Projects, tasks and their checklists (TECHNICAL-PLAN §7.2, P6-T04a).
 *
 * **A project becomes an initiative and a board does not.** §7.2 maps
 * initiatives from Projects, and FlowyTeam has both: `projects` is a piece of
 * work with a name, an admin and dates, while `task_boards` is a column layout
 * a team looks at. On the instance this reads, 17724 tasks carry a project and
 * 3668 carry a board.
 *
 * **An initiative needs a space and a project does not have one.** FlowyTeam
 * puts no team on a project at all: the space comes from the project admin's
 * own team, and where the admin has none, from a project member who does. That
 * order was not a guess. On the company with the most projects, **none of the
 * 128 has an admin with a team and 125 have a member with one**, so reading
 * only the admin would have placed nothing.
 *
 * **The status of a task comes from its board column, then from its own
 * column.** A column is free text and multilingual on a real instance
 * (`en_proceso` sits beside `in_progress`), so the slug is matched where it is
 * recognised and `tasks.status` decides where it is not. Nothing is guessed
 * from a colour or a position.
 *
 * **`position` is renumbered on load and `progress_pct` is recomputed.** A
 * source system's ordering is its own and this product's spacing is sparse; the
 * completion figure is the engine's, from the tasks that actually imported.
 */
import type { ActionCallContext } from "../../../actions/define.ts";
import { callAction } from "../../../actions/registry.ts";
import { richTextFromPlainText } from "../../../rich-text/from-text.ts";
import { legacyKeyFor } from "../legacy.ts";
import type { Source } from "../source.ts";
import { type DomainReconciliation, DomainTally } from "./reconcile.ts";
import type { Resolver } from "./resolve.ts";

export interface WorkResult {
  readonly domains: readonly DomainReconciliation[];
  /** Task relationships the source models and this product does not. */
  readonly unmodelled: readonly string[];
}

interface MapperOptions {
  /** What people see for the source system, for the space made for loose tasks. */
  readonly sourceName: string;
  readonly source: Source;
  readonly context: ActionCallContext;
  readonly companyId: number;
  readonly resolver: Resolver;
  readonly actingMemberId: string;
  readonly write: boolean;
}

export async function importWork(options: MapperOptions): Promise<WorkResult> {
  const initiatives = await importInitiatives(options);
  const tasks = await importTasks(options);
  const checklists = await importChecklists(options);
  const unmodelled = await unmodelledLinks(options);

  return {
    domains: [initiatives, tasks.tally, checklists],
    unmodelled: [...unmodelled, ...tasks.notes],
  };
}

interface SourceProject {
  id: number;
  project_name: string | null;
  project_summary: string | null;
  project_admin: number | null;
  start_date: string | null;
  deadline: string | null;
  status: string | null;
}

/** FlowyTeam's five project statuses onto this product's four. */
const PROJECT_STATUS: Readonly<Record<string, string>> = {
  "not started": "planned",
  "in progress": "active",
  // A held project is still planned work somebody intends to do. `dropped` is
  // for work abandoned, and saying that about a hold would be wrong.
  "on hold": "planned",
  canceled: "dropped",
  finished: "done",
};

async function importInitiatives(
  options: MapperOptions,
): Promise<DomainReconciliation> {
  const tally = new DomainTally("initiatives");
  const rows = await options.source.read<SourceProject>(
    "work.projects",
    [],
    options.companyId,
  );

  for (const row of rows) {
    tally.sawRow();
    const source = `projects:${row.id}`;
    const title = (row.project_name ?? "").trim();
    if (title === "") {
      tally.skip(source, "This project has no name in the source.");
      continue;
    }

    const spaceId = await spaceFor(options, row);
    if (!spaceId) {
      // Never placed in an arbitrary space: an initiative in the wrong team is
      // work the wrong people are accountable for, and nothing afterwards says
      // it was a guess.
      tally.skip(
        source,
        "Nobody on this project belongs to a team that imported, so there is no space to put it in. Place it by hand and re-run.",
      );
      continue;
    }

    const owner = row.project_admin
      ? await options.resolver.resolve("users", row.project_admin)
      : undefined;
    if (!owner) {
      tally.skip(
        source,
        row.project_admin
          ? `The source names user ${row.project_admin} as this project's admin and that person did not import.`
          : "This project has no admin in the source, and an initiative needs an owner.",
      );
      continue;
    }

    // A deadline before the start is one the product cannot hold, so the
    // start stays, the end is left out, and the report says which and why.
    // Said in the dry run too, so nobody meets it first in the real one.
    const startsOn = row.start_date?.slice(0, 10);
    const deadline = row.deadline?.slice(0, 10);
    const endsOn =
      startsOn && deadline && deadline < startsOn ? undefined : deadline;
    const windowNote =
      deadline && endsOn === undefined
        ? `The source's deadline, ${deadline}, is before its start, ${startsOn}. Imported with the start and no end date.`
        : undefined;

    if (!options.write) {
      const already = await options.resolver.resolve("projects", row.id);
      if (already === undefined) {
        options.resolver.plan("projects", row.id);
        if (windowNote) {
          tally.flag(source, windowNote);
        }
      }
      tally.wrote(already === undefined);
      continue;
    }
    if (await options.resolver.resolve("projects", row.id)) {
      tally.wrote(false);
      continue;
    }
    if (windowNote) {
      tally.flag(source, windowNote);
    }

    const status = PROJECT_STATUS[(row.status ?? "").toLowerCase().trim()];
    if (!status) {
      tally.flag(
        source,
        `The source says this project is "${row.status}", which is not a status this product has. Imported as planned.`,
      );
    }

    try {
      const created = await callAction(options.context, "initiatives.create", {
        spaceId,
        title: title.slice(0, 500),
        ...(row.project_summary?.trim()
          ? { description: richTextFromPlainText(row.project_summary) }
          : {}),
        ownerId: owner,
        ...(startsOn ? { startsOn } : {}),
        ...(endsOn ? { endsOn } : {}),
        status: (status ?? "planned") as
          | "planned"
          | "active"
          | "done"
          | "dropped",
        // `capacity` is left out on purpose. METHOD.md §5.5's verdict is a
        // judgement a room makes about whether the work fits, and no source
        // system holds one.
        legacy: legacyKeyFor("projects", row.id),
      });
      options.resolver.remember("projects", row.id, created.id);
      tally.wrote(true);
    } catch (error) {
      tally.skip(source, messageOf(error));
    }
  }

  return tally.finish();
}

/**
 * The space an imported project belongs in.
 *
 * The admin's own team first, then any project member's. Measured rather than
 * assumed: see the header.
 */
async function spaceFor(
  options: MapperOptions,
  project: SourceProject,
): Promise<string | undefined> {
  const teams = await options.source.read<{ department_id: number | null }>(
    "work.projectAdminTeams",
    [project.project_admin ?? 0, project.id, project.project_admin ?? 0],
    options.companyId,
  );

  for (const row of teams) {
    if (!row.department_id) {
      continue;
    }
    const space = await options.resolver.resolve("teams", row.department_id);
    if (space) {
      return space;
    }
  }
  return undefined;
}

interface SourceTask {
  id: number;
  heading: string | null;
  description: string | null;
  due_date: string | null;
  user_id: number | null;
  project_id: number | null;
  key_results_id: number | null;
  status: string | null;
  board_column_id: number | null;
  dependent_task_id: number | null;
  recurring_task_id: number | null;
}

/**
 * The board column slugs this product recognises.
 *
 * Deliberately short. A column is free text on a real instance and translating
 * `en_proceso` would mean shipping a dictionary; where the slug is not one of
 * these, `tasks.status` decides, which is a fact the source always has.
 */
const COLUMN_STATUS: Readonly<Record<string, string>> = {
  backlog: "backlog",
  to_do: "todo",
  todo: "todo",
  pending: "todo",
  in_progress: "in_progress",
  on_hold: "in_progress",
  incomplete: "todo",
  completed: "done",
  complete: "done",
  done: "done",
};

async function importTasks(
  options: MapperOptions,
): Promise<{ tally: DomainReconciliation; notes: string[] }> {
  const tally = new DomainTally("tasks");
  const rows = await options.source.read<SourceTask>(
    "work.tasks",
    [],
    options.companyId,
  );

  const columns = await columnSlugs(options);
  const spaces = new Map<string, string | undefined>();
  const loose = new LooseTaskPlacement(options, tally);

  for (const row of rows) {
    tally.sawRow();
    const source = `tasks:${row.id}`;
    const title = (row.heading ?? "").trim();
    if (title === "") {
      tally.skip(source, "This task has no heading in the source.");
      continue;
    }

    const initiativeId = row.project_id
      ? await options.resolver.resolve("projects", row.project_id)
      : undefined;
    const keyResultId = row.key_results_id
      ? await options.resolver.resolve("key_results", row.key_results_id)
      : undefined;
    // **The initiative decides, and it is decided before the space is read.**
    // In a dry run the initiative is a row that would be created, so there is
    // no space to read yet and asking for one would refuse every task.
    if (row.project_id && !initiativeId) {
      tally.skip(
        source,
        `Project ${row.project_id} did not import, so its tasks have no space to go in.`,
      );
      continue;
    }
    // A task with no project is placed by the next rules instead (design §3).
    // The rule is chosen before the "already here" check so a second run
    // reports the same counts as the first.
    const placement = initiativeId ? undefined : await loose.choose(row);

    if (!options.write) {
      const already = await options.resolver.resolve("tasks", row.id);
      if (already === undefined) {
        options.resolver.plan("tasks", row.id);
      }
      tally.wrote(already === undefined);
      continue;
    }
    if (await options.resolver.resolve("tasks", row.id)) {
      tally.wrote(false);
      continue;
    }

    const spaceId = placement
      ? await loose.spaceFor(placement)
      : await spaceForTask(options, initiativeId, spaces);
    if (!spaceId) {
      tally.skip(
        source,
        placement
          ? loose.failure()
          : `Initiative ${initiativeId} has no space, so its tasks have nowhere to go.`,
      );
      continue;
    }

    const slug = row.board_column_id
      ? (columns.get(row.board_column_id) ?? "")
      : "";
    const fromColumn = COLUMN_STATUS[slug];
    if (row.board_column_id && slug !== "" && !fromColumn) {
      tally.flag(
        source,
        `The board column "${slug}" is not one this product recognises, so the task's own status decided instead.`,
      );
    }
    const status =
      fromColumn ??
      ((row.status ?? "").toLowerCase() === "completed" ? "done" : "todo");

    const assignee = row.user_id
      ? await options.resolver.resolve("users", row.user_id)
      : undefined;

    try {
      const created = await callAction(options.context, "tasks.create", {
        spaceId,
        title: title.slice(0, 500),
        ...(row.description?.trim()
          ? { description: richTextFromPlainText(row.description) }
          : {}),
        ...(initiativeId ? { initiativeId } : {}),
        ...(keyResultId ? { keyResultId } : {}),
        status: status as "backlog" | "todo" | "in_progress" | "done",
        ...(row.due_date ? { dueOn: row.due_date.slice(0, 10) } : {}),
        ...(assignee ? { assigneeIds: [assignee] } : {}),
        legacy: legacyKeyFor("tasks", row.id),
      });
      options.resolver.remember("tasks", row.id, created.id);
      tally.wrote(true);
    } catch (error) {
      tally.skip(source, messageOf(error));
    }
  }

  return { tally: tally.finish(), notes: loose.notes() };
}

/** Every board column's slug, read once. */
async function columnSlugs(
  options: MapperOptions,
): Promise<ReadonlyMap<number, string>> {
  const rows = await options.source.read<{ id: number; slug: string | null }>(
    "work.boardColumns",
    [],
    options.companyId,
  );
  return new Map(
    rows.map((row) => [row.id, (row.slug ?? "").toLowerCase().trim()]),
  );
}

/**
 * The space of a task's initiative, which is rule 1 of the four that place a
 * task (design flowyteam-standalone-checkins-and-tasks §3).
 *
 * A task with no project never reaches here: `LooseTaskPlacement` places it by
 * its key result's team, its assignee's team, or a space the import creates.
 * A task whose project is named but did not import is still skipped by name,
 * which is a fact somebody can act on.
 *
 * Cached per initiative: a project with two hundred tasks would otherwise read
 * the same row two hundred times.
 */
async function spaceForTask(
  options: MapperOptions,
  initiativeId: string | undefined,
  seen: Map<string, string | undefined>,
): Promise<string | undefined> {
  if (!initiativeId) {
    return undefined;
  }
  if (seen.has(initiativeId)) {
    return seen.get(initiativeId);
  }
  const initiative = await callAction(options.context, "initiatives.read", {
    id: initiativeId,
  });
  const spaceId = initiative.spaceId ?? undefined;
  seen.set(initiativeId, spaceId);
  return spaceId;
}

type LooseRule = "objective" | "assignee" | "created";

interface LoosePlacement {
  readonly rule: LooseRule;
  /** Set for the two team rules. The created space is made on first use. */
  readonly spaceId?: string;
}

/** FlowyTeam's owner class for a team, as `okrs.ts` reads it. */
const TEAM_OWNER = "App\\Models\\Team";

/** The id the space made for loose tasks carries as its legacy id. */
const TASKS_SPACE = "tasks-space";

/**
 * Places the tasks that have no project.
 *
 * **Three rules in a fixed order, then one space nobody chose.** OKRI.io has no
 * project on any task, so the team of the task's key result's objective comes
 * first, the assignee's own team second, and a created space "Tasks from
 * <source>" last. The last one is structure the admin did not pick, so the
 * report counts it and says to move those tasks.
 *
 * The reference data is read once and only when a task needs it, so a company
 * where every task has a project reads nothing extra.
 */
class LooseTaskPlacement {
  private readonly options: MapperOptions;
  private readonly tally: DomainTally;
  private data?: {
    objectiveOfKeyResult: Map<number, number>;
    ownerOfObjective: Map<number, { type: string; id: number }>;
    departmentOfUser: Map<number, number>;
    userIds: number[];
  };
  private tasksSpace?: string;
  private failed?: string;
  private readonly counts: Record<LooseRule, number> = {
    objective: 0,
    assignee: 0,
    created: 0,
  };

  constructor(options: MapperOptions, tally: DomainTally) {
    this.options = options;
    this.tally = tally;
  }

  private async load() {
    if (this.data) {
      return this.data;
    }
    const { source, companyId } = this.options;
    const keyResults = await source.read<{
      id: number;
      objective_id: number;
    }>("okrs.keyResults", [], companyId);
    const objectives = await source.read<{
      id: number;
      model_type: string | null;
      model_id: number | null;
    }>("okrs.objectives", [], companyId);
    const users = await source.read<{
      id: number;
      department_id: number | null;
    }>("organisation.users", [], companyId);

    const departmentOfUser = new Map<number, number>();
    for (const user of users) {
      // The query joins every employee row, so a user can appear twice.
      if (user.department_id && !departmentOfUser.has(user.id)) {
        departmentOfUser.set(user.id, user.department_id);
      }
    }
    this.data = {
      objectiveOfKeyResult: new Map(
        keyResults.map((row) => [row.id, row.objective_id]),
      ),
      ownerOfObjective: new Map(
        objectives.flatMap((row) =>
          row.model_id && row.model_type
            ? [[row.id, { type: row.model_type, id: row.model_id }] as const]
            : [],
        ),
      ),
      departmentOfUser,
      userIds: [...new Set(users.map((user) => user.id))],
    };
    return this.data;
  }

  /** Which rule places this task, counted so the report can say so. */
  async choose(row: SourceTask): Promise<LoosePlacement> {
    const data = await this.load();
    const { resolver } = this.options;

    const objectiveId = row.key_results_id
      ? data.objectiveOfKeyResult.get(row.key_results_id)
      : undefined;
    const owner = objectiveId
      ? data.ownerOfObjective.get(objectiveId)
      : undefined;
    if (owner?.type === TEAM_OWNER) {
      const spaceId = await resolver.resolve("teams", owner.id);
      if (spaceId) {
        this.counts.objective += 1;
        return { rule: "objective", spaceId };
      }
    }

    const department = row.user_id
      ? data.departmentOfUser.get(row.user_id)
      : undefined;
    if (department) {
      const spaceId = await resolver.resolve("teams", department);
      if (spaceId) {
        this.counts.assignee += 1;
        return { rule: "assignee", spaceId };
      }
    }

    this.counts.created += 1;
    return { rule: "created" };
  }

  /** The space for a chosen rule. The created one is made here, once. */
  async spaceFor(placement: LoosePlacement): Promise<string | undefined> {
    if (placement.spaceId) {
      return placement.spaceId;
    }
    if (this.tasksSpace || this.failed) {
      return this.tasksSpace;
    }
    const { resolver, context, sourceName } = this.options;
    const existing = await resolver.resolve("teams", TASKS_SPACE);
    if (existing) {
      this.tasksSpace = existing;
      return existing;
    }
    const data = await this.load();
    try {
      const created = await callAction(context, "spaces.create", {
        name: `Tasks from ${sourceName}`.slice(0, 80),
        legacy: legacyKeyFor("teams", TASKS_SPACE),
      });
      resolver.remember("teams", TASKS_SPACE, created.id);
      this.tasksSpace = created.id;
      for (const userId of data.userIds) {
        const memberId = await resolver.resolve("users", userId);
        if (!memberId) {
          continue;
        }
        try {
          // An upsert, so a member who is already there is not an error.
          await callAction(context, "spaces.addMember", {
            spaceId: created.id,
            memberId,
            role: "member",
          });
        } catch (error) {
          this.tally.flag(
            `users:${userId}`,
            `Could not add this person to the space Tasks from ${sourceName}: ${messageOf(error)}`,
          );
        }
      }
      return created.id;
    } catch (error) {
      this.failed = messageOf(error);
      return undefined;
    }
  }

  failure(): string {
    return `The space for tasks with no project could not be made: ${this.failed ?? "no space was found."}`;
  }

  /** The report line, empty when every task had a project. */
  notes(): string[] {
    const parts = [
      this.counts.objective > 0
        ? `${this.counts.objective} by the team of their key result's objective`
        : "",
      this.counts.assignee > 0
        ? `${this.counts.assignee} by their assignee's team`
        : "",
      this.counts.created > 0
        ? `${this.counts.created} into the new space Tasks from ${this.options.sourceName}`
        : "",
    ].filter((part) => part !== "");
    if (parts.length === 0) {
      return [];
    }
    return [
      `Tasks with no project were placed ${parts.join(", ")}.${
        this.counts.created > 0
          ? ` Move the ones in Tasks from ${this.options.sourceName} to the right space.`
          : ""
      }`,
    ];
  }
}

/** Sub-tasks become checklist lines on the task they hang off. */
async function importChecklists(
  options: MapperOptions,
): Promise<DomainReconciliation> {
  const tally = new DomainTally("checklists");
  const rows = await options.source.read<{
    id: number;
    task_id: number;
    title: string | null;
    status: string | null;
  }>(
    // `sub_tasks` carries no `company_id`, which §11 records: it is scoped
    // through its parent task and nothing else.
    "work.subTasks",
    [],
    options.companyId,
  );

  for (const row of rows) {
    tally.sawRow();
    const source = `sub_tasks:${row.id}`;
    const title = (row.title ?? "").trim();
    if (title === "") {
      tally.skip(source, "This sub-task has no title in the source.");
      continue;
    }
    const taskId = await options.resolver.resolve("tasks", row.task_id);
    if (!taskId) {
      tally.skip(
        source,
        `Task ${row.task_id} did not import, so its checklist could not either.`,
      );
      continue;
    }

    if (!options.write) {
      const already = await options.resolver.resolve("sub_tasks", row.id);
      if (already === undefined) {
        options.resolver.plan("sub_tasks", row.id);
      }
      tally.wrote(already === undefined);
      continue;
    }
    if (await options.resolver.resolve("sub_tasks", row.id)) {
      tally.wrote(false);
      continue;
    }

    try {
      const created = await callAction(
        options.context,
        "tasks.addChecklistItem",
        {
          id: taskId,
          title: title.slice(0, 300),
          legacy: legacyKeyFor("sub_tasks", row.id),
        },
      );
      options.resolver.remember("sub_tasks", row.id, created.id);
      // The source spells a finished sub-task `complete` while a finished task
      // is `completed`. Both mean done.
      if ((row.status ?? "").toLowerCase().startsWith("complete")) {
        await callAction(options.context, "tasks.setChecklistItem", {
          id: taskId,
          itemId: created.id,
          done: true,
        });
      }
      tally.wrote(true);
    } catch (error) {
      tally.skip(source, messageOf(error));
    }
  }

  return tally.finish();
}

/**
 * The task relationships this product does not model, counted and named.
 *
 * §7.2 asks for dependencies to be recorded in the report rather than invented.
 * A recurring task is the same shape of thing: FlowyTeam points one task at the
 * one it repeats, and this product has no recurrence, so the link is a fact
 * about the old system worth writing down and nothing more.
 */
async function unmodelledLinks(
  options: MapperOptions,
): Promise<readonly string[]> {
  const [counts] = await options.source.read<{
    dependent: number;
    recurring: number;
  }>("work.taskLinkCounts", [], options.companyId);

  const notes: string[] = [];
  if (Number(counts?.dependent ?? 0) > 0) {
    notes.push(
      `${Number(counts?.dependent)} tasks depend on another task in the source. This product has no task dependency, so the links are recorded here and not imported.`,
    );
  }
  if (Number(counts?.recurring ?? 0) > 0) {
    notes.push(
      `${Number(counts?.recurring)} tasks repeat another in the source. This product has no recurring task, so those arrive as ordinary tasks.`,
    );
  }
  return notes;
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "Something went wrong importing that row.";
}
