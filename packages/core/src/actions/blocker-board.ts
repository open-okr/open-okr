/**
 * The blocker board and its summary (METHOD.md §7.3, AI-NATIVE-PLAN.md §2.2,
 * P4-T15b-b).
 *
 * **`blockers.board` did not exist, and the assist could not without it.** The
 * product could read the blockers raised in one session and nothing else: no way
 * to ask what a space is stuck on. So the board comes first, ranked by
 * `packages/method`'s own function, and the assist summarises what the board
 * already ordered.
 *
 * **The ranking is the product's and the assist cannot change it.** The summary
 * is asked for prose about a list it is given in order, and the response carries
 * the board itself, unchanged, beside the words. A model reordering a queue by
 * how interesting each item reads is the failure this separation prevents, and
 * the summary is refused if it names a blocker that is not on the board.
 */
import {
  activeOnly,
  blockers,
  goals,
  keyResults,
  okrSessions,
  withContext,
  workspaceMembers,
} from "@openokr/db";
import { type RankedBlocker, rankBlockers } from "@openokr/method";
import { eq, isNull, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { RHYTHM_ASSIST_KEYS } from "../ai/assist-keys.ts";
import { checkFeatureAvailability } from "../ai/budgets.ts";
import { resolveRhythm } from "../cycles/rhythm.ts";
import { readRhythmRow } from "../cycles/service.ts";
import { OperationError, type OperationTx } from "../operations/operation.ts";
import { type ActionCallContext, defineReadAction } from "./define.ts";

/** How many blockers a board returns, and a summary is shown. */
const BOARD_LIMIT = 30;

const rankedOutput = z.object({
  id: z.uuid(),
  type: z.string(),
  nextAction: z.string(),
  ownerName: z.string().nullable(),
  ageHours: z.number().int(),
  blockedTitle: z.string().nullable(),
  blockedHealth: z.string().nullable(),
  /** §11's ladder: none, owner, coordinator or sponsor. */
  escalation: z.string(),
  /** True once past §7.3's own clock. */
  pastTheClock: z.boolean(),
});

/** The acting member, or not-found. */
async function actingMember(
  tx: OperationTx,
  workspaceId: string,
  userId: string | undefined,
): Promise<string> {
  if (!userId) {
    throw new OperationError("not_found", "No such workspace.");
  }
  const [member] = await tx
    .select({ id: workspaceMembers.id })
    .from(workspaceMembers)
    .where(
      activeOnly(
        workspaceMembers,
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, userId),
        eq(workspaceMembers.status, "active"),
      ),
    )
    .limit(1);
  if (!member) {
    throw new OperationError("not_found", "No such workspace.");
  }
  return member.id;
}

/** Reads and ranks the open blockers for a space. */
async function boardFor(
  context: ActionCallContext,
  spaceId: string,
): Promise<readonly RankedBlocker[]> {
  const userId = context.actor.userId;
  return withContext(
    drizzle(context.pool),
    { workspaceId: context.workspaceId, userId: userId ?? "" },
    async (rawTx) => {
      const tx = rawTx as unknown as OperationTx;
      await actingMember(tx, context.workspaceId, userId);

      const { thresholds } = resolveRhythm(
        await readRhythmRow(tx, context.workspaceId),
      );

      // A blocker belongs to a space through the goal or key result it blocks,
      // or through the session it was raised in. Both, because a blocker raised
      // in a weekly session may name nothing yet and still be the space's.
      const rows = await tx
        .select({
          id: blockers.id,
          type: blockers.type,
          nextAction: blockers.nextAction,
          openedAt: blockers.openedAt,
          ownerName: workspaceMembers.name,
          goalTitle: goals.title,
          goalHealth: goals.health,
          keyResultTitle: keyResults.title,
        })
        .from(blockers)
        .leftJoin(workspaceMembers, eq(workspaceMembers.id, blockers.ownerId))
        .leftJoin(keyResults, eq(keyResults.id, blockers.keyResultId))
        .leftJoin(
          goals,
          or(
            eq(goals.id, blockers.goalId),
            eq(goals.id, keyResults.goalId),
          ) as never,
        )
        .leftJoin(okrSessions, eq(okrSessions.id, blockers.sessionId))
        .where(
          activeOnly(
            blockers,
            eq(blockers.workspaceId, context.workspaceId),
            isNull(blockers.resolvedAt),
            or(
              eq(goals.spaceId, spaceId),
              eq(okrSessions.spaceId, spaceId),
            ) as never,
          ),
        );

      const now = Date.now();
      return rankBlockers(
        rows.map((row) => ({
          id: row.id,
          type: row.type,
          nextAction: row.nextAction,
          ownerName: row.ownerName ?? null,
          ageHours: Math.max(
            0,
            Math.floor((now - row.openedAt.getTime()) / 3_600_000),
          ),
          blockedHealth: row.goalHealth ?? null,
          blockedTitle: row.keyResultTitle ?? row.goalTitle ?? null,
        })),
        thresholds["cadence.blockerLadderHours"],
        thresholds["cadence.blockerClockHours"],
      ).slice(0, BOARD_LIMIT);
    },
  );
}

