/**
 * Usage metering (AI-NATIVE-PLAN.md §4, P2-T16).
 *
 * `recordUsageEvent` is a plain export, not a registered action, and the
 * reason is trust, not access level: the tokens, cost and latency it writes
 * are the authoritative facts of a call that already happened, known only
 * to whichever host-side code actually made that call. Exposing this
 * through the action registry would let any caller self-report a number —
 * understating their own usage, or inflating someone else's toward a shared
 * quota. Only server-side code already trusted to have made the real call
 * may reach this, the same trust boundary `resolveAICredential` draws.
 *
 * It still runs through `runOperation`, because every write does
 * (CLAUDE.md's own hard rule, enforced by the boundary gate). `bootstrap:
 * true` is what makes that honest here: there is no resource-level access
 * question to ask — recording that a call happened is not an edit to
 * anything the caller needs a level on — so the operation's own logic
 * (this function existing at all, reachable only from trusted code) is the
 * whole of what authorises it, the same reasoning `invitations.acceptLink`
 * already uses for a bootstrap operation.
 */
import {
  type AIProviderKind,
  aiUsageEvents,
  type UsageSource,
  withWorkspace,
} from "@openokr/db";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { type OperationTx, runOperation } from "../operations/operation.ts";
import { defaultMetrics, METRIC } from "../telemetry/recorder.ts";
import { costOfUsage, type ModelRates } from "./model-catalog.ts";
import { activePersonFor } from "./resolve.ts";

export interface RecordUsageEventInput {
  readonly workspaceId: string;
  readonly memberId?: string;
  readonly agentId?: string;
  readonly featureKey?: string;
  readonly source: UsageSource;
  readonly provider: AIProviderKind;
  readonly modelId: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cost: number;
  readonly latencyMs?: number;
  readonly status?: "ok" | "error" | "blocked";
}

/** Flags a call whose cost is far outside this feature's own recent
 * pattern. Needs at least a handful of prior calls to have a baseline
 * worth comparing against — a workspace's first-ever call is never
 * anomalous relative to nothing. */
const ANOMALY_MIN_SAMPLE = 5;
const ANOMALY_COST_MULTIPLE = 5;

async function detectAnomaly(
  tx: OperationTx,
  input: {
    readonly workspaceId: string;
    readonly featureKey: string | undefined;
    readonly cost: number;
  },
): Promise<{ readonly flagged: boolean; readonly reason?: string }> {
  if (input.cost <= 0) {
    return { flagged: false };
  }
  const recent = await tx
    .select({ cost: aiUsageEvents.cost })
    .from(aiUsageEvents)
    .where(
      and(
        eq(aiUsageEvents.workspaceId, input.workspaceId),
        input.featureKey
          ? eq(aiUsageEvents.featureKey, input.featureKey)
          : sql`true`,
      ),
    )
    .orderBy(desc(aiUsageEvents.createdAt))
    .limit(20);

  if (recent.length < ANOMALY_MIN_SAMPLE) {
    return { flagged: false };
  }
  const average =
    recent.reduce((sum, row) => sum + Number(row.cost), 0) / recent.length;
  if (average > 0 && input.cost > average * ANOMALY_COST_MULTIPLE) {
    return {
      flagged: true,
      reason: `Cost ${input.cost.toFixed(4)} is more than ${ANOMALY_COST_MULTIPLE}x this feature's recent average (${average.toFixed(4)}).`,
    };
  }
  return { flagged: false };
}

