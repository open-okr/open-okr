/**
 * The OKR Coach: seeding and scope (P4-T06a).
 *
 * AI-NATIVE-PLAN.md §6.1 and `docs/design/p4-t00-agent-design.md` §1. One Coach
 * per workspace, created at provisioning, for the reason the Champion is: §4.14
 * says a fresh workspace practises the full method with nothing configured, and
 * an agent an admin has to create first never speaks in the workspaces that
 * need it most.
 *
 * Deliberately close to `champion.ts` rather than shared with it. The two agents
 * differ in exactly the fields that matter here (kind, persona, instructions,
 * schedule), and a single `seedAgent(kind)` helper taking four strings would
 * hide those differences behind a parameter while saving about ten lines. The
 * one thing that **is** shared is the space binding rule, and that is shared as
 * a rule rather than as code: both agents get `view` on named spaces and
 * nothing workspace-wide, and both have a test asserting the absence.
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

const COACH_NAME = "OKR Coach";

/**
 * The persona, in the agent's own row rather than in a prompt file.
 *
 * "Its whole vocabulary is METHOD.md" is §6.1's own first line, and it is the
 * sentence that matters most here: the Coach has no opinions of its own to
 * express, only rules to cite.
 */
const COACH_PERSONA =
  "Guards quality. Reads every objective and key result against the method " +
  "catalogue and says which rule is not met and why. Never rewrites without " +
  "being asked, never softens a rule to be liked, and never says a goal is " +
  "bad: it names the rule and asks the question that exposes the gap.";

/**
 * What the Coach is told before it plans, and before it acts.
 *
 * No threshold, word list or check appears in either. Those live in
 * `packages/method`, keyed, and every message cites its key; instructions that
 * restated a rule would be a second copy of the canon that nothing checks.
 */
const COACH_PLANNING_INSTRUCTIONS =
  "List the checks that are failing, per goal, from the stored verdicts and " +
  "the alignment findings. Never invent a reason to speak: every message you " +
  "plan must carry a rule key the method package defines.";

const COACH_EXECUTION_INSTRUCTIONS =
  "Name the rule, say what was seen, and ask the question that exposes the " +
  "gap. Propose, never write, anything that changes a goal or a key result. " +
  "A dismissed finding stays dismissed.";

export interface SeedCoachInput {
  readonly workspaceId: string;
}

export interface SeededCoach {
  readonly agentId: string;
  readonly memberId: string;
}

/**
 * Creates the Coach member and its agent row.
 *
 * Runs on the caller's transaction, so the agent and the workspace commit
 * together. Idempotent by lookup, which is what makes this safe to call from a
 * backfill as well as from provisioning.
 *
 * The schedule is `continuous`, which §6.1's table means literally: the Coach's
 * evaluation happens on every goal and key result write, and P4-T02a already
 * does that inside the writing transaction. What this task adds is the run that
 * turns those stored verdicts into messages.
 */
export async function seedCoachInTx<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: AnyTx<TSchema>, input: SeedCoachInput): Promise<SeededCoach> {
  const existing = await coachInTx(tx, input.workspaceId);
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
    name: COACH_NAME,
    kind: "agent",
    status: "active",
  });

  // openokr:allow-mutation: same transaction, same reason.
  const [agent] = await tx
    .insert(agents)
    .values({
      workspaceId: input.workspaceId,
      memberId,
      name: COACH_NAME,
      kind: "coach",
      persona: COACH_PERSONA,
      planningInstructions: COACH_PLANNING_INSTRUCTIONS,
      executionInstructions: COACH_EXECUTION_INSTRUCTIONS,
      schedule: "continuous",
      // §12 A5 and design §1.4: propose and approve. `scoped_direct`, which
      // would let the Coach write quality flags itself, is an explicit per
      // workspace opt-in and never something a seed does.
      autonomy: "propose",
      enabled: true,
    })
    .returning({ id: agents.id });

  // The member group exists and is bound to nothing. Every grant it will hold
  // is a space, added by `bindCoachToSpaceInTx` as spaces appear.
  await ensureMemberGroup(tx, {
    workspaceId: input.workspaceId,
    memberId,
  });

  return { agentId: (agent as { id: string }).id, memberId };
}

/** The workspace's Coach, or nothing if it has none. */
export async function coachInTx<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: AnyTx<TSchema>, workspaceId: string): Promise<SeededCoach | null> {
  const [row] = await tx
    .select({ id: agents.id, memberId: agents.memberId })
    .from(agents)
    .where(
      activeOnly(
        agents,
        and(eq(agents.workspaceId, workspaceId), eq(agents.kind, "coach")),
      ),
    )
    .limit(1);
  return row ? { agentId: row.id, memberId: row.memberId } : null;
}

export interface BindCoachToSpaceInput {
  readonly workspaceId: string;
  readonly contextId: string;
}

/**
 * Gives the Coach sight of one space.
 *
 * `view`, not `edit`, and that is a narrower grant than design §1.3's "read +
 * quality flags write" describes. It is narrower on purpose: the Coach's
 * autonomy is `propose`, so it writes nothing, and P4-T02a already recomputes
 * the flags inside the writing transaction of whoever edited the goal. Granting
 * a write the agent never uses would be a standing permission with no caller,
 * which is the shape a privilege escalation hides in. A workspace that opts into
 * `scoped_direct` raises this deliberately, in one place, and the design
 * document is corrected to say so.
 */
export async function bindCoachToSpaceInTx<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: AnyTx<TSchema>, input: BindCoachToSpaceInput): Promise<void> {
  const coach = await coachInTx(tx, input.workspaceId);
  if (!coach) {
    return;
  }
  const groupId = await ensureMemberGroup(tx, {
    workspaceId: input.workspaceId,
    memberId: coach.memberId,
  });
  await bindGroup(tx, {
    workspaceId: input.workspaceId,
    groupId,
    contextId: input.contextId,
    level: ACCESS_LEVELS.view,
  });
}
