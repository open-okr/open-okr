/**
 * The two §2.4 assists that were promised and never built
 * (AI-NATIVE-PLAN.md §2.4, REQUIREMENTS Pillar D, completeness review M-09).
 *
 * "Summarise a thread" and "decompose a key result into initiatives and
 * tasks" were in the requirement's list of assists everywhere, in the
 * capability catalogue, and in no task. P4-T15 handed decomposition to Phase 5
 * and Phase 5 never took it.
 *
 * **Both are reads, and neither writes a thing.** The summary is words beside
 * a discussion the reader can still read in full. The decomposition is a list
 * of drafts a person edits, trims and then creates through the ordinary
 * `initiatives.create` and `tasks.create`, as themselves, with the space's own
 * access deciding whether they may.
 *
 * **Every model answer is checked before it is offered.** The summary may not
 * quote words the thread does not hold. The decomposition is bounded, stripped
 * of blanks, and stripped of anything the key result already has an
 * initiative for. A drafter that answers null, throws, or produces nothing that
 * survives those checks leaves the reader exactly where they were.
 */
import { COMMENT_SUBJECT_TYPES } from "@openokr/db";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import {
  ASSIST_FEATURE_KEYS,
  THREAD_SUMMARY_MINIMUM,
} from "../ai/assist-keys.ts";
import { checkFeatureAvailability } from "../ai/budgets.ts";
import { OperationError } from "../operations/operation.ts";
import { excerptRichText } from "../rich-text/excerpt.ts";
import { listCommentsAction } from "./comments.ts";
import { type ActionCallContext, defineReadAction } from "./define.ts";
import { readGoal } from "./goals.ts";
import { listInitiatives } from "./initiatives.ts";

/** The most recent comments a summary is written from. */
const THREAD_LIMIT = 60;

/** How much of one comment a model is shown. */
const COMMENT_EXCERPT = 800;

/** How many open questions a summary may list. */
const QUESTION_LIMIT = 5;

/**
 * How much a decomposition may draft.
 *
 * Bounded because METHOD.md §5.5's capacity check exists for a reason: a key
 * result with nine initiatives behind it is the "exceeds" verdict waiting to
 * happen, and a draft that proposed nine would be the assist creating the
 * problem the method warns about.
 */
const INITIATIVE_LIMIT = 4;
const TASK_LIMIT = 6;

/** The tier decomposition asks for, as AI-NATIVE-PLAN §3.4 names it. */
const DECOMPOSITION_TIER = "deep" as const;

const available = async (
  context: ActionCallContext,
  featureKey: string,
  defaultTier: "balanced" | "deep",
): Promise<boolean> =>
  (
    await checkFeatureAvailability(context.pool, {
      workspaceId: context.workspaceId,
      featureKey,
      defaultTier,
    })
  ).available;

/**
 * Whether the prose quotes something no comment says.
 *
 * Only quoted spans are checked, for the reason `mentionedButUnknown` gives on
 * the blocker board: a summary will use the thread's words loosely, and a check
 * on loose words would refuse every real one. A model that puts words in
 * quotation marks is saying somebody wrote them, and that claim is checkable.
 */
