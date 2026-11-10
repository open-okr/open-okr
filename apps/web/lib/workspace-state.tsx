import { readTrialNotice } from "@openokr/core";
import { Card, CardBody, Chip } from "@openokr/ui";
import Link from "next/link";
import { type Hold, readLifecycle } from "./held-by.ts";
import { getPool } from "./pool";
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
  hold = null,
}: {
  readonly state: "active" | "read_only" | "frozen";
  /** Whether this member can reach the control that lifts it. */
  readonly canRecover: boolean;
  /**
   * The provider holds it, so no administrator here can lift it and the banner
   * does not send one to a switch that would refuse. A closed workspace says when
   * it will be deleted (docs/design/workspace-erasure.md §8).
   */
  readonly hold?: Hold | null;
}) {
  if (state === "active") {
    return null;
  }

  const { t, locale } = await getTranslations();
  if (hold?.kind === "closed") {
    const day = (date: Date) =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: "long",
        timeZone: "UTC",
      }).format(date);
    return (
      <Card data-testid="workspace-state-banner">
        <CardBody className="flex flex-wrap items-baseline gap-2.5">
          <Chip tone="bad">{t("workspaceState.closed")}</Chip>
          <span className="min-w-0 flex-1 text-sm text-ink-2">
            {hold.eraseOn
              ? t("workspaceState.closedUntil", {
                  closed: day(hold.closedAt),
                  erase: day(hold.eraseOn),
                })
              : t("workspaceState.closedKept", { closed: day(hold.closedAt) })}
          </span>
          {/* The archive is how a closed customer leaves with their data,
              and it still works here (backups-screen.md U7, plan 0.7.0 U3). */}
          {canRecover ? (
            <Link
              href="/admin/backups"
              className="text-xs font-semibold text-brand-text hover:underline"
            >
              {t("workspaceState.takeAnArchive")}
            </Link>
          ) : null}
          {canRecover && hold.ownerMayReopen ? (
            <Link
              href="/admin/general"
              className="text-xs font-semibold text-brand-text hover:underline"
            >
              {t("workspaceState.reopenInAdmin")}
            </Link>
          ) : (
            <span className="text-xs text-ink-4">
              {t("workspaceState.onlyTheProviderReopens")}
            </span>
          )}
        </CardBody>
      </Card>
    );
  }
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
            : hold?.kind === "trial"
              ? t("workspaceState.trialEndedReadOnly")
              : t("workspaceState.readOnlyExplained")}
        </span>
        {/* A trial's read-only mode is the customer's to leave, as billing's
            is: choose a plan, or make the people fit and settle
            (tenant-lifecycle.md §11 T8, T10). */}
        {hold?.kind === "trial" && canRecover ? (
          <Link
            href="/admin/plan"
            className="text-xs font-semibold text-brand-text hover:underline"
          >
            {t("workspaceState.choosePlan")}
          </Link>
        ) : hold ? (
          <span className="text-xs text-ink-4">
            {t("workspaceState.onlyTheProvider")}
          </span>
        ) : canRecover ? (
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

/** As the erasure reminder's week (tenant-lifecycle.md §11 T10). */
const TRIAL_NOTICE_DAYS = 7;

/**
 * The last week of a trial, for those who can choose a plan
 * (docs/design/tenant-lifecycle.md §11 T10, plan 0.7.0 P4c). Page state
 * rather than a message: the day, the plan, and what happens if nobody
 * chooses. Nothing before that week, and nothing to anybody who cannot act
 * on it.
 */
export async function TrialEndingBanner({
  workspaceId,
}: {
  readonly workspaceId: string;
}) {
  const lifecycle = await readLifecycle(workspaceId);
  const endsAt = lifecycle?.state === "active" ? lifecycle.trialEndsAt : null;
  const now = Date.now();
  if (
    !endsAt ||
    endsAt.getTime() <= now ||
    endsAt.getTime() - now > TRIAL_NOTICE_DAYS * 24 * 60 * 60 * 1000
  ) {
    return null;
  }
  const notice = await readTrialNotice(getPool(), workspaceId).catch(
    () => null,
  );
  const { t, locale } = await getTranslations();
  const date = new Intl.DateTimeFormat(locale, {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(endsAt);
  return (
    <Card data-testid="trial-ending-banner">
      <CardBody className="flex flex-wrap items-baseline gap-2.5">
        <Chip tone="warn">{t("workspaceState.trial")}</Chip>
        <span className="min-w-0 flex-1 text-sm text-ink-2">
          {t("workspaceState.trialEnds", {
            plan: notice?.planName ?? "",
            date,
            fallback: notice?.defaultPlanName ?? t("workspaceState.noPlan"),
          })}
        </span>
        <Link
          href="/admin/plan"
          className="text-xs font-semibold text-brand-text hover:underline"
        >
          {t("workspaceState.choosePlan")}
        </Link>
      </CardBody>
    </Card>
  );
}
