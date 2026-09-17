/**
 * The SCIM Groups resource, mapped to space membership (P8-T08b).
 *
 * An identity provider's group is how an organisation says who belongs
 * together. The product's own answer to that is a space, so a group becomes a
 * space and the group's membership becomes the space's.
 *
 * **Every membership change goes through `spaces.addMember` and
 * `spaces.removeMember`**, because those actions do more than write a row:
 * they grant and take back the access that comes with a space role. A direct
 * insert would leave somebody listed in a space they cannot open.
 *
 * **A group removed from a space keeps its workspace membership.** Losing a
 * team is not leaving the company, and the two questions have two answers
 * here: the Users resource decides whether somebody is in the workspace at
 * all, and this decides which spaces they are in.
 */
import {
  activeOnly,
  directorySyncGroups,
  spaceMembers,
  withWorkspace,
} from "@openokr/db";
import { and, asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { callAction } from "../actions/registry.ts";

/** A directory group, as this surface holds it. */
export interface DirectoryGroup {
  readonly groupId: string;
  readonly externalId: string;
  readonly displayName: string;
  readonly spaceId: string;
  /** The member ids in the space this group maps to. */
  readonly memberIds: readonly string[];
}

export interface SyncDirectoryGroupInput {
  readonly workspaceId: string;
  /** The directory's own id for the group. */
  readonly externalId: string;
  readonly displayName: string;
  /**
   * Who the directory says is in it, as member ids.
   *
   * Absent means "this call is not about membership", which is what a rename
   * looks like. An empty array means the directory says nobody is in it, and
   * everybody is removed. The two are deliberately different.
   */
  readonly memberIds?: readonly string[];
}

const asSystem = (pool: Pool, workspaceId: string) => ({
  pool,
  workspaceId,
  actor: { kind: "system" as const },
});

/** The mapping row for one group, or null. */
async function mappingFor(
  pool: Pool,
  workspaceId: string,
  externalId: string,
): Promise<{ id: string; spaceId: string; displayName: string } | null> {
  const [row] = await withWorkspace(drizzle(pool), workspaceId, (tx) =>
    tx
      .select({
        id: directorySyncGroups.id,
        spaceId: directorySyncGroups.spaceId,
        displayName: directorySyncGroups.displayName,
      })
      .from(directorySyncGroups)
      .where(
        and(
          eq(directorySyncGroups.workspaceId, workspaceId),
          eq(directorySyncGroups.externalId, externalId),
        ),
      )
      .limit(1),
  );
  return row ?? null;
}

/** Everybody in a space, oldest first. */
async function spaceMemberIds(
  pool: Pool,
  workspaceId: string,
  spaceId: string,
): Promise<readonly string[]> {
  const rows = await withWorkspace(drizzle(pool), workspaceId, (tx) =>
    tx
      .select({ memberId: spaceMembers.memberId })
      .from(spaceMembers)
      .where(
        activeOnly(
          spaceMembers,
          and(
            eq(spaceMembers.workspaceId, workspaceId),
            eq(spaceMembers.spaceId, spaceId),
          ),
        ),
      )
      .orderBy(asc(spaceMembers.createdAt)),
  );
  return rows.map((row) => row.memberId);
}

/**
 * Creates or updates the group, and makes its space's membership match.
 *
 * Idempotent, because a directory sends its whole state on a schedule rather
 * than a change at a time. A second identical call adds nobody, removes
 * nobody and writes no audit rows.
 */
export async function syncDirectoryGroup(
  pool: Pool,
  input: SyncDirectoryGroupInput,
): Promise<DirectoryGroup> {
  const existing = await mappingFor(pool, input.workspaceId, input.externalId);

  let spaceId: string;
  let groupId: string;

  if (existing) {
    spaceId = existing.spaceId;
    groupId = existing.id;

    // A rename in the directory is a rename here. The mapping is what makes
    // that possible: without it a renamed group would look like a new one.
    if (existing.displayName !== input.displayName) {
      await callAction(asSystem(pool, input.workspaceId), "spaces.update", {
        id: spaceId,
        name: input.displayName,
      });
      // openokr:allow-mutation: the mapping is a pointer between a directory
      // id and a space, not domain content. The space's own rename above is
      // the audited change.
      await withWorkspace(drizzle(pool), input.workspaceId, (tx) =>
        tx
          .update(directorySyncGroups)
          .set({ displayName: input.displayName, updatedAt: new Date() })
          .where(eq(directorySyncGroups.id, groupId)),
      );
    }
  } else {
    const space = await callAction(
      asSystem(pool, input.workspaceId),
      "spaces.create",
      { name: input.displayName },
    );
    spaceId = (space as { id: string }).id;

    // openokr:allow-mutation: the pointer again. The space it points at was
    // created through its own action a moment ago, with its audit row.
    const [mapping] = await withWorkspace(
      drizzle(pool),
      input.workspaceId,
      (tx) =>
        tx
          .insert(directorySyncGroups)
          .values({
            workspaceId: input.workspaceId,
            externalId: input.externalId,
            displayName: input.displayName,
            spaceId,
          })
          .returning({ id: directorySyncGroups.id }),
    );
    groupId = mapping?.id as string;
  }

  if (input.memberIds) {
    await reconcileMembership(pool, {
      workspaceId: input.workspaceId,
      spaceId,
      memberIds: input.memberIds,
    });
  }

  return {
    groupId,
    externalId: input.externalId,
    displayName: input.displayName,
    spaceId,
    memberIds: await spaceMemberIds(pool, input.workspaceId, spaceId),
  };
}

/**
 * Adds and removes until the space matches the list.
 *
 * The difference is computed rather than the space emptied and refilled: a
 * removal takes back access and an addition grants it, so rewriting an
 * unchanged membership would revoke and re-grant everybody on every sync, and
 * anything watching that access would see a flicker that never happened.
 *
 * **A space with members needs a manager, and no directory says who.** The
 * space action refuses a removal that would leave a populated space with
 * nobody managing it, which is right and has nothing to do with directories.
 * So the first person a group brings gets the role, somebody else is promoted
 * before the last manager leaves, and managers are removed last when the
 * space is being emptied. An administrator can appoint whoever they meant to
 * afterwards; what this must not do is fail half-way and leave the space
 * matching neither the directory nor what it held before.
 */
async function reconcileMembership(
  pool: Pool,
  input: {
    readonly workspaceId: string;
    readonly spaceId: string;
    readonly memberIds: readonly string[];
  },
): Promise<void> {
  const current = await spaceMembersWithRoles(
    pool,
    input.workspaceId,
    input.spaceId,
  );
  const wanted = new Set(input.memberIds);
  const held = new Map(current.map((row) => [row.memberId, row.role]));

  let hasManager = current.some((row) => row.role === "manager");

  for (const memberId of wanted) {
    if (held.has(memberId)) {
      continue;
    }
    const role = hasManager ? "member" : "manager";
    await callAction(asSystem(pool, input.workspaceId), "spaces.addMember", {
      spaceId: input.spaceId,
      memberId,
      role,
    });
    held.set(memberId, role);
    hasManager = true;
  }

  const leaving = [...held.keys()].filter((memberId) => !wanted.has(memberId));
  const staying = [...held.keys()].filter((memberId) => wanted.has(memberId));

  // Somebody has to manage what is left. Only when anybody is left: an empty
  // space needs no manager, and the action agrees.
  if (
    staying.length > 0 &&
    !staying.some((memberId) => held.get(memberId) === "manager")
  ) {
    const successor = staying[0] as string;
    await callAction(
      asSystem(pool, input.workspaceId),
      "spaces.setMemberRole",
      { spaceId: input.spaceId, memberId: successor, role: "manager" },
    );
    held.set(successor, "manager");
  }

  // Managers last, so emptying a space never trips the rule on the way down.
  const order = [
    ...leaving.filter((memberId) => held.get(memberId) !== "manager"),
    ...leaving.filter((memberId) => held.get(memberId) === "manager"),
  ];
  for (const memberId of order) {
    await callAction(asSystem(pool, input.workspaceId), "spaces.removeMember", {
      spaceId: input.spaceId,
      memberId,
    });
  }
}

/** Everybody in a space with the role they hold, oldest first. */
async function spaceMembersWithRoles(
  pool: Pool,
  workspaceId: string,
  spaceId: string,
): Promise<ReadonlyArray<{ memberId: string; role: string }>> {
  return withWorkspace(drizzle(pool), workspaceId, (tx) =>
    tx
      .select({ memberId: spaceMembers.memberId, role: spaceMembers.role })
      .from(spaceMembers)
      .where(
        activeOnly(
          spaceMembers,
          and(
            eq(spaceMembers.workspaceId, workspaceId),
            eq(spaceMembers.spaceId, spaceId),
          ),
        ),
      )
      .orderBy(asc(spaceMembers.createdAt)),
  );
}

/** Every mapped group in the workspace. */
export async function listDirectoryGroups(
  pool: Pool,
  workspaceId: string,
  externalId?: string,
): Promise<readonly DirectoryGroup[]> {
  const rows = await withWorkspace(drizzle(pool), workspaceId, (tx) =>
    tx
      .select({
        id: directorySyncGroups.id,
        externalId: directorySyncGroups.externalId,
        displayName: directorySyncGroups.displayName,
        spaceId: directorySyncGroups.spaceId,
      })
      .from(directorySyncGroups)
      .where(
        externalId
          ? and(
              eq(directorySyncGroups.workspaceId, workspaceId),
              eq(directorySyncGroups.externalId, externalId),
            )
          : eq(directorySyncGroups.workspaceId, workspaceId),
      )
      .orderBy(asc(directorySyncGroups.createdAt)),
  );

  const groups: DirectoryGroup[] = [];
  for (const row of rows) {
    groups.push({
      groupId: row.id,
      externalId: row.externalId,
      displayName: row.displayName,
      spaceId: row.spaceId,
      memberIds: await spaceMemberIds(pool, workspaceId, row.spaceId),
    });
  }
  return groups;
}

/** One mapped group by its own id, or null. */
export async function directoryGroupById(
  pool: Pool,
  workspaceId: string,
  groupId: string,
): Promise<DirectoryGroup | null> {
  const groups = await listDirectoryGroups(pool, workspaceId);
  return groups.find((group) => group.groupId === groupId) ?? null;
}

/**
 * Unmaps a group: everybody leaves its space, and the space stays.
 *
 * **The space is not archived.** A directory deleting a group is a statement
 * about who works together, not permission to put a workspace's goals, tasks
 * and documents out of reach. Emptying it takes back exactly the access the
 * group granted, and an administrator who wants the space gone can archive it
 * themselves, which is the one place that decision belongs.
 */
export async function unmapDirectoryGroup(
  pool: Pool,
  workspaceId: string,
  groupId: string,
): Promise<boolean> {
  const group = await directoryGroupById(pool, workspaceId, groupId);
  if (!group) {
    return false;
  }

  await reconcileMembership(pool, {
    workspaceId,
    spaceId: group.spaceId,
    memberIds: [],
  });

  // openokr:allow-mutation: removing the pointer. Every access the group
  // granted was taken back through `spaces.removeMember` above, each with its
  // own audit row.
  await withWorkspace(drizzle(pool), workspaceId, (tx) =>
    tx.delete(directorySyncGroups).where(eq(directorySyncGroups.id, groupId)),
  );
  return true;
}