function quotesUnknownWords(
  prose: string,
  comments: readonly string[],
): boolean {
  const said = comments.map((text) => text.toLowerCase());
  const quoted = prose.match(/["“]([^"”]{4,200})["”]/g) ?? [];
  return quoted.some((raw) => {
    const inner = raw.slice(1, -1).trim().toLowerCase();
    return !said.some((text) => text.includes(inner));
  });
}

/** A subject type as words, for the model's framing. Never an identifier. */
const subjectWords = (subjectType: string): string =>
  subjectType.replace(/_/g, " ");

/**
 * Summarises a discussion, and names what it left open.
 *
 * Through `comments.list` rather than beside it, so a thread on something this
 * member cannot read answers not-found before a model is told a word of it.
 */
export const summariseThread = defineReadAction({
  name: "comments.summarise",
  summary:
    "Summarises the discussion on a subject and lists what it left open, refusing a summary that quotes words nobody wrote.",
  input: z.object({
    subjectType: z.enum(COMMENT_SUBJECT_TYPES),
    subjectId: z.uuid(),
  }),
  output: z
    .object({
      summary: z.string(),
      openQuestions: z.array(z.string()),
      /** How many comments it was written from. */
      commentCount: z.number().int(),
    })
    .nullable(),
  access: ACCESS_LEVELS.view,
  async handler(context, input) {
    const drafter = context.drafter;
    if (!drafter?.summariseThread) {
      return null;
    }
    if (
      !(await available(
        context,
        ASSIST_FEATURE_KEYS.summariseThread,
        "balanced",
      ))
    ) {
      return null;
    }

    const thread = await listCommentsAction.handler(context, input);
    const recent = thread
      .map((comment) => ({
        author: comment.authorName,
        text: excerptRichText(comment.body as never, COMMENT_EXCERPT).trim(),
      }))
      .filter((comment) => comment.text !== "")
      .slice(-THREAD_LIMIT);
    if (recent.length < THREAD_SUMMARY_MINIMUM) {
      return null;
    }

    let summarised: Awaited<
      ReturnType<NonNullable<typeof drafter.summariseThread>>
    >;
    try {
      summarised = await drafter.summariseThread({
        subject: subjectWords(input.subjectType),
        comments: recent,
      });
    } catch {
      return null;
    }
    if (!summarised || summarised.summary.trim() === "") {
      return null;
    }

    const openQuestions = summarised.openQuestions
      .map((question) => question.trim())
      .filter((question) => question !== "")
      .slice(0, QUESTION_LIMIT);
    const words = recent.map((comment) => comment.text);
    if (
      quotesUnknownWords(
        [summarised.summary, ...openQuestions].join(" "),
        words,
      )
    ) {
      // Words attributed to the thread that nobody in it wrote. The thread is
      // right there to read; a summary that misquotes it is worse than none.
      return null;
    }

    return {
      summary: summarised.summary.trim(),
      openQuestions,
      commentCount: recent.length,
    };
  },
});

const draftedOutput = z.object({
  title: z.string(),
  description: z.string(),
  tasks: z.array(z.string()),
});

/**
 * Drafts the initiatives and tasks that would move one key result.
 *
 * `edit`, not `view`: the drafts only exist to be created, and a member who may
 * not create work has nothing to do with them. The goal is read through the
 * getter first, so a key result on a goal this member cannot see answers
 * not-found before a model hears of it.
 */
export const decomposeKeyResult = defineReadAction({
  name: "goals.decomposeKeyResult",
  summary:
    "Drafts initiatives and their first tasks for one key result, as plain drafts a person edits before creating any of them.",
  input: z.object({ goalId: z.uuid(), keyResultId: z.uuid() }),
  output: z.object({ initiatives: z.array(draftedOutput) }).nullable(),
  access: ACCESS_LEVELS.edit,
  async handler(context, input) {
    const drafter = context.drafter;
    if (!drafter?.decomposeKeyResult) {
      return null;
    }
    if (
      !(await available(
        context,
        ASSIST_FEATURE_KEYS.decomposeKeyResult,
        DECOMPOSITION_TIER,
      ))
    ) {
      return null;
    }

    const goal = await readGoal.handler(context, { id: input.goalId });
    const keyResult = goal.keyResults.find(
      (candidate) => candidate.id === input.keyResultId,
    );
    if (!keyResult) {
      throw new OperationError("not_found", "No such key result.");
    }

    const existing = (
      await listInitiatives.handler(context, { keyResultId: keyResult.id })
    ).map((initiative) => initiative.title);

    let drafted: Awaited<
      ReturnType<NonNullable<typeof drafter.decomposeKeyResult>>
    >;
    try {
      drafted = await drafter.decomposeKeyResult({
        goalTitle: goal.title,
        keyResultTitle: keyResult.title,
        unit: keyResult.unit,
        direction: keyResult.direction,
        baseline: keyResult.baselineValue,
        target: keyResult.targetValue,
        current: keyResult.currentValue,
        existingInitiatives: existing,
      });
    } catch {
      return null;
    }
    if (!drafted || drafted.length === 0) {
      return null;
    }

    const seen = new Set(existing.map((title) => title.trim().toLowerCase()));
    const initiatives: z.infer<typeof draftedOutput>[] = [];
    for (const candidate of drafted) {
      const title = candidate.title.trim();
      const key = title.toLowerCase();
      if (title === "" || seen.has(key)) {
        // Blank, or already running behind this key result, or drafted twice.
        continue;
      }
      seen.add(key);
      const tasks = [
        ...new Set(
          candidate.tasks
            .map((task) => task.trim())
            .filter((task) => task !== ""),
        ),
      ].slice(0, TASK_LIMIT);
      initiatives.push({
        title,
        description: candidate.description.trim(),
        tasks,
      });
      if (initiatives.length === INITIATIVE_LIMIT) {
        break;
      }
    }

    return initiatives.length === 0 ? null : { initiatives };
  },
});
