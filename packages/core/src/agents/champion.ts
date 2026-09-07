/**
 * The OKR Champion: seeding and scope (P4-T05a).
 *
 * AI-NATIVE-PLAN.md §6.2 and `docs/design/p4-t00-agent-design.md` §2. One
 * Champion per workspace, created at provisioning, because §4.14's rule is that
 * a fresh workspace practises the full method with nothing configured. An agent
 * an admin has to create first is an agent that never speaks in the workspaces
 * that need it most.
 *
 * Scope is the part worth reading twice. The Champion holds no binding on the
 * workspace context: it is bound to spaces, one binding per space, added as the
 * space is created. That is what "least privilege" means here in practice, and
 * a test asserts the absence rather than trusting the intent.
 */
import {
  activeOnly,
  agents,
  newId,
  type WorkspaceTx,
  workspaceMembers,
} from "@openokr/db";
import { and, eq } from "drizzle-orm";
import { bindGroup, ensureMemberGroup } from "../access/contexts.ts";
import { ACCESS_LEVELS } from "../access/levels.ts";

/** Any transaction that carries the tenant setting, whatever schema it maps. */
type AnyTx<TSchema extends Record<string, unknown> = Record<string, never>> =
  WorkspaceTx<TSchema>;

/** The name the Champion appears under in feeds, mentions and the member list. */
const CHAMPION_NAME = "OKR Champion";

/**
 * The persona, in the agent's own row rather than in a prompt file.
 *
 * It is stored because an admin can read and edit it (P2-T17's agent card), and
 * because an agent whose character lives in code cannot be tuned by the people
 * it speaks to.
 */
const CHAMPION_PERSONA =
  "Guards the rhythm. Chases check-ins, acknowledgements and blockers, opens " +
  "and closes the weekly session, and watches the KPI corridors. Direct and " +
  "brief. Never re-opens a discussion: it moves the clock.";

/**
 * What the Champion is told before it plans, and before it acts.
 *
 * Both are deliberately short. The rules it enforces are not in here: they are
 * in `packages/method`, keyed, and cited by every message. Instructions that
 * restated a threshold would be a second copy of the canon that nothing checks.
 */
const CHAMPION_PLANNING_INSTRUCTIONS =
  "List what is due now, per member and per channel, from the nudge engine. " +
  "Never invent a reason to speak: every message you plan must carry a rule " +
  "key the method package defines.";

const CHAMPION_EXECUTION_INSTRUCTIONS =
  "Deliver what is due and record why. Escalate only by the ladder, and never " +
  "past somebody without them seeing it. Propose, never write, anything that " +
  "changes a goal, a check-in or a KPI.";

export interface SeedChampionInput {
  readonly workspaceId: string;
}

export interface SeededChampion {
  readonly agentId: string;
  readonly memberId: string;
}

/**
 * Creates the Champion member and its agent row.
 *
 * Runs on the caller's transaction, so the agent and the workspace commit
 * together. Idempotent by lookup: a workspace that already has a Champion gets
 * the one it has, which is what makes this safe to call from a backfill as well
 * as from provisioning.
 */
export async function seedChampionInTx<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: AnyTx<TSchema>, input: SeedChampionInput): Promise<SeededChampion> {
  const existing = await championInTx(tx, input.workspaceId);
  if (existing) {
    return existing;
  }

  const memberId = newId();
  // openokr:allow-mutation: this helper writes on the transaction its caller
  // opened, so the agent, its member and the workspace commit together.
  await tx.insert(workspaceMembers).values({
    id: memberId,
    workspaceId: input.workspaceId,
    userId: null,
    name: CHAMPION_NAME,
    kind: "agent",
    status: "active",
  });

  // openokr:allow-mutation: same transaction, same reason.
  const [agent] = await tx
    .insert(agents)
    .values({
      workspaceId: input.workspaceId,
      memberId,
      name: CHAMPION_NAME,
      kind: "champion",
      persona: CHAMPION_PERSONA,
      planningInstructions: CHAMPION_PLANNING_INSTRUCTIONS,
      executionInstructions: CHAMPION_EXECUTION_INSTRUCTIONS,
      schedule: "hourly",
      // §12 A5: propose and approve. Raising this is an admin's explicit
      // decision per agent, never a default and never something a seed does.
      autonomy: "propose",
      enabled: true,
    })
    .returning({ id: agents.id });

  // The member group exists but is bound to nothing. Every grant it will ever
  // hold is a space, added by `bindChampionToSpaceInTx` as spaces appear.
  await ensureMemberGroup(tx, {
    workspaceId: input.workspaceId,
    memberId,
  });

  return { agentId: (agent as { id: string }).id, memberId };
}

/** The workspace's Champion, or nothing if it has none. */
export async function championInTx<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: AnyTx<TSchema>, workspaceId: string): Promise<SeededChampion | null> {
  const [row] = await tx
    .select({ id: agents.id, memberId: agents.memberId })
    .from(agents)
    .where(
      activeOnly(
        agents,
        and(eq(agents.workspaceId, workspaceId), eq(agents.kind, "champion")),
      ),
    )
    .limit(1);
  return row ? { agentId: row.id, memberId: row.memberId } : null;
}

export interface BindChampionToSpaceInput {
  readonly workspaceId: string;
  readonly contextId: string;
}

/**
 * Gives the Champion sight of one space.
 *
 * `view`, not `edit`: the Champion reads goals, check-ins and KPI trees to
 * decide what is due. Everything it changes goes through a proposal, and a
 * proposal needs no write grant. A workspace that later raises the agent's
 * autonomy raises this deliberately, in one place.
 *
 * A workspace with no Champion yet is not an error: `createSpaceInTx` runs
 * during provisioning too, and the seed order is not this function's business.
 */
export async function bindChampionToSpaceInTx<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: AnyTx<TSchema>, input: BindChampionToSpaceInput): Promise<void> {
  const champion = await championInTx(tx, input.workspaceId);
  if (!champion) {
    return;
  }
  const groupId = await ensureMemberGroup(tx, {
    workspaceId: input.workspaceId,
    memberId: champion.memberId,
  });
  await bindGroup(tx, {
    workspaceId: input.workspaceId,
    groupId,
    contextId: input.contextId,
    level: ACCESS_LEVELS.view,
  });
}
