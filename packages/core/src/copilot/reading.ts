/**
 * The copilot's reading step (plan 0.9.0 L2b, docs/design/copilot-live-data.md
 * section 3).
 *
 * **One step for all three answer paths.** The inline stream, the whole answer
 * a chat channel's Ask waits for and the background run each prepare a
 * question, then call this once, then write the answer from what it returns.
 * It sits after retrieval, so retrieval's passages are already in hand when
 * this gives up.
 *
 * **It gives up, and the passage path stands.** With no `chooseReads` on the
 * drafter (AI off, or a provider that cannot call tools), with a model that
 * asked for nothing, or with a first round that failed, the question is
 * answered from passages exactly as before. Deterministic first: the copilot
 * with the provider off returns matching passages, and that is unchanged.
 *
 * **What the model reads is numbered once per run.** One reference table is
 * created here for each run and each member and is never shared. The numbers
 * the model saw while it read become the positions of the final answer's
 * sources, so `[3]` in the prose and the citation are the same record.
 */

import { activeOnly, aiThreads, withWorkspace } from "@openokr/db";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import {
  askingMemberId,
  COPILOT_DEFAULT_TIER,
  COPILOT_FEATURE_KEY,
} from "../actions/copilot.ts";
import type { ActionCallContext } from "../actions/define.ts";
import type {
  GroundingSource,
  ProposalNote,
  ReadingContext,
} from "../agents/drafter.ts";
import { checkFeatureAvailability } from "../ai/budgets.ts";
import { creditsPausedReason } from "../tenancy/index.ts";
import type { AnswerSource, CopilotStep, Prepared } from "./answer.ts";
import { isCitableType } from "./citations.ts";
import { type ProposalOffer, proposalNoteFor } from "./proposals.ts";
import {
  createProposer,
  PROPOSE_TOOL,
  type ProposedCard,
  proposeChangeTool,
} from "./propose-tool.ts";
import { recordCopilotRead } from "./read-record.ts";
import {
  COPILOT_READS,
  createRefTable,
  kindWord,
  readSubject,
  runRead,
  SUBJECT_READS,
  toolsFor,
} from "./read-tools.ts";
import { aiOffReason, type ReasonLike } from "./reasons.ts";

/** Most model rounds that may ask for reads (design 3.1). Fixed, not a setting (D7). */
export const COPILOT_MAX_ROUNDS = 4;

/** Most reads one round may run. Extra calls are answered, not run (design 3.1). */
export const COPILOT_MAX_READS_PER_ROUND = 6;

/** The longest subject a step may carry, so a title never floods the line. */
const SUBJECT_MAX = 120;

/**
 * Characters of one record the final answer is shown. A KPI block with its
 * recent records, or an objective with its fields, runs to about 600
 * characters before the values that matter come last. At 700 the actual and
 * target were clipped and the answer said the latest value was not provided
 * (plan 0.9.0 L7b live run, 2 of 7 right).
 */
const SOURCE_CHARS = 1600;

/** Characters of all records together. Later ones keep a label only. */
const SOURCES_BUDGET_CHARS = 24_000;

/** Tools that read one named record, so the step may say which. */
const SINGLE_RECORD_TOOLS: ReadonlySet<string> = new Set([
  "goals.read",
  "kpis.detail",
  "initiatives.read",
  "tasks.read",
]);

const SEGMENT_START = /^\s*\[(\d+)\] /;
const NOT_SHOWN_FOOTER = /^\(.* not shown\)$/;

/**
 * Each numbered record's own lines from a rendered result.
 *
 * A result is lines: a record starts at `[n] Title (kind)` and runs to the
 * next numbered line, so a goal's key results are their own records. The
 * longest text seen for a number wins, because the same record may come back
 * from a list (a title) and from a read (every field).
 */
function collectSegments(text: string, into: Map<number, string>): void {
  let ref: number | null = null;
  let lines: string[] = [];
  const flush = () => {
    if (ref === null) {
      return;
    }
    const body = lines.join("\n");
    if (body.length > (into.get(ref)?.length ?? 0)) {
      into.set(ref, body);
    }
  };
  for (const line of text.split("\n")) {
    const start = SEGMENT_START.exec(line);
    if (start?.[1]) {
      flush();
      ref = Number(start[1]);
      lines = [line.replace(SEGMENT_START, "").trimEnd()];
      continue;
    }
    if (NOT_SHOWN_FOOTER.test(line.trim())) {
      continue;
    }
    if (ref !== null) {
      lines.push(line.trimEnd());
    }
  }
  flush();
}

const clip = (value: string, max: number) =>
  value.length <= max ? value : `${value.slice(0, max - 1)}…`;

