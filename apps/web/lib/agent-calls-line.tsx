import { callAction } from "@openokr/core";
import { getPool } from "./pool";
import { getTranslations } from "./translations";
import { requireWorkspace } from "./workspace";

/**
 * This week's calls through one of the member's own connections or agent
 * tokens, and the last few, under it on their own page (agent-tool-calls.md
 * D14, plan 0.7.0 A2). Never what the agent sent or read back: the record
 * does not hold it.
 */
export async function AgentCallsLine({
  kind,
  id,
}: {
  readonly kind: "grant" | "token";
  readonly id: string;
}) {
  const { t } = await getTranslations();
  const { session, workspace } = await requireWorkspace();
  const record = await callAction(
    {
      pool: getPool(),
      workspaceId: workspace.workspaceId,
      actor: { kind: "human", userId: session.user.id },
    },
    "connections.toolCalls",
    { kind, id },
  ).catch(() => null);
  if (record === null || record.calls.length === 0) {
    return null;
  }
  return (
    <details className="text-xs text-ink-3">
      <summary className="cursor-pointer">
        {t("account.agentCalls.week", {
          calls: record.week.calls,
          refused: record.week.refused,
        })}
      </summary>
      <ul className="mt-1 flex flex-col gap-0.5">
        {record.calls.slice(0, 10).map((call) => (
          <li key={`${call.calledAt}-${call.tool ?? ""}`}>
            {call.calledAt.slice(0, 16).replace("T", " ")}{" "}
            <code className="font-mono">{call.tool ?? "?"}</code>{" "}
            {call.outcome === "ok"
              ? ""
              : t("account.agentCalls.stopped", { outcome: call.outcome })}
          </li>
        ))}
      </ul>
    </details>
  );
}
