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

import type { Pool } from "pg";
import {
  askingMemberId,
  COPILOT_DEFAULT_TIER,
  COPILOT_FEATURE_KEY,
} from "../actions/copilot.ts";
import type { ActionCallContext } from "../actions/define.ts";
import type { GroundingSource } from "../agents/drafter.ts";
import { checkFeatureAvailability } from "../ai/budgets.ts";
import { creditsPausedReason } from "../tenancy/index.ts";
import type { AnswerSource, CopilotStep, Prepared } from "./answer.ts";
import { isCitableType } from "./citations.ts";
import { recordCopilotRead } from "./read-record.ts";
import {
  COPILOT_READS,
  createRefTable,
  runRead,
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
}

export interface ReadingHooks {
  /**
   * Asked before every model call besides the budget and credits checks.
   * A background run uses it to stop when its member pressed Stop.
   */
  readonly proceed?: () => Promise<boolean>;
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
): AsyncGenerator<CopilotStep, ReadingOutcome | null> {
  const drafter = context.drafter;
  if (!prepared.ask || !drafter?.chooseReads) {
    return null;
  }
  const ask = prepared.ask;
  const memberId = await askingMemberId(context);
  // One table per run and per member, never shared (design 3.3).
  const refs = createRefTable();
  const segments = new Map<number, string>();
  const queue: CopilotStep[] = [];
  let wake: (() => void) | null = null;
  const poke = () => {
    const was = wake;
    wake = null;
    was?.();
  };

  const read = async (name: string, args: unknown): Promise<string> => {
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

  let settled = false;
  const running = Promise.resolve()
    .then(() =>
      drafter.chooseReads?.(
        { question: ask.question, history: ask.history, asker: ask.asker },
        toolsFor(),
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
  if (!chosen.ok || !chosen.value) {
    return null;
  }
  const { reads, limited, costUsd, tokensIn, tokensOut } = chosen.value;
  // The rounds are model calls and may have spent the last of the credits, so
  // the answer's own call is checked like any other before it is made.
  const blocked = await modelBlockedReason(
    context.pool,
    context.workspaceId,
    memberId,
  );
  const spent = { reads, costUsd, tokensIn, tokensOut, blocked };
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
  reading: AsyncGenerator<CopilotStep, ReadingOutcome | null>,
  onStep?: (step: CopilotStep) => Promise<void> | void,
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
