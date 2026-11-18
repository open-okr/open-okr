/**
 * Writing down one read the copilot made (docs/design/copilot-live-data.md
 * 3.6, decision D6, plan 0.9.0 L3).
 *
 * The same table as the agent surface's record, `source = 'copilot'`, with the
 * member and no grant or token. **The same minimisation, exactly** (agent-tool-
 * calls.md D2, D3): no argument the model sent, no text the read returned and
 * no refusal sentence is stored. What is kept is the tool, where the read
 * stopped, how long it took and, for a read that opened one record, that
 * record's id.
 *
 * **Outside the Operation pipeline, on purpose**, for the reasons the agent
 * surface's recorder gives (agent-tool-calls.md D5): a record that a read
 * happened decides nothing, and through the pipeline every read would become
 * an activity and an audit row no retention could prune. A failed insert is
 * counted and never changes the member's answer (D6).
 */

import { aiToolCalls, withWorkspace } from "@openokr/db";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { defaultMetrics, METRIC } from "../telemetry/recorder.ts";
import { PROPOSE_TOOL } from "./propose-tool.ts";
import { COPILOT_READS, type ReadResult } from "./read-tools.ts";

/** Tools that open one named record, so the row may say which. */
const SINGLE_RECORD_TOOLS: ReadonlySet<string> = new Set([
  "goals.read",
  "kpis.detail",
  "initiatives.read",
  "tasks.read",
]);

/**
 * Records one read. Never throws.
 *
 * `tool` is stored only when it is one of the copilot's own tools: a name the
 * model made up is the model's text, and the agent surface keeps it null too.
 *
 * `propose_change` (plan 0.9.0 A4-D8) is one of them, with scope `write`
 * because it makes a proposal row, and is stored whatever its outcome,
 * including `unknown_tool` for a call in a round where it was not offered.
 */
export async function recordCopilotRead(
  pool: Pool,
  call: {
    readonly workspaceId: string;
    readonly memberId: string;
    readonly result: ReadResult;
  },
): Promise<void> {
  const { result } = call;
  const proposes = result.tool === PROPOSE_TOOL;
  const known =
    proposes || (COPILOT_READS as readonly string[]).includes(result.tool);
  const opened =
    known && SINGLE_RECORD_TOOLS.has(result.tool)
      ? result.entities[0]?.entityId
      : undefined;
  try {
    // openokr:allow-mutation: an operational record outside the pipeline,
    // as the agent surface's is (agent-tool-calls.md D5): one insert in its
    // own transaction, never a write anything decides on.
    await withWorkspace(drizzle(pool), call.workspaceId, (tx) =>
      tx.insert(aiToolCalls).values({
        workspaceId: call.workspaceId,
        memberId: call.memberId,
        source: "copilot",
        tool: known ? result.tool : null,
        scope: proposes ? "write" : known ? "read" : null,
        outcome: result.outcome,
        refusalCode: result.refusalCode ?? null,
        targetIds: opened ? [opened] : [],
        durationMs: result.durationMs,
      }),
    );
  } catch {
    // The same counter as the agent surface's: both are this table's inserts.
    defaultMetrics().count(METRIC.agentToolCallRecordFailures, {});
  }
}
