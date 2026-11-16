import { ACCESS_LEVELS, listSupportSessions } from "@openokr/core";
import { Card, CardBody, CardHeader, Chip, type ChipProps } from "@openokr/ui";
import Link from "next/link";
import { requireAccessLevel } from "../../../lib/access.ts";
import { getInstanceName } from "../../../lib/instance-name";
import { pageTitle } from "../../../lib/page-title.ts";
import { getPool } from "../../../lib/pool";
import { getTranslations } from "../../../lib/translations";
import { GrantDecision } from "./grant-decision";

export const generateMetadata = pageTitle("pageTitle.adminSupport");

/**
 * S-48, the customer's half: who has asked to come in, and who has been
 * (P8-T04b).
 *
 * **This screen exists so a customer never has to ask the vendor what the
 * vendor did.** Every request, every grant, every refusal and every ending is
 * here, with who asked, why, who answered, how long for and how it finished.
 *
 * Gated at `full`, which is the level that manages who is in the workspace.
 * Letting somebody in from outside is the largest version of that decision,
 * so it takes the same level rather than a smaller one.
 *
 * The banner in the app shell is the other half, and it is the half that
 * matters when nobody is looking at this page.
 */
export const dynamic = "force-dynamic";

const LEVEL_NAME: Record<number, string> = {
  [ACCESS_LEVELS.view]: "read only",
  [ACCESS_LEVELS.comment]: "read and comment",
  [ACCESS_LEVELS.edit]: "read and change",
};

const END_TONE: Record<string, ChipProps["tone"]> = {
  expired: "neutral",
  revoked: "warn",
  finished: "neutral",
  refused: "neutral",
};

function when(value: Date | string): string {
  return new Date(value).toISOString().replace("T", " ").slice(0, 16);
}

export default async function SupportAccessPage() {
  const access = await requireAccessLevel(ACCESS_LEVELS.full);
  const { t } = await getTranslations();
  const instanceName = await getInstanceName();
  const sessions = await listSupportSessions(getPool(), access.workspaceId);

  const pending = sessions.filter(
    (one) => one.grantedAt === null && one.endedAt === null,
  );
  const live = sessions.filter(
    (one) => one.grantedAt !== null && one.endedAt === null,
  );
  const past = sessions.filter((one) => one.endedAt !== null);

  const emptyNote = "text-ink-2 text-sm";
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="font-bold text-ink text-lg">
          {t("admin.support.title")}
        </h1>
        <p className="max-w-prose text-ink-3 text-sm">
          {t("admin.support.intro", { name: instanceName })}
        </p>
      </header>

      <Card>
        <CardHeader className="flex-col items-stretch gap-0.5">
          <h2 className="font-semibold text-ink text-sm">
            {t("admin.support.waiting")}
          </h2>
          <p className="text-ink-3 text-xs">
            {t("admin.support.waitingDescription")}
          </p>
        </CardHeader>
        <CardBody>
          {pending.length === 0 ? (
            <p className={emptyNote}>{t("admin.support.nobodyAsked")}</p>
          ) : (
            <div className="flex flex-col gap-3">
              {pending.map((session) => (
                <GrantDecision
                  key={session.id}
                  reason={session.reason}
                  requestedAt={when(session.requestedAt)}
                  sessionId={session.id}
                />
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {live.length > 0 ? (
        <Card className="border-bad-dot">
          <CardHeader className="flex-col items-stretch gap-0.5">
            <h2 className="font-semibold text-bad text-sm">
              {t("admin.support.inHereNow")}
            </h2>
            <p className="text-ink-3 text-xs">
              {t("admin.support.bannerEndsIt")}
            </p>
          </CardHeader>
          <CardBody className="flex flex-col gap-3">
            {live.map((session) => (
              <div key={session.id}>
                <p className="text-ink text-sm">
                  {t("admin.support.grantedUntil", {
                    Date: when(session.grantedAt as Date),
                    Date2: when(session.expiresAt as Date),
                    only: LEVEL_NAME[session.level] ?? "read only",
                  })}
                </p>
                <p className="mt-1 text-ink-2 text-sm">{session.reason}</p>
              </div>
            ))}
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="flex-col items-stretch gap-0.5">
          <h2 className="font-semibold text-ink text-sm">
            {t("admin.support.everythingBefore")}
          </h2>
          <p className="text-ink-3 text-xs">
            {t("admin.support.pastDescription")}
          </p>
        </CardHeader>
        <CardBody>
          {past.length === 0 ? (
            <p className={emptyNote}>
              {t("admin.support.nobodyHasBeen", { name: instanceName })}
            </p>
          ) : (
            <ul
              // biome-ignore lint/a11y/noNoninteractiveTabindex: a scroll region must be focusable to scroll by keyboard
              tabIndex={0}
              aria-label={t("admin.support.pastLabel")}
              // Scrolls inside the card at about five rows. `relative` keeps
              // an absolute or sr-only child inside the scroll box.
              className="relative max-h-[296px] divide-y divide-line overflow-y-auto overscroll-contain rounded-lg border border-line"
            >
              {past.map((session) => (
                <li className="flex flex-col gap-2 px-3 py-3" key={session.id}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Chip
                      tone={END_TONE[session.endedReason ?? ""] ?? "neutral"}
                    >
                      {session.endedReason}
                    </Chip>
                    <span className="text-ink-3 text-xs">
                      {t("admin.support.asked", {
                        requestedAt: when(session.requestedAt),
                        granted: session.grantedAt
                          ? `, in from ${when(session.grantedAt)} to ${when(session.endedAt as Date)}`
                          : ", never granted",
                      })}
                    </span>
                  </div>
                  <p className="text-ink text-sm">{session.reason}</p>
                  {/* support-access.md §10 D11, plan 0.7.0 P2: what the guest
                   * did, from the audit trail, which already filters by actor.
                   * The guest is one member across every session (§4). */}
                  {session.grantedAt !== null && session.memberId !== null ? (
                    <Link
                      className="w-fit text-brand-text text-xs hover:underline"
                      href={`/admin/audit?actorMemberId=${session.memberId}`}
                    >
                      {t("admin.support.whatWasDone")}
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
