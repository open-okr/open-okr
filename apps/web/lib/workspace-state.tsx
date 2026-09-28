import { Card, CardBody, Chip } from "@openokr/ui";
import Link from "next/link";
import { getTranslations } from "./translations";

/**
 * What a workspace that is not taking writes tells its members (P6-G25).
 *
 * **The enforcement has existed since P2-T09 and nothing said so.** The
 * permission layer collapses a `read_only` or `frozen` workspace to view-only
 * except for an admin recovery list, so a save came back refused with a
 * message about access and no reader could tell that the workspace itself had
 * been stopped. The gap audit recorded the missing control; the missing
 * explanation is the same gap from the other side.
 *
 * **A banner, not a modal.** §4.1 says reads are unaffected and the admin
 * recovery list stays reachable, and a modal over every screen would contradict
 * both: a reader could not read, and an administrator could not reach the one
 * control that lifts it. This sits above the content on every screen, says what
 * is happening in the workspace's own words, and links an administrator
 * straight to the switch.
 *
 * **`read_only` and `frozen` read differently on purpose.** The pipeline treats
 * them identically, which `operations/freeze.ts` says outright, and a member
 * does not care about that: one is a decision somebody made about how the
 * workspace is being used, the other is a state an instance operator put it
 * in. Saying "frozen" for both would make the first sound like a fault.
 */
export async function WorkspaceStateBanner({
  state,
  canRecover,
}: {
  readonly state: "active" | "read_only" | "frozen";
  /** Whether this member can reach the control that lifts it. */
  readonly canRecover: boolean;
}) {
  if (state === "active") {
    return null;
  }

  const { t } = await getTranslations();
  const frozen = state === "frozen";

  return (
    <Card data-testid="workspace-state-banner">
      <CardBody className="flex flex-wrap items-baseline gap-2.5">
        <Chip tone={frozen ? "bad" : "warn"}>
          {frozen
            ? t("workspaceState.frozen")
            : t("admin.support.grant.readOnly")}
        </Chip>
        <span className="min-w-0 flex-1 text-sm text-ink-2">
          {frozen
            ? t("workspaceState.frozenExplained")
            : t("workspaceState.readOnlyExplained")}
        </span>
        {canRecover ? (
          <Link
            href="/admin/general"
            className="text-xs font-semibold text-brand-text hover:underline"
          >
            {t("workspaceState.changeItInAdmin")}
          </Link>
        ) : (
          <span className="text-xs text-ink-4">
            {t("workspaceState.anAdministratorCanLiftIt")}
          </span>
        )}
      </CardBody>
    </Card>
  );
}
