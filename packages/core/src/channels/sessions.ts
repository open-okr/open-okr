/**
 * Finding the session a chat message is about (P5-T06c).
 *
 * **The lookup the design left open.** `sessions.createBlocker` and
 * `sessions.setCommitments` both need a session id, and a sender names a key
 * result or nothing at all. The design document's §7 lists both commands and
 * says nothing about how a message finds a session, which is why P5-T06b left
 * them out rather than guessing in the middle of another task.
 *
 * The rule, stated once here:
 *
 * | The sender named | The session is |
 * |---|---|
 * | a key result | the running session in that key result's goal's space |
 * | nothing | the running session in the one space they are in that has one |
 *
 * **Only a running session.** A blocker raised into a scheduled session is a
 * blocker nobody is in the room for, and a commitment made into a closed one is
 * a commitment against a week that has finished. Both refuse and say so, which
 * is what §5.3 asks of a refusal to a member the product knows.
 *
 * **Ambiguity refuses rather than picking.** A member in two spaces with two
 * sessions running gets told to say which; the product cannot ask Slack which
 * one they meant, and choosing for them would put somebody's blocker on the
 * wrong team's board.
 */
import {
  activeOnly,
  goals,
  keyResults,
  okrSessions,
  spaceMembers,
  type WorkspaceTx,
} from "@openokr/db";
import { eq, inArray } from "drizzle-orm";

export type SessionLookup =
  | {
      readonly kind: "found";
      readonly sessionId: string;
      readonly spaceId: string;
    }
  /** Nothing running. The message says which of the two reasons it is. */
  | { readonly kind: "none"; readonly reason: string }
  /** More than one, so the sender has to say which. */
  | { readonly kind: "ambiguous"; readonly reason: string };

/**
 * The space a key result belongs to, through its goal.
 *
 * A key result has no space of its own: the goal owns one, and a company-level
 * goal owns none at all. That last case is why this can answer null for a key
 * result that plainly exists.
 */
async function spaceForKeyResult(
  tx: WorkspaceTx,
  input: { readonly workspaceId: string; readonly keyResultId: string },
): Promise<string | null> {
  const [row] = await tx
    .select({ spaceId: goals.spaceId })
    .from(keyResults)
    .innerJoin(goals, eq(goals.id, keyResults.goalId))
    .where(
      activeOnly(
        keyResults,
        eq(keyResults.workspaceId, input.workspaceId),
        eq(keyResults.id, input.keyResultId),
      ),
    )
    .limit(1);
  return row?.spaceId ?? null;
}

/** Every space this member belongs to. */
async function spacesOf(
  tx: WorkspaceTx,
  input: { readonly workspaceId: string; readonly memberId: string },
): Promise<readonly string[]> {
  const rows = await tx
    .select({ spaceId: spaceMembers.spaceId })
    .from(spaceMembers)
    .where(
      activeOnly(
        spaceMembers,
        eq(spaceMembers.workspaceId, input.workspaceId),
        eq(spaceMembers.memberId, input.memberId),
      ),
    );
  return rows.map((row) => row.spaceId);
}

export async function runningSessionFor(
  tx: WorkspaceTx,
  input: {
    readonly workspaceId: string;
    readonly memberId: string;
    /** What the sender named, when they named anything. */
    readonly keyResultId?: string;
  },
): Promise<SessionLookup> {
  const mine = await spacesOf(tx, input);
  if (mine.length === 0) {
    return {
      kind: "none",
      reason: "You are not in a space, so there is no session to add this to.",
    };
  }

  let spaces = mine;
  if (input.keyResultId) {
    const spaceId = await spaceForKeyResult(tx, {
      workspaceId: input.workspaceId,
      keyResultId: input.keyResultId,
    });
    if (!spaceId) {
      return {
        kind: "none",
        // The same answer for a key result that does not exist and one on a
        // company goal with no space: a member learns nothing about rows they
        // cannot see (§8.1 layer 2).
        reason: "I cannot find a space for that key result.",
      };
    }
    if (!mine.includes(spaceId)) {
      return {
        kind: "none",
        reason: "That key result is not in a space you are in.",
      };
    }
    spaces = [spaceId];
  }

  const running = await tx
    .select({ id: okrSessions.id, spaceId: okrSessions.spaceId })
    .from(okrSessions)
    .where(
      activeOnly(
        okrSessions,
        eq(okrSessions.workspaceId, input.workspaceId),
        eq(okrSessions.state, "running"),
        inArray(okrSessions.spaceId, [...spaces]),
      ),
    );

  if (running.length === 0) {
    return {
      kind: "none",
      reason: input.keyResultId
        ? "No session is running in that key result's space."
        : "No session is running in a space you are in.",
    };
  }
  if (running.length > 1) {
    return {
      kind: "ambiguous",
      reason:
        "More than one session is running in your spaces. Name a key result so I know which.",
    };
  }

  const found = running[0];
  return found?.spaceId
    ? { kind: "found", sessionId: found.id, spaceId: found.spaceId }
    : { kind: "none", reason: "That session has no space." };
}

/** Reads a blocker type somebody typed, or null. */
export function parseBlockerType(
  reply: string,
  types: readonly string[],
): string | null {
  const value = reply
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return types.includes(value) ? value : null;
}
