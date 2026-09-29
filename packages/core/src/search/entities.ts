/**
 * The palette's jump by name (UIUX-PLAN §3 "entity jump by short identifier or
 * title", S-32, completeness review M-21).
 *
 * **The jump used to reach a KPI and nothing else.** It looked a short
 * identifier up in `kpis`, the only table that has one, and a member who typed
 * the start of a goal's name was left with the phrase search. That search wants
 * whole words, so "activ" found nothing while "activation" did. This answers
 * the question a palette is for: which thing, of any kind, did you mean.
 *
 * **Matched on the words of the name, as typed.** Every word has to appear in
 * the name, in any case, anywhere in it: "q3 rev" finds "Raise Q3 revenue". A
 * name that is the phrase, or starts with it, outranks one that only contains
 * it, and a shorter name outranks a longer one.
 *
 * **No index serves `ILIKE '%word%'`.** Full text's stems would miss a word
 * half typed ("activa" is not a prefix of the stem "activ"), so this reads the
 * titles. The work-layer design's §5.3 records what that costs at §13.1's
 * scale and the trigram index that would remove it.
 *
 * **Every row is filtered by who is asking, in the query.** The kinds the
 * search index holds are filtered through the access context on each index row,
 * which is the same `EXISTS` clause every list read composes. The kinds it does
 * not hold are read from their own tables under their own read's rule:
 *
 * | Kind | Rule | Same as |
 * |---|---|---|
 * | Goal, key result, KPI, initiative, task, document | The index row's context | `search.query` |
 * | Space | View on the space's context | `spaces.list` |
 * | Session | In the space, or a session with no space | `sessions.read` |
 * | Cycle | View on the workspace's context | `cycles.list` |
 * | Person | An active member | `people.directory` |
 *
 * A result the reader could not open is therefore never offered, which is the
 * whole promise §3 makes for the palette: "all permission-filtered".
 */