/**
 * Every open blocker in a space, in the order §11's ladder puts them.
 *
 * Deterministic, and useful on its own: this is the "open-blocker board with
 * ages" REQUIREMENTS §7 asks for, and it needs no provider.
 */
export const readBlockerBoard = defineReadAction({
  name: "blockers.board",
  summary:
    "Every open blocker in a space, ranked by escalation, then by what it blocks, then by age.",
  input: z.object({ spaceId: z.uuid() }),
  output: z.object({ blockers: z.array(rankedOutput) }),
  access: ACCESS_LEVELS.view,
  async handler(context, input) {
    return { blockers: [...(await boardFor(context, input.spaceId))] };
  },
});

/**
 * The board, summarised.
 *
 * The board travels with the summary, in the product's order, so a reader always
 * has the list the words are about. A summary naming a blocker that is not on the
 * board is dropped: it either read a stale board or made one up, and neither is
 * something to show somebody about to spend their day on it.
 */
export const summariseBlockers = defineReadAction({
  name: "blockers.summarise",
  summary:
    "Summarises a space's open blockers, over the product's own ranking, refusing a summary that names one not on the board.",
  input: z.object({ spaceId: z.uuid() }),
  output: z
    .object({
      summary: z.string(),
      /** The board itself, in the product's order, always. */
      blockers: z.array(rankedOutput),
    })
    .nullable(),
  access: ACCESS_LEVELS.view,
  async handler(context, input) {
    const drafter = context.drafter;
    if (!drafter?.summariseBlockers) {
      return null;
    }
    const availability = await checkFeatureAvailability(context.pool, {
      workspaceId: context.workspaceId,
      featureKey: RHYTHM_ASSIST_KEYS.summariseBlockers,
      defaultTier: "balanced",
    });
    if (!availability.available) {
      return null;
    }

    const board = await boardFor(context, input.spaceId);
    if (board.length === 0) {
      // Nothing to summarise, and "no blockers" is a sentence the board already
      // says better than prose would.
      return null;
    }

    let summary: string | null = null;
    try {
      summary = await drafter.summariseBlockers({
        blockers: board.map((blocker) => ({
          type: blocker.type,
          nextAction: blocker.nextAction,
          ownerName: blocker.ownerName,
          ageHours: blocker.ageHours,
          blocks: blocker.blockedTitle,
          escalation: blocker.escalation,
        })),
      });
    } catch {
      return null;
    }
    if (!summary || summary.trim() === "") {
      return null;
    }

    // **Every next action named in the prose has to be on the board.** A summary
    // that mentions something not in front of it is describing a different list,
    // and the whole point of this action is that the list is the product's.
    const known = board.map((blocker) => blocker.nextAction.toLowerCase());
    const invented = mentionedButUnknown(summary, known);
    if (invented) {
      return null;
    }

    return { summary: summary.trim(), blockers: [...board] };
  },
});

/**
 * Whether the prose quotes something that is not on the board.
 *
 * Only quoted spans are checked, because prose about a list will naturally use
 * words from it and a check on loose words would refuse every real summary. A
 * model that puts a next action in quotation marks is making a specific claim
 * about the board, and that is the claim worth verifying.
 */
export function mentionedButUnknown(
  prose: string,
  knownLowercase: readonly string[],
): boolean {
  const quoted = prose.match(/"([^"]{4,120})"/g) ?? [];
  return quoted.some((raw) => {
    const inner = raw.slice(1, -1).trim().toLowerCase();
    return !knownLowercase.some(
      (known) => known.includes(inner) || inner.includes(known),
    );
  });
}
