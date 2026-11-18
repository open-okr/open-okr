/**
 * Reading the thumbs members gave copilot answers (plan 0.9.0 FB1,
 * docs/design/copilot-feedback.md FB-D4, FB-D11).
 *
 * A rating is about the copilot, so AI administrators read it. The
 * conversation stays the member's: **the question and the answer are in the
 * response only for a rating whose member shared them**. For any other rating
 * the two keys are absent from the row, not blanked, so a client that only
 * hides them on screen has nothing to hide.
 *
 * What the copilot read for the answer is rebuilt from `ai_tool_calls` by
 * member and time, the way `copilot.thread` rebuilds it, so no count is copied
 * into the rating.
 */
import {
  activeOnly,
  aiAnswerRatings,
  aiMessages,
  withContext,
  workspaceMembers,
} from "@openokr/db";
import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import type { OperationTx } from "../operations/operation.ts";
import { answerContextsInTx } from "./copilot.ts";
import { defineReadAction } from "./define.ts";

/** Ratings one page holds. */
const RATINGS_PAGE_SIZE = 25;
const RATINGS_PAGE_CEILING = 100;

const ratingRow = z.object({
  id: z.uuid(),
  /** When the member rated, as an instant. The cursor's first half. */
  at: z.string(),
  rating: z.enum(["up", "down"]),
  note: z.string().nullable(),
  model: z.string().nullable(),
  /** The rater's name in this workspace. */
  member: z.string(),
  /** How many live reads the copilot made for the answer. */
  readCount: z.number().int(),
  shared: z.boolean(),
  /** Present only when `shared` is true. */
  question: z.string().nullable().optional(),
  /** Present only when `shared` is true. */
  answer: z.string().optional(),
});

/** One rating, with the member id the public row leaves out. */
export interface AnswerRatingPageRow {
  readonly id: string;
  readonly at: string;
  readonly rating: "up" | "down";
  readonly note: string | null;
  readonly model: string | null;
  readonly member: string;
  readonly memberId: string;
  readonly readCount: number;
  readonly shared: boolean;
  /** Present only when `shared` is true. */
  readonly question?: string | null;
  readonly answer?: string;
}

/**
 * One page of ratings, newest first (FB-D4, FB-D11).
 *
 * Shared by the action and by `pnpm copilot:feedback`, so the command reads
 * exactly what an administrator reads and the rule that withholds the text of
 * an unshared rating lives in one place: the text is added to a row only when
 * `shared` is true.
 */
export async function answerRatingsPage(
  tx: OperationTx,
  workspaceId: string,
  input: {
    readonly rating?: "up" | "down";
    readonly cursor?: { readonly at: string; readonly id: string };
    readonly limit?: number;
  },
): Promise<{ readonly rows: AnswerRatingPageRow[]; readonly more: boolean }> {
  const limit = input.limit ?? RATINGS_PAGE_SIZE;
  // Compared at the precision the cursor carries. A millisecond string
  // against a microsecond column would skip rows that share the millisecond.
  const at = sql<Date>`date_trunc('milliseconds', ${aiAnswerRatings.createdAt})`;
  const cursor = input.cursor
    ? or(
        lt(at, new Date(input.cursor.at)),
        and(
          eq(at, new Date(input.cursor.at)),
          lt(aiAnswerRatings.id, input.cursor.id),
        ),
      )
    : undefined;

  const found = await tx
    .select({
      id: aiAnswerRatings.id,
      createdAt: aiAnswerRatings.createdAt,
      rating: aiAnswerRatings.rating,
      note: aiAnswerRatings.note,
      model: aiAnswerRatings.model,
      shared: aiAnswerRatings.shared,
      memberId: aiAnswerRatings.memberId,
      member: workspaceMembers.name,
      messageId: aiAnswerRatings.messageId,
      threadId: aiMessages.threadId,
    })
    .from(aiAnswerRatings)
    .innerJoin(
      workspaceMembers,
      eq(workspaceMembers.id, aiAnswerRatings.memberId),
    )
    .innerJoin(aiMessages, eq(aiMessages.id, aiAnswerRatings.messageId))
    .where(
      activeOnly(
        aiAnswerRatings,
        eq(aiAnswerRatings.workspaceId, workspaceId),
        isNull(aiMessages.deletedAt),
        input.rating ? eq(aiAnswerRatings.rating, input.rating) : undefined,
        cursor,
      ),
    )
    .orderBy(desc(at), desc(aiAnswerRatings.id))
    .limit(limit + 1);

  const page = found.slice(0, limit);

  // One rebuild per conversation, however many of its answers are on the page.
  const contexts = new Map<
    string,
    Awaited<ReturnType<typeof answerContextsInTx>>
  >();
  for (const row of page) {
    const key = `${row.memberId}:${row.threadId}`;
    if (!contexts.has(key)) {
      contexts.set(
        key,
        await answerContextsInTx(tx, workspaceId, row.memberId, row.threadId),
      );
    }
  }

  return {
    rows: page.map((row) => {
      const detail = contexts
        .get(`${row.memberId}:${row.threadId}`)
        ?.get(row.messageId);
      return {
        id: row.id,
        at: row.createdAt.toISOString(),
        rating: row.rating,
        note: row.note,
        model: row.model,
        member: row.member,
        memberId: row.memberId,
        readCount: detail?.readCount ?? 0,
        shared: row.shared,
        // Added to the object only for a shared rating, so an unshared one
        // has no such key at all.
        ...(row.shared && detail
          ? { question: detail.question, answer: detail.answer }
          : {}),
      };
    }),
    more: found.length > limit,
  };
}

export const listAnswerRatings = defineReadAction({
  name: "ai.answerRatings",
  agentSurface: false,
  summary:
    "The thumbs members gave copilot answers, newest first, with the note, the model and what was read. The question and the answer are included only when the member shared them.",
  input: z.object({
    /** Only poor answers, or only good ones. Absent means both. */
    rating: z.enum(["up", "down"]).optional(),
    /** The last row of the page before. Absent means the newest page. */
    cursor: z
      .object({ at: z.iso.datetime({ offset: true }), id: z.uuid() })
      .optional(),
    limit: z.number().int().min(1).max(RATINGS_PAGE_CEILING).optional(),
  }),
  output: z.object({
    rows: z.array(ratingRow),
    /** True when older ratings match the same filter. */
    more: z.boolean(),
  }),
  // `manage_ai` is `full` today, as for the other AI administration reads.
  access: ACCESS_LEVELS.full,
  page: { cursorFrom: ["at", "id"], itemsAt: "rows" },
  async handler(context, input) {
    return withContext(
      drizzle(context.pool),
      { workspaceId: context.workspaceId, userId: context.actor.userId ?? "" },
      async (rawTx) => {
        const page = await answerRatingsPage(
          rawTx as unknown as OperationTx,
          context.workspaceId,
          input,
        );
        return {
          // The member's id is the command's, not the screen's.
          rows: page.rows.map(({ memberId: _memberId, ...row }) => row),
          more: page.more,
        };
      },
    );
  },
});
