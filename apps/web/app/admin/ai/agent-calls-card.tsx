import { Card, CardBody, CardHeader } from "@openokr/ui";
import { stamper } from "../../../lib/stamper";
import { getTranslations } from "../../../lib/translations";

/** An outcome in the reader's words, from the catalogue. */
function outcomeWords(
  outcome: string,
  t: Awaited<ReturnType<typeof getTranslations>>["t"],
): string {
  switch (outcome) {
    case "ok":
      return t("admin.ai.agentCalls.outcome.ok");
    case "unknown_tool":
      return t("admin.ai.agentCalls.outcome.unknown_tool");
    case "outside_toolsets":
      return t("admin.ai.agentCalls.outcome.outside_toolsets");
    case "refused_scope":
      return t("admin.ai.agentCalls.outcome.refused_scope");
    case "invalid_input":
      return t("admin.ai.agentCalls.outcome.invalid_input");
    case "refused":
      return t("admin.ai.agentCalls.outcome.refused");
    case "failed":
      return t("admin.ai.agentCalls.outcome.failed");
    default:
      return outcome;
  }
}

/**
 * How much external agents were used, and refused, over 30 days, on S-37's
 * usage area (agent-tool-calls.md D15, plan 0.7.0 A2). Totals only for
 * agents: no member is named, and a member's own calls are on their own pages.
 *
 * Below them, the copilot's latest reads with the member each was made for
 * (plan 0.9.0 L3, copilot-live-data.md acceptance 10). The copilot reads as a
 * person, so the person is what an administrator needs to see.
 */
export async function AgentCallsCard({
  summary,
  timeZone,
}: {
  /** The workspace's time zone, which a read's time is shown in. */
  readonly timeZone: string;
  readonly summary: {
    readonly calls: number;
    readonly refused: number;
    readonly busiestTools: readonly {
      readonly tool: string;
      readonly calls: number;
    }[];
    readonly copilot: {
      readonly calls: number;
      readonly refused: number;
      readonly recent: readonly {
        readonly member: string;
        readonly tool: string | null;
        readonly outcome: string;
        readonly calledAt: string;
      }[];
    };
  };
}) {
  const { t } = await getTranslations();
  const { stamp } = stamper(timeZone);
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
        <h3 className="mt-2 text-sm font-bold text-ink">
          {t("admin.ai.agentCalls.copilotTitle")}
        </h3>
        {summary.copilot.calls === 0 ? (
          <p className="text-ink-3 text-xs">
            {t("admin.ai.agentCalls.copilotNone")}
          </p>
        ) : (
          <>
            <p className="text-ink-2">
              {t("admin.ai.agentCalls.copilotTotals", {
                calls: summary.copilot.calls,
                refused: summary.copilot.refused,
              })}
            </p>
            <ul className="flex flex-col gap-1 text-xs text-ink-3">
              {summary.copilot.recent.map((read, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: a read has no id of its own here; the list is fixed per render.
                <li key={index}>
                  {t("admin.ai.agentCalls.copilotRead", {
                    time: stamp(read.calledAt),
                    member: read.member,
                    outcome: outcomeWords(read.outcome, t),
                  })}{" "}
                  <code className="font-mono">{read.tool ?? "?"}</code>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardBody>
    </Card>
  );
}
