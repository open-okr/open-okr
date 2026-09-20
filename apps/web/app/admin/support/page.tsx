import { ACCESS_LEVELS, listSupportSessions } from "@openokr/core";
import { Chip, type ChipProps } from "@openokr/ui";
import { requireAccessLevel } from "../../../lib/access.ts";
import { getPool } from "../../../lib/pool";
import { getTranslations } from "../../../lib/translations";
import { GrantDecision } from "./grant-decision";

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
  const sessions = await listSupportSessions(getPool(), access.workspaceId);

  const pending = sessions.filter(
    (one) => one.grantedAt === null && one.endedAt === null,
  );
  const live = sessions.filter(
    (one) => one.grantedAt !== null && one.endedAt === null,
  );
  const past = sessions.filter((one) => one.endedAt !== null);

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="font-bold text-ink text-lg">
          {t("admin.support.title")}
        </h1>
        <p className="text-ink-2 text-sm">{t("admin.support.intro")}</p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold text-ink text-sm">
          {t("admin.support.waiting")}
        </h2>
        {pending.length === 0 ? (
          <p className="rounded-lg border border-line bg-surface px-4 py-3 text-ink-2 text-sm">
            {t("admin.support.nobodyAsked")}
          </p>
        ) : (
          pending.map((session) => (
            <GrantDecision
              key={session.id}
              reason={session.reason}
              requestedAt={when(session.requestedAt)}
              sessionId={session.id}
            />
          ))
        )}
      </section>

      {live.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="font-semibold text-ink text-sm">
            {t("admin.support.inHereNow")}
          </h2>
          {live.map((session) => (
            <div
              className="rounded-lg border border-bad-dot bg-surface px-4 py-3"
              key={session.id}
            >
              <p className="text-ink text-sm">
                {t("admin.support.grantedUntil", {
                  Date: when(session.grantedAt as Date),
                  Date2: when(session.expiresAt as Date),
                  only: LEVEL_NAME[session.level] ?? "read only",
                })}
              </p>
              <p className="mt-1 text-ink-2 text-sm">{session.reason}</p>
              <p className="mt-1 text-ink-3 text-xs">
                {t("admin.support.bannerEndsIt")}
              </p>
            </div>
          ))}
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold text-ink text-sm">
          {t("admin.support.everythingBefore")}
        </h2>
        {past.length === 0 ? (
          <p className="rounded-lg border border-line bg-surface px-4 py-3 text-ink-2 text-sm">
            {t("admin.support.nobodyHasBeen")}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {past.map((session) => (
              <li
                className="flex flex-col gap-1 rounded-lg border border-line bg-surface px-4 py-3"
                key={session.id}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Chip tone={END_TONE[session.endedReason ?? ""] ?? "neutral"}>
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
              </li>
            ))}
          </ul>
        )}
        <p className="text-ink-3 text-xs">
          {t("admin.support.everythingAudited")}
        </p>
      </section>
    </div>
  );
}
