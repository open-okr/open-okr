/**
 * Each editable prompt's newest stored version (plan 0.7.0 A9,
 * docs/design/ai-evaluation.md §6).
 *
 * A plain export rather than an action, for the reason `resolveAgentRunCostCap`
 * is: the host that builds a drafter is already trusted to make the call, and
 * the card reads the same rows through `ai.readPrompt`. Read inside the tenant
 * setting, because `ai_prompts` carries the tenant floor and a bare pool would
 * match nothing.
 *
 * Only the keys this release can send. A row for any other key stays stored
 * and does nothing, which is what it always did.
 */
import { activeOnly, aiPrompts, withWorkspace } from "@openokr/db";
import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { defaultPromptFor } from "./prompts.ts";

export async function currentPromptVersions(
  pool: Pool,
  workspaceId: string,
): Promise<Readonly<Record<string, string>>> {
  const rows = await withWorkspace(drizzle(pool), workspaceId, (tx) =>
    tx
      .select({
        promptKey: aiPrompts.promptKey,
        systemPrompt: aiPrompts.systemPrompt,
      })
      .from(aiPrompts)
      .where(activeOnly(aiPrompts, eq(aiPrompts.workspaceId, workspaceId)))
      .orderBy(desc(aiPrompts.version)),
  );
  const newest: Record<string, string> = {};
  for (const row of rows) {
    if (
      defaultPromptFor(row.promptKey) !== undefined &&
      !Object.hasOwn(newest, row.promptKey)
    ) {
      newest[row.promptKey] = row.systemPrompt;
    }
  }
  return newest;
}