/**
 * The record a conversation is anchored to, read from the thread itself.
 *
 * **The anchor is read here, by thread id, and never taken from the caller**
 * (plan 0.9.0 CP11-Q): the panel sends the entity id once, when the thread is
 * made, and what the model sees of it is whatever this member's own read
 * returns. Only the member's own thread is looked at, and only the kinds the
 * copilot can read are used. Any failure leaves the conversation unanchored.
 */
async function threadAnchor(
  pool: Pool,
  workspaceId: string,
  memberId: string,
  threadId: string,
): Promise<{ readonly kind: string; readonly id: string } | null> {
  try {
    const rows = await withWorkspace(drizzle(pool), workspaceId, (tx) =>
      tx
        .select({
          subjectType: aiThreads.subjectType,
          subjectId: aiThreads.subjectId,
        })
        .from(aiThreads)
        .where(
          activeOnly(
            aiThreads,
            eq(aiThreads.workspaceId, workspaceId),
            eq(aiThreads.id, threadId),
            eq(aiThreads.memberId, memberId),
          ),
        )
        .limit(1),
    );
    const row = rows[0];
    return row?.subjectType && row.subjectId && row.subjectType in SUBJECT_READS
      ? { kind: row.subjectType, id: row.subjectId }
      : null;
  } catch {
    return null;
  }
}

/**
 * What the loop tells its caller as it runs: a step, or the card a
 * `propose_change` call just made, so the caller can show it at that moment
 * (plan 0.9.0 A4-D5) rather than after the loop ends.
 */
export type ReadingEvent =
  | CopilotStep
  | { readonly step: "card"; readonly proposalId: string };

/** What a finished read loop hands back to a caller. */
export interface ReadingOutcome {
  /** The question prepared again, answering from what was read. Unchanged when nothing was read. */
  readonly prepared: Prepared;
  readonly reads: number;
  readonly costUsd: number;
  readonly tokensIn: number;
  readonly tokensOut: number;
  /**
   * Set when the reading used up what the answer needed (credits, a budget or
   * a switch changed during the rounds). The caller halts with this reason
   * and does not call the answer.
   */
  readonly blocked: ReasonLike | null;
  /**
   * What the `propose_change` tool made, or null when the tool was not part of
   * this run (plan 0.9.0 A4-D7). Null tells the caller to ask for the
   * proposal the 0.8.1 way, with one structured call before the answer. Not
   * null means the model was offered the tool in round one, so a note with
   * `made: false` is the final word: nothing was asked for.
   */
  readonly proposal: {
    readonly note: ProposalNote;
    readonly proposalId: string | null;
  } | null;
}

export interface ReadingHooks {
  /**
   * Asked before every model call besides the budget and credits checks.
   * A background run uses it to stop when its member pressed Stop.
   */
  readonly proceed?: () => Promise<boolean>;
  /**
   * What the member may be offered (`offersToPropose`). Given, the loop offers
   * `propose_change` in round one, unless the conversation is anchored to a
   * page (see `proposer` below). Left out, the loop is as it was.
   */
  readonly proposal?: { readonly offers: readonly ProposalOffer[] | null };
}

/**
 * Why the member's workspace no longer allows another model call, or null
 * when it does. The same two checks the first call went through, asked again
 * before every round and once more before the answer.
 */
async function modelBlockedReason(
  pool: Pool,
  workspaceId: string,
  memberId: string,
): Promise<ReasonLike | null> {
  const availability = await checkFeatureAvailability(pool, {
    workspaceId,
    featureKey: COPILOT_FEATURE_KEY,
    defaultTier: COPILOT_DEFAULT_TIER,
    memberId,
  });
  if (!availability.available) {
    return availability.reason ?? { code: "unavailable" };
  }
  return (await creditsPausedReason(pool, workspaceId))
    ? aiOffReason("credits_used")
    : null;
}

/**
 * Runs the read loop and yields a step for each read as it finishes.
 *
 * Returns null when the passage path should stand. A generator because the
 * inline stream must yield each step to its reader while the drafter is still
 * waiting on the model; `drainReading` is for the callers with nobody to tell
 * in between.
 */
