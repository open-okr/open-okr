/**
 * The manager chain (TECHNICAL-PLAN §4.1 `workspace_members.manager_id`,
 * P2-T03).
 *
 * Self-referencing and unconstrained by the schema, so cycle safety is
 * enforced here, in code, before a write rather than by a database
 * constraint that cannot express "no cycle anywhere in the chain."
 */
import { activeOnly, type WorkspaceTx, workspaceMembers } from "@openokr/db";
import { eq } from "drizzle-orm";

type AnyTx<TSchema extends Record<string, unknown> = Record<string, never>> =
  WorkspaceTx<TSchema>;

/** Every manager id above a member, from their direct manager upward. */
async function managerChainAbove<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  workspaceId: string,
  startMemberId: string,
): Promise<string[]> {
  const chain: string[] = [];
  let current: string | undefined = startMemberId;
  // A member count bound rather than an unconditional loop: a chain that
  // already cycled somehow (imported data, a bug in an earlier version)
  // would otherwise spin forever instead of surfacing as a problem.
  for (let hops = 0; hops < 10_000 && current; hops++) {
    const [row] = await tx
      .select({ managerId: workspaceMembers.managerId })
      .from(workspaceMembers)
      .where(
        activeOnly(
          workspaceMembers,
          eq(workspaceMembers.id, current),
          eq(workspaceMembers.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    if (!row?.managerId) {
      break;
    }
    if (chain.includes(row.managerId) || row.managerId === startMemberId) {
      // Already cyclic above this point. Stop rather than loop forever;
      // the caller's own check below still refuses to add to it.
      break;
    }
    chain.push(row.managerId);
    current = row.managerId;
  }
  return chain;
}

export interface ManagerCycleCheckInput {
  readonly workspaceId: string;
  readonly memberId: string;
  readonly proposedManagerId: string;
}

/**
 * True when setting `proposedManagerId` as `memberId`'s manager would create
 * a cycle: either they are the same person, or `proposedManagerId` is
 * (transitively) already managed by `memberId`.
 */
export async function wouldCreateManagerCycle<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: AnyTx<TSchema>, input: ManagerCycleCheckInput): Promise<boolean> {
  if (input.memberId === input.proposedManagerId) {
    return true;
  }
  const chainAboveProposed = await managerChainAbove(
    tx,
    input.workspaceId,
    input.proposedManagerId,
  );
  return chainAboveProposed.includes(input.memberId);
}

export interface PossibleManager {
  readonly id: string;
  readonly name: string;
}

/**
 * Every active member who could safely become `memberId`'s manager: everyone
 * but the member themself and whoever already reports to them, directly or
 * transitively, which is exactly who `wouldCreateManagerCycle` would refuse.
 */
export async function possibleManagers<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  workspaceId: string,
  memberId: string,
): Promise<PossibleManager[]> {
  const all = await tx
    .select({
      id: workspaceMembers.id,
      name: workspaceMembers.name,
      managerId: workspaceMembers.managerId,
    })
    .from(workspaceMembers)
    .where(
      activeOnly(
        workspaceMembers,
        eq(workspaceMembers.workspaceId, workspaceId),
      ),
    );

  // Every id reachable downward from memberId: memberId's reports, their
  // reports, and so on. Any of those becoming memberId's manager would close
  // a loop back to memberId.
  const excluded = new Set<string>([memberId]);
  let frontier = [memberId];
  while (frontier.length > 0) {
    const next = all
      .filter((row) => row.managerId && frontier.includes(row.managerId))
      .map((row) => row.id)
      .filter((id) => !excluded.has(id));
    for (const id of next) {
      excluded.add(id);
    }
    frontier = next;
  }

  return all
    .filter((row) => !excluded.has(row.id))
    .map((row) => ({ id: row.id, name: row.name }));
}

export interface OrgChartNode {
  readonly id: string;
  readonly name: string;
  readonly title: string | null;
  readonly children: OrgChartNode[];
}

/** The manager chain as a tree, rooted at every member with no manager. */
export async function buildOrgChart<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: AnyTx<TSchema>, workspaceId: string): Promise<OrgChartNode[]> {
  const all = await tx
    .select({
      id: workspaceMembers.id,
      name: workspaceMembers.name,
      title: workspaceMembers.title,
      managerId: workspaceMembers.managerId,
    })
    .from(workspaceMembers)
    .where(
      activeOnly(
        workspaceMembers,
        eq(workspaceMembers.workspaceId, workspaceId),
      ),
    );

  // Depth-capped rather than unconditional recursion: `wouldCreateManagerCycle`
  // is what keeps writes cycle-free, and this walk should not turn a bug in
  // that guard, or data edited outside it, into a stack overflow.
  const nodeOf = (row: (typeof all)[number], depth: number): OrgChartNode => ({
    id: row.id,
    name: row.name,
    title: row.title,
    children:
      depth > all.length
        ? []
        : all
            .filter((child) => child.managerId === row.id)
            .map((child) => nodeOf(child, depth + 1)),
  });

  return all.filter((row) => !row.managerId).map((row) => nodeOf(row, 0));
}