import {
  accessContexts,
  activeOnly,
  cycles,
  okrSessions,
  searchDocuments,
  spaces,
  withWorkspace,
  workspaceMembers,
} from "@openokr/db";
import {
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { Pool } from "pg";
import { ACCESS_LEVELS } from "../access/levels.ts";
import {
  type AccessFilterMember,
  accessFilterMember,
  accessScopeFilter,
} from "../access/reads.ts";
import type { OperationTx } from "../operations/operation.ts";
import { hrefsInTx, sessionOpenableBy } from "./hrefs.ts";

/** Every kind the jump can offer, in the order a tie between them breaks. */
export const NAMED_KINDS = [
  "goal",
  "key_result",
  "kpi",
  "space",
  "person",
  "initiative",
  "task",
  "document",
  "session",
  "cycle",
] as const;

type NamedKind = (typeof NAMED_KINDS)[number];

/** The kinds the search index holds a title for. */
const INDEXED_KINDS = [
  "goal",
  "key_result",
  "kpi",
  "initiative",
  "task",
  "document",
] as const;

export interface NamedMatch {
  readonly entityType: NamedKind;
  readonly entityId: string;
  readonly title: string;
  readonly href: string;
}

export interface FindByNameInput {
  readonly workspaceId: string;
  /** Who is asking. Required: a jump without a reader cannot be filtered. */
  readonly memberId: string;
  readonly text: string;
  readonly limit?: number;
}

const DEFAULT_LIMIT = 8;

/**
 * How many words of the phrase count. A palette phrase is a few words; a
 * paragraph pasted into it would otherwise become a paragraph of `ILIKE`s.
 */
const MAX_WORDS = 6;

/**
 * `%`, `_` and the backslash mean something to `LIKE`, and a person typing
 * "50%" means the character. Backslash is Postgres's default escape.
 */
const escapeLike = (text: string) =>
  text.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");

/** The phrase as words, each one a pattern the name has to contain. */
function nameWords(text: string): readonly string[] {
  return text
    .trim()
    .split(/\s+/)
    .filter((word) => word !== "")
    .slice(0, MAX_WORDS);
}

/**
 * How close a name is to what was typed: the whole name, its start, the start
 * of one of its words, or somewhere inside. Lower is closer.
 */
function closeness(title: string, text: string): number {
  const name = title.toLocaleLowerCase();
  const phrase = text.trim().toLocaleLowerCase();
  if (name === phrase) {
    return 0;
  }
  if (name.startsWith(phrase)) {
    return 1;
  }
  if (name.includes(` ${phrase}`)) {
    return 2;
  }
  return 3;
}

/**
 * Everything whose name matches what was typed and that this member may open,
 * closest first.
 */
export async function findByName(
  pool: Pool,
  input: FindByNameInput,
): Promise<NamedMatch[]> {
  const words = nameWords(input.text);
  if (words.length === 0) {
    return [];
  }
  const limit = input.limit ?? DEFAULT_LIMIT;
  const workspaceId = input.workspaceId;
  const phrase = input.text.trim();

  return withWorkspace(drizzle(pool), workspaceId, async (rawTx) => {
    const tx = rawTx as unknown as OperationTx;
    const member = await accessFilterMember(tx, {
      workspaceId,
      memberId: input.memberId,
    });
    if (!member.active) {
      return [];
    }
    const visible = (column: AnyPgColumn) =>
      accessScopeFilter(column, {
        workspaceId,
        memberId: input.memberId,
        minLevel: ACCESS_LEVELS.view,
        member,
      });
    const named = (column: AnyPgColumn): SQL[] =>
      words.map((word) => ilike(column, `%${escapeLike(word)}%`));
    // Best first inside each source too, so the limit below keeps the names
    // that start with the phrase rather than whichever rows came back first.
    const startsFirst = (column: AnyPgColumn) => [
      desc(ilike(column, `${escapeLike(phrase)}%`)),
      asc(sql`length(${column})`),
    ];

    const found: { entityType: NamedKind; entityId: string; title: string }[] =
      [];

    const indexed = await tx
      .select({
        entityType: searchDocuments.entityType,
        entityId: searchDocuments.entityId,
        title: searchDocuments.title,
      })
      .from(searchDocuments)
      .where(
        and(
          eq(searchDocuments.workspaceId, workspaceId),
          inArray(searchDocuments.entityType, [...INDEXED_KINDS]),
          ...named(searchDocuments.title),
          visible(searchDocuments.contextId),
        ),
      )
      .orderBy(...startsFirst(searchDocuments.title))
      .limit(limit);
    for (const row of indexed) {
      found.push({
        entityType: row.entityType as NamedKind,
        entityId: row.entityId,
        title: row.title,
      });
    }

    const spaceRows = await tx
      .select({ id: spaces.id, name: spaces.name })
      // openokr:allow-raw-read: the list form of the getter, as `spaces.list`
      // reads it: every row is filtered by accessScopeFilter on the space's own
      // context below.
      .from(spaces)
      .innerJoin(
        accessContexts,
        activeOnly(
          accessContexts,
          eq(accessContexts.workspaceId, workspaceId),
          eq(accessContexts.resourceType, "space"),
          eq(accessContexts.resourceId, spaces.id),
        ),
      )
      .where(
        and(
          activeOnly(
            spaces,
            eq(spaces.workspaceId, workspaceId),
            ...named(spaces.name),
          ),
          visible(accessContexts.id),
        ),
      )
      .orderBy(...startsFirst(spaces.name))
      .limit(limit);
    for (const row of spaceRows) {
      found.push({ entityType: "space", entityId: row.id, title: row.name });
    }

    found.push(
      ...(await sessionsNamed(tx, {
        workspaceId,
        memberId: input.memberId,
        member,
        words: named(okrSessions.title),
        order: startsFirst(okrSessions.title),
        limit,
      })),
    );

    // A cycle belongs to the workspace, so the workspace's own context is
    // what decides, exactly as `cycles.list` asks it.
    const cycleRows = await tx
      .select({ id: cycles.id, name: cycles.name })
      .from(cycles)
      .innerJoin(
        accessContexts,
        activeOnly(
          accessContexts,
          eq(accessContexts.workspaceId, workspaceId),
          eq(accessContexts.resourceType, "workspace"),
          eq(accessContexts.resourceId, cycles.workspaceId),
        ),
      )
      .where(
        and(
          activeOnly(
            cycles,
            eq(cycles.workspaceId, workspaceId),
            ...named(cycles.name),
          ),
          visible(accessContexts.id),
        ),
      )
      .orderBy(...startsFirst(cycles.name))
      .limit(limit);
    for (const row of cycleRows) {
      found.push({ entityType: "cycle", entityId: row.id, title: row.name });
    }

    // The directory's own rule: every active member, and nobody suspended.
    const people = await tx
      .select({ id: workspaceMembers.id, name: workspaceMembers.name })
      .from(workspaceMembers)
      .where(
        activeOnly(
          workspaceMembers,
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.status, "active"),
          ...named(workspaceMembers.name),
        ),
      )
      .orderBy(...startsFirst(workspaceMembers.name))
      .limit(limit);
    for (const row of people) {
      found.push({ entityType: "person", entityId: row.id, title: row.name });
    }

    const order = (kind: NamedKind) => NAMED_KINDS.indexOf(kind);
    const best = found
      .sort(
        (a, b) =>
          closeness(a.title, phrase) - closeness(b.title, phrase) ||
          a.title.length - b.title.length ||
          order(a.entityType) - order(b.entityType),
      )
      .slice(0, limit);

    const hrefs = await hrefsInTx(tx, workspaceId, input.memberId, best);
    return best.flatMap((one) => {
      const href = hrefs.get(`${one.entityType}:${one.entityId}`);
      return href ? [{ ...one, href }] : [];
    });
  });
}