export async function* readLiveData(
  context: ActionCallContext,
  prepared: Prepared,
  hooks: ReadingHooks = {},
): AsyncGenerator<ReadingEvent, ReadingOutcome | null> {
  const drafter = context.drafter;
  if (!prepared.ask) {
    return null;
  }
  const ask = prepared.ask;
  const memberId = await askingMemberId(context);
  // The anchor decides whether a provider with no tools still has something
  // to read, so it is looked up before the drafter is.
  const anchor = await threadAnchor(
    context.pool,
    context.workspaceId,
    memberId,
    prepared.threadId,
  );
  if (!drafter?.chooseReads && !anchor) {
    return null;
  }
  // One table per run and per member, never shared (design 3.3).
  const refs = createRefTable();
  const segments = new Map<number, string>();
  const queue: ReadingEvent[] = [];
  let subject: ReadingContext["subject"];
  let wake: (() => void) | null = null;
  const poke = () => {
    const was = wake;
    wake = null;
    was?.();
  };

  // **An anchored conversation keeps the 0.8.1 proposal-first path** (A4,
  // decided by Agung on 13 November 2026). Its round one holds the anchored
  // record's read text as the `subject` block, and A4-D4 says nothing a read
  // returned may be in the context that starts a proposal. Not offering the
  // tool there is what keeps that literally true.
  const proposer =
    anchor === null && drafter?.chooseReads && hooks.proposal?.offers
      ? createProposer(context, {
          threadId: prepared.threadId,
          offers: hooks.proposal.offers,
        })
      : null;
  // One object rather than three `let`s: they are changed inside callbacks,
  // and TypeScript would narrow a `let` to its first value after them.
  const run = {
    round: 0,
    card: null as ProposedCard | null,
    // Calls to `propose_change` the drafter counted among its reads.
    proposalCalls: 0,
  };

  const read = async (name: string, args: unknown): Promise<string> => {
    if (name === PROPOSE_TOOL && proposer) {
      run.proposalCalls += 1;
      if (run.round === 1 && run.card === null) {
        // Shown while the call is being built, and only then (A4-D5).
        queue.push({ step: "proposing" });
        poke();
      }
      const { result, card: made } = await proposer.handle(args, run.round);
      // Recorded like a read, with its outcome (A4-D8).
      await recordCopilotRead(context.pool, {
        workspaceId: context.workspaceId,
        memberId,
        result,
      });
      if (made) {
        run.card = made;
        queue.push({ step: "card", proposalId: made.id });
        poke();
      }
      return result.text;
    }
    const result = await runRead(context, refs, name, args);
    // Every read, including a refused or unknown one, is written down as the
    // member's (design 3.6). Never in the way of the answer.
    await recordCopilotRead(context.pool, {
      workspaceId: context.workspaceId,
      memberId,
      result,
    });
    collectSegments(result.text, segments);
    if ((COPILOT_READS as readonly string[]).includes(name)) {
      const label = SINGLE_RECORD_TOOLS.has(name)
        ? result.entities[0]?.label
        : undefined;
      queue.push({
        step: "reading",
        tool: name,
        ...(label ? { subject: clip(label, SUBJECT_MAX) } : {}),
      });
      poke();
    }
    return result.text;
  };

  const beforeRound = async (): Promise<boolean> => {
    // Asked once before every model call, so this is the round about to run.
    // It is how a `propose_change` call in round two is told apart (A4-D4).
    run.round += 1;
    if (hooks.proceed && !(await hooks.proceed())) {
      return false;
    }
    return (
      (await modelBlockedReason(
        context.pool,
        context.workspaceId,
        memberId,
      )) === null
    );
  };

  // The anchored record, read as the member before the first round, so it is
  // [1] (plan 0.9.0 CP11). A refusal or an empty read adds nothing and says
  // nothing: the model and the panel learn no more than "Nothing found."
  // would tell them. The read is recorded either way, like any loop read.
  let subjectReads = 0;
  if (anchor) {
    const result = await readSubject(context, refs, anchor.kind, anchor.id);
    await recordCopilotRead(context.pool, {
      workspaceId: context.workspaceId,
      memberId,
      result,
    });
    const opened = result.entities.find(
      (entity) => entity.entityId === anchor.id,
    );
    const ref = refs.refOf(anchor.id);
    if (result.outcome === "ok" && opened && ref !== undefined) {
      subjectReads = 1;
      collectSegments(result.text, segments);
      subject = {
        ref,
        label: opened.label,
        kind: kindWord(opened.entityType),
        text: result.text,
      };
      queue.push({
        step: "reading",
        tool: result.tool,
        subject: clip(opened.label, SUBJECT_MAX),
      });
    } else {
      refs.truncate(0);
    }
  }

  let settled = false;
  const running = Promise.resolve()
    .then(() =>
      drafter?.chooseReads?.(
        {
          question: ask.question,
          history: ask.history,
          asker: ask.asker,
          ...(subject ? { subject } : {}),
        },
        proposer && hooks.proposal?.offers
          ? [...toolsFor(), proposeChangeTool(hooks.proposal.offers)]
          : toolsFor(),
        read,
        beforeRound,
      ),
    )
    .then(
      (value) => ({ ok: true as const, value }),
      () => ({ ok: false as const }),
    )
    .finally(() => {
      settled = true;
      poke();
    });

  while (true) {
    for (const step of queue.splice(0)) {
      yield step;
    }
    if (settled) {
      break;
    }
    await new Promise<void>((resolve) => {
      wake = resolve;
      // A step or the end may have arrived since the check above.
      if (queue.length > 0 || settled) {
        poke();
      }
    });
  }
  const chosen = await running;
  // A provider with no tools, or a loop that gave up, still has the anchored
  // record: it joins the grounding sources, so the answer can use it.
  // A card that was made stands even when the loop failed after it, so the
  // caller never asks for a second one.
  if (
    (!chosen.ok || !chosen.value) &&
    subjectReads === 0 &&
    run.card === null
  ) {
    return null;
  }
  const loop = chosen.ok ? chosen.value : null;
  // A `propose_change` call is one of the loop's calls (A4-D8) but opens no
  // record, so it is not a read: the answer's sources and the "made n reads"
  // line count reads only.
  const reads =
    Math.max(0, (loop?.reads ?? 0) - run.proposalCalls) + subjectReads;
  const limited = loop?.limited ?? false;
  const costUsd = loop?.costUsd ?? 0;
  const tokensIn = loop?.tokensIn ?? 0;
  const tokensOut = loop?.tokensOut ?? 0;
  // The rounds are model calls and may have spent the last of the credits, so
  // the answer's own call is checked like any other before it is made.
  const blocked = await modelBlockedReason(
    context.pool,
    context.workspaceId,
    memberId,
  );
  // The tool was offered when the proposer exists and round one ran. A loop
  // that returned null (a provider with no tools, a first round that failed)
  // never offered it, and the caller asks the 0.8.1 way.
  const offered = proposer !== null && (run.card !== null || Boolean(loop));
  const proposal = offered
    ? {
        note: run.card
          ? proposalNoteFor(run.card.action, run.card.preview)
          : ({ made: false } as const),
        proposalId: run.card?.id ?? null,
      }
    : null;
  const spent = { reads, costUsd, tokensIn, tokensOut, blocked, proposal };
  if (reads === 0) {
    return { prepared, ...spent };
  }

  let budget = SOURCES_BUDGET_CHARS;
  const entries = refs.entries();
  const sources: GroundingSource[] = entries.map((entry) => {
    const own = segments.get(entry.ref);
    const content =
      own !== undefined && budget > 0 ? clip(own, SOURCE_CHARS) : entry.label;
    budget -= content.length;
    return { label: entry.label, content };
  });
  const shown: AnswerSource[] = entries
    .filter((entry) => isCitableType(entry.entityType))
    .map((entry) => ({
      entityType: entry.entityType,
      entityId: entry.entityId,
      label: entry.label,
      excerpt: sources[entry.ref - 1]?.content ?? "",
    }));
  return {
    prepared: {
      ...prepared,
      sources: shown,
      // Positional, as `sources` is: a number the model saw is an index here.
      cite: entries.map((entry) => ({
        entityType: entry.entityType,
        entityId: entry.entityId,
      })),
      ask: { ...ask, sources, reading: { reads, limited } },
    },
    ...spent,
  };
}

/** Runs `readLiveData` to its end, telling `onStep` about each read. */
export async function drainReading(
  reading: AsyncGenerator<ReadingEvent, ReadingOutcome | null>,
  onStep?: (step: ReadingEvent) => Promise<void> | void,
): Promise<ReadingOutcome | null> {
  let next = await reading.next();
  while (!next.done) {
    await onStep?.(next.value);
    next = await reading.next();
  }
  return next.value;
}

/** Adds what the read rounds cost to what the final answer reported. */
export function withReadingCost(
  answer: {
    readonly costUsd?: number;
    readonly tokensIn?: number;
    readonly tokensOut?: number;
  },
  outcome: ReadingOutcome | null,
): {
  costUsd: number | undefined;
  tokensIn: number | undefined;
  tokensOut: number | undefined;
} {
  const add = (own: number | undefined, extra: number) =>
    own === undefined ? (extra > 0 ? extra : undefined) : own + extra;
  return {
    costUsd: add(answer.costUsd, outcome?.costUsd ?? 0),
    tokensIn: add(answer.tokensIn, outcome?.tokensIn ?? 0),
    tokensOut: add(answer.tokensOut, outcome?.tokensOut ?? 0),
  };
}
