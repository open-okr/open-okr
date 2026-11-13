/**
 * The palette's Recent group (docs/design/work-layer.md §5.1, plan 0.9.0 G2).
 *
 * **The browser's list is a hint, never an authority.** The palette keeps the
 * last twenty things a member opened in `localStorage` and sends them here.
 * Each one is read again for this member, so a thing they lost access to, or
 * that was deleted, is simply absent from the answer, and the browser prunes
 * what did not come back. Nothing about what anybody read is stored on the
 * server.
 *
 * **A new device starts from what the member changed.** With no refs, the
 * answer is the member's own last distinct subjects in `activities`. The
 * activity feed records writes and never reads, and this adds no row to it.
 *
 * **How a thing is judged readable.** The same rule the jump by name applies,
 * kind by kind (`search/entities.ts` has the table). The kinds the search
 * index holds are read through the access context on their index row, and the
 * index row of a deleted thing is removed by the relay a moment after the
 * delete. The source table is read as well, so a delete takes effect at once
 * and not when the relay next runs.
 */
import {
  accessContexts,
  activeOnly,
  searchDocuments,
  spaces,
  withWorkspace,
  workspaceMembers,
} from "@openokr/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { accessFilterMember, accessScopeFilter } from "../access/reads.ts";
import { SHORT_ID_TABLES } from "../ids/short.ts";
import type { OperationTx } from "../operations/operation.ts";
import { hrefsInTx } from "./hrefs.ts";

/** The kinds a member can have opened, which are the ones with a page. */
export const RECENT_KINDS = [
  "goal",
  "key_result",
  "kpi",
  "initiative",
  "task",
  "person",
  "space",
] as const;

export type RecentKind = (typeof RECENT_KINDS)[number];

/** How many a member keeps, and so the most this answers. */
export const RECENT_LIMIT = 20;

/**
 * How many activity subjects are looked at before the access filter. Some of
 * them will be refused, and the answer should still reach twenty when it can.
 */
const ACTIVITY_SCAN = 60;

export interface RecentRef {
  readonly kind: RecentKind;
  readonly id: string;
}

export interface RecentEntity {
  readonly entityType: RecentKind;
  readonly entityId: string;
  readonly title: string;
  readonly href: string;
}

/** What `activities.subject_type` calls each kind. A person is a member row. */
const ACTIVITY_SUBJECT: Readonly<Record<string, RecentKind>> = {
  goal: "goal",
  key_result: "key_result",
  kpi: "kpi",
  initiative: "initiative",
  task: "task",
  workspace_member: "person",
  space: "space",
};

const INDEXED = ["goal", "key_result", "kpi", "initiative", "task"] as const;
type IndexedKind = (typeof INDEXED)[number];
const isIndexed = (kind: RecentKind): kind is IndexedKind =>
  (INDEXED as readonly string[]).includes(kind);

const keyOf = (kind: string, id: string) => `${kind}:${id}`;

async function fromActivity(
  tx: OperationTx,
  workspaceId: string,
  memberId: string,
): Promise<RecentRef[]> {
  const subjectTypes = Object.keys(ACTIVITY_SUBJECT);
  const { rows } = await tx.execute<{
    subject_type: string;
    subject_id: string;
  }>(
    sql`select subject_type, subject_id
          from (
            select distinct on (subject_type, subject_id)
                   subject_type, subject_id, at
              from activities
             where workspace_id = ${workspaceId}
               and actor_member_id = ${memberId}
               and subject_type = any(${sql.param(subjectTypes)}::text[])
             order by subject_type, subject_id, at desc
          ) latest
         order by at desc
         limit ${ACTIVITY_SCAN}`,
  );
  return rows.flatMap((row) => {
    const kind = ACTIVITY_SUBJECT[row.subject_type];
    return kind ? [{ kind, id: row.subject_id }] : [];
  });
}

/**
 * The things among these refs this member may still open, in the order given,
 * at most twenty. With no refs, the member's own last changes instead.
 */
