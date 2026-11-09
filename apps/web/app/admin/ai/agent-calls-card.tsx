import { Card, CardBody, CardHeader } from "@openokr/ui";
import { getTranslations } from "../../../lib/translations";

/**
 * How much external agents were used, and refused, over 30 days, on S-37's
 * usage area (agent-tool-calls.md D15, plan 0.7.0 A2). Totals only: no
 * member is named here, and a member's own calls are on their own pages.
 */
export async function AgentCallsCard({
  summary,
}: {
  readonly summary: {
    readonly calls: number;
    readonly refused: number;
    readonly busiestTools: readonly {
      readonly tool: string;
      readonly calls: number;
    }[];
  };
}) {
  const { t } = await getTranslations();
  return (
    <Card>
      <CardHeader>
        <h2 className="text-sm font-bold text-ink">
          {t("admin.ai.agentCalls.title")}
        </h2>
      </CardHeader>
      <CardBody className="flex flex-col gap-2 text-sm">
        {summary.calls === 0 ? (
          <p className="text-ink-3 text-xs">{t("admin.ai.agentCalls.none")}</p>
        ) : (
          <>
            <p className="text-ink-2">
              {t("admin.ai.agentCalls.totals", {
                calls: summary.calls,
                refused: summary.refused,
              })}
            </p>
            <ul className="flex flex-col gap-1 text-xs text-ink-3">
              {summary.busiestTools.map((tool) => (
                <li key={tool.tool}>
                  <code className="font-mono">{tool.tool}</code>{" "}
                  {t("admin.ai.agentCalls.toolCalls", { calls: tool.calls })}
                </li>
              ))}
            </ul>
          </>
        )}
      </CardBody>
    </Card>
  );
}
