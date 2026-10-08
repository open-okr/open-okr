import { Button, Chip } from "@openokr/ui";
import Link from "next/link";
import { getTranslations } from "../../lib/translations";
import { ActionForm } from "../cycle/action-form.tsx";
import { decideProposal } from "./actions.ts";

/**
 * An agent proposal, decided where the review inbox lists it (S-02,
 * completeness review M-08).
 *
 * **The row used to be a link to `/admin/agents`**, which the admin layout
 * refuses to anybody below `full`. So a champion who was not an administrator
 * saw their drafted check-in listed as something they owed and had nowhere to
 * go with it. The decision is made here now, by the member the inbox listed it
 * for, through `proposals.apply` and `proposals.dismiss`.
 *
 * **What it would change comes first, then the two answers.** AI-NATIVE-PLAN
 * §1's rule is that a human confirms with a preview, so the buttons sit under
 * the preview rather than beside the title. The preview is the core's, in the
 * same label and value shape the copilot's proposal card renders.
 *
 * **Offered whether or not the change itself is allowed**, like the copilot's
 * card. Applying runs the proposed action in the member's name, and an action
 * they may not perform refuses with its own reason, which the form shows.
 *
 * **A proposed recovery carries the other two responses** (METHOD.md §6.5,
 * P9-T18b). The coach proposes the recovery because it is the one it can
 * draft, not because it is the only answer: fixing the KPI now or adding a key
 * result to an objective that exists are on its card on the recovery board,
 * and choosing either settles this proposal.
 */
export async function ProposalDecision({
  proposal,
  subjectId,
}: {
  /** What the proposal is about: the KPI, for a proposed recovery. */
  readonly subjectId: string;
  readonly proposal: {
    readonly id: string;
    readonly action: string;
    readonly aiGenerated: boolean;
    readonly preview: readonly {
      readonly label: string;
      readonly value: string;
    }[];
  };
}) {
  const { t } = await getTranslations();

  return (
    <div className="mt-1.5 flex flex-col gap-2">
      {proposal.aiGenerated ? (
        // A model chose these words, and the reader is told before deciding.
        <Chip tone="agent" className="self-start">
          {t("review.proposalDecision.draftedByAi")}
        </Chip>
      ) : null}
      {proposal.preview.length > 0 ? (
        <dl className="flex flex-col gap-1">
          {proposal.preview.map((line) => (
            <div key={line.label} className="flex gap-2 text-xs">
              <dt className="w-24 flex-none text-ink-4">{line.label}</dt>
              <dd className="min-w-0 text-ink-2">{line.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <ActionForm action={decideProposal}>
        <input type="hidden" name="proposalId" value={proposal.id} />
        <span className="flex flex-wrap items-center gap-2">
          <Button type="submit" name="decision" value="apply" variant="primary">
            {t("common.apply")}
          </Button>
          <Button type="submit" name="decision" value="dismiss" variant="ghost">
            {t("common.dismiss")}
          </Button>
          <span className="text-xs text-ink-4">
            {t("review.proposalDecision.applyingMakesThisChange")}
          </span>
        </span>
      </ActionForm>
      {proposal.action === "kpis.launchRecovery" ? (
        <p className="text-xs text-ink-3">
          {t("review.proposalDecision.orAnswerItAnotherWay")}{" "}
          <Link
            href={`/kpis/recovery#kpi-${subjectId}`}
            className="font-semibold text-brand-text hover:underline"
          >
            {t("review.proposalDecision.otherResponses")}
          </Link>
        </p>
      ) : null}
    </div>
  );
}