export async function recentEntities(
  pool: Pool,
  input: {
    readonly workspaceId: string;
    readonly memberId: string;
    readonly refs?: readonly RecentRef[];
  },
): Promise<RecentEntity[]> {
  const { workspaceId, memberId } = input;

  return withWorkspace(drizzle(pool), workspaceId, async (rawTx) => {
    const tx = rawTx as unknown as OperationTx;
    const member = await accessFilterMember(tx, { workspaceId, memberId });
    if (!member.active) {
      return [];
    }

    const asked =
      input.refs && input.refs.length > 0
        ? input.refs
        : await fromActivity(tx, workspaceId, memberId);
    // The same thing twice would be listed twice, and the first is the newest.
    const seen = new Set<string>();
    const candidates = asked.filter((ref) => {
      const key = keyOf(ref.kind, ref.id);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
    if (candidates.length === 0) {
      return [];
    }
    const idsOf = (kind: RecentKind) =>
      candidates.filter((ref) => ref.kind === kind).map((ref) => ref.id);
    const visible = (column: Parameters<typeof accessScopeFilter>[0]) =>
      accessScopeFilter(column, {
        workspaceId,
        memberId,
        minLevel: ACCESS_LEVELS.view,
        member,
      });

    const titles = new Map<string, string>();

    const indexedIds = candidates
      .filter((ref) => isIndexed(ref.kind))
      .map((ref) => ref.id);
    if (indexedIds.length > 0) {
      const rows = await tx
        .select({
          entityType: searchDocuments.entityType,
          entityId: searchDocuments.entityId,
          title: searchDocuments.title,
        })
        .from(searchDocuments)
        .where(
          and(
            eq(searchDocuments.workspaceId, workspaceId),
            inArray(searchDocuments.entityType, [...INDEXED]),
            inArray(searchDocuments.entityId, indexedIds),
            visible(searchDocuments.contextId),
          ),
        );
      // Which of them still exist in their own table. A kind per query, since
      // each table is its own.
      const alive = new Set<string>();
      for (const kind of INDEXED) {
        const ids = idsOf(kind);
        if (ids.length === 0) {
          continue;
        }
        const live = await tx.execute<{ id: string }>(
          sql`select id from ${sql.identifier(SHORT_ID_TABLES[kind])}
               where workspace_id = ${workspaceId}
                 and deleted_at is null
                 and id = any(${sql.param(ids)}::uuid[])`,
        );
        for (const row of live.rows) {
          alive.add(keyOf(kind, row.id));
        }
      }
      for (const row of rows) {
        const key = keyOf(row.entityType, row.entityId);
        if (alive.has(key)) {
          titles.set(key, row.title);
        }
      }
    }

    const spaceIds = idsOf("space");
    if (spaceIds.length > 0) {
      // `spaces.list`'s rule: view on the space's own context.
      const rows = await tx
        .select({ id: spaces.id, name: spaces.name })
        // openokr:allow-raw-read: the list form of the getter, as `spaces.list`
        // reads it: every row is filtered by accessScopeFilter on the space's
        // own context below.
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
              inArray(spaces.id, spaceIds),
            ),
            visible(accessContexts.id),
          ),
        );
      for (const row of rows) {
        titles.set(keyOf("space", row.id), row.name);
      }
    }

    const personIds = idsOf("person");
    if (personIds.length > 0) {
      // The directory's own rule: every active member, nobody suspended.
      const rows = await tx
        .select({ id: workspaceMembers.id, name: workspaceMembers.name })
        .from(workspaceMembers)
        .where(
          activeOnly(
            workspaceMembers,
            eq(workspaceMembers.workspaceId, workspaceId),
            eq(workspaceMembers.status, "active"),
            inArray(workspaceMembers.id, personIds),
          ),
        );
      for (const row of rows) {
        titles.set(keyOf("person", row.id), row.name);
      }
    }

    const readable = candidates
      .filter((ref) => titles.has(keyOf(ref.kind, ref.id)))
      .slice(0, RECENT_LIMIT);
    const hrefs = await hrefsInTx(
      tx,
      workspaceId,
      memberId,
      readable.map((ref) => ({ entityType: ref.kind, entityId: ref.id })),
    );
    return readable.flatMap((ref) => {
      const key = keyOf(ref.kind, ref.id);
      const title = titles.get(key);
      const href = hrefs.get(key);
      return title !== undefined && href
        ? [{ entityType: ref.kind, entityId: ref.id, title, href }]
        : [];
    });
  });
}