/**
 * The sessions this member could open, by name.
 *
 * **Stricter than the space.** Every member can read every space, so that a
 * space can be found and joined; a session is a room you are in, and
 * `sessions.read` refuses somebody who is not in its space. Offering a session
 * that then refused to open would be worse than not offering it, so the same
 * rule applies here. A session with no space belongs to the workspace, and
 * every active member reads it.
 */
async function sessionsNamed(
  tx: OperationTx,
  input: {
    readonly workspaceId: string;
    readonly memberId: string;
    readonly member: AccessFilterMember;
    readonly words: readonly SQL[];
    readonly order: readonly SQL[];
    readonly limit: number;
  },
): Promise<{ entityType: NamedKind; entityId: string; title: string }[]> {
  const rows = await tx
    .select({ id: okrSessions.id, title: okrSessions.title })
    .from(okrSessions)
    .leftJoin(
      accessContexts,
      activeOnly(
        accessContexts,
        eq(accessContexts.workspaceId, input.workspaceId),
        eq(accessContexts.resourceType, "space"),
        eq(accessContexts.resourceId, okrSessions.spaceId),
      ),
    )
    .where(
      and(
        activeOnly(
          okrSessions,
          eq(okrSessions.workspaceId, input.workspaceId),
          ...input.words,
        ),
        sessionOpenableBy(tx, input.workspaceId, input.memberId),
        or(
          isNull(okrSessions.spaceId),
          accessScopeFilter(accessContexts.id, {
            workspaceId: input.workspaceId,
            memberId: input.memberId,
            minLevel: ACCESS_LEVELS.view,
            member: input.member,
          }),
        ),
      ),
    )
    .orderBy(...input.order)
    .limit(input.limit);
  return rows.map((row) => ({
    entityType: "session" as const,
    entityId: row.id,
    title: row.title,
  }));
}