export async function recordUsageEvent(
  pool: Pool,
  input: RecordUsageEventInput,
): Promise<{ readonly id: string; readonly flagged: boolean }> {
  const metrics = defaultMetrics();
  return runOperation(
    { pool },
    {
      action: "ai.usage_recorded",
      workspaceId: input.workspaceId,
      actor: { kind: "system" },
      bootstrap: true,
      async execute({ tx, workspaceId }) {
        const anomaly = await detectAnomaly(tx, {
          workspaceId,
          featureKey: input.featureKey,
          cost: input.cost,
        });

        // openokr:allow-mutation: this is the operation's own execute, on
        // the transaction runOperation opened.
        const [inserted] = await tx
          .insert(aiUsageEvents)
          .values({
            workspaceId,
            memberId: input.memberId ?? null,
            agentId: input.agentId ?? null,
            featureKey: input.featureKey ?? null,
            source: input.source,
            provider: input.provider,
            modelId: input.modelId,
            inputTokens: input.inputTokens,
            outputTokens: input.outputTokens,
            cost: String(input.cost),
            latencyMs: input.latencyMs ?? null,
            status: input.status ?? "ok",
            flagged: anomaly.flagged,
            flaggedReason: anomaly.reason ?? null,
          })
          .returning({ id: aiUsageEvents.id });
        if (!inserted) {
          throw new Error("Could not record the usage event.");
        }

        // **Recorded beside the row, not instead of it** (P7-T06b). The
        // table is the record that answers a bill and survives a restart;
        // these are for the operator watching spend move today. Provider and
        // model are labels because both come from the model catalogue and
        // the set is fixed. The member, the agent and the feature are not:
        // one of them is a person and the other two would multiply the
        // series without telling an operator anything the table cannot.
        const usageLabels = {
          provider: input.provider,
          model: input.modelId,
        };
        metrics.count(
          METRIC.aiTokensTotal,
          { ...usageLabels, direction: "in" },
          input.inputTokens,
        );
        metrics.count(
          METRIC.aiTokensTotal,
          { ...usageLabels, direction: "out" },
          input.outputTokens,
        );
        metrics.count(METRIC.aiCostTotal, usageLabels, input.cost);

        return {
          result: { id: inserted.id, flagged: anomaly.flagged },
          activity: {
            kind: "ai.usage_recorded",
            subjectType: "workspace",
            subjectId: workspaceId,
            payload: {
              provider: input.provider,
              modelId: input.modelId,
              featureKey: input.featureKey ?? null,
            },
          },
          audit: {
            action: "ai.recordUsageEvent",
            targetType: "workspace",
            targetId: workspaceId,
            payload: {
              provider: input.provider,
              modelId: input.modelId,
              inputTokens: input.inputTokens,
              outputTokens: input.outputTokens,
              cost: input.cost,
            },
          },
        };
      },
    },
  );
}

export interface CallRecorderInput {
  readonly workspaceId: string;
  readonly provider: AIProviderKind;
  readonly rates: ModelRates;
  /** The signed-in person a request is for. Nobody, for an agent or the scheduler. */
  readonly forUser?: string;
  /** Defaults to an assist when a person asked, and an agent when nobody did. */
  readonly source?: UsageSource;
  /** The agent whose run this step belongs to, for its own budget. */
  readonly agentId?: string;
}

/**
 * What a provider tells about each call, turned into a usage row.
 *
 * **Without this nothing wrote one**, so every budget read zero and no cap ever
 * tripped (AI-NATIVE-PLAN §1 rule 7: "every call records tokens and cost"). The
 * host builds one per provider, because the host is what knows the workspace,
 * the person and the model's price.
 */
export function callRecorder(pool: Pool, input: CallRecorderInput) {
  return async (record: {
    readonly model: string;
    readonly usage: {
      readonly inputTokens: number;
      readonly outputTokens: number;
      readonly cachedInputTokens?: number;
    };
  }): Promise<void> => {
    const memberId = input.forUser
      ? await activePersonFor(pool, input.workspaceId, input.forUser)
      : undefined;
    await recordUsageEvent(pool, {
      workspaceId: input.workspaceId,
      ...(memberId ? { memberId } : {}),
      ...(input.agentId ? { agentId: input.agentId } : {}),
      source: input.source ?? (input.forUser ? "assist" : "agent"),
      provider: input.provider,
      modelId: record.model,
      inputTokens: record.usage.inputTokens,
      outputTokens: record.usage.outputTokens,
      cost: costOfUsage(input.rates, record.usage),
    });
  };
}

export interface UsageSummaryRow {
  readonly totalCalls: number;
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
  readonly totalCost: number;
  readonly flaggedCalls: number;
}

/** Every usage event for this workspace since `since`, summed. Used both by
 * the admin console's usage card and by budget checks. */
export async function summariseUsage(
  pool: Pool,
  input: {
    readonly workspaceId: string;
    readonly since: Date;
    readonly memberId?: string;
    readonly agentId?: string;
  },
): Promise<UsageSummaryRow> {
  const db = drizzle(pool);
  return withWorkspace(db, input.workspaceId, async (tx) => {
    const conditions = [
      eq(aiUsageEvents.workspaceId, input.workspaceId),
      gte(aiUsageEvents.createdAt, input.since),
    ];
    if (input.memberId) {
      conditions.push(eq(aiUsageEvents.memberId, input.memberId));
    }
    if (input.agentId) {
      conditions.push(eq(aiUsageEvents.agentId, input.agentId));
    }

    const [row] = await tx
      .select({
        totalCalls: sql<number>`count(*)::int`,
        totalInputTokens: sql<number>`coalesce(sum(${aiUsageEvents.inputTokens}), 0)::int`,
        totalOutputTokens: sql<number>`coalesce(sum(${aiUsageEvents.outputTokens}), 0)::int`,
        totalCost: sql<number>`coalesce(sum(${aiUsageEvents.cost}), 0)::float8`,
        flaggedCalls: sql<number>`coalesce(sum(case when ${aiUsageEvents.flagged} then 1 else 0 end), 0)::int`,
      })
      .from(aiUsageEvents)
      .where(and(...conditions));

    return (
      row ?? {
        totalCalls: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCost: 0,
        flaggedCalls: 0,
      }
    );
  });
}
