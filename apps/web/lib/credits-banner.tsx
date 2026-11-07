import { creditsPausedReason } from "@openokr/core";
import { getPool } from "./pool";
import { getTranslations } from "./translations";

/**
 * AI is paused because this workspace has used its credits
 * (docs/design/ai-credits.md §9).
 *
 * One line across the product rather than a disabled control on each of twenty
 * screens. It says that nothing else stopped, because somebody who sees the copilot
 * go quiet should not wonder whether their nudges and scores have too. Absent on any
 * instance with no credits, and for a workspace on its own key.
 */
export async function CreditsBanner({
  workspaceId,
}: {
  readonly workspaceId: string;
}) {
  if (!(await creditsPausedReason(getPool(), workspaceId))) {
    return null;
  }
  const { t } = await getTranslations();
  return (
    <p
      className="mb-4.5 rounded-lg bg-warn-bg px-3 py-2 text-sm text-warn"
      role="status"
    >
      {t("lib.creditsBanner.paused")}
    </p>
  );
}
