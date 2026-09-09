import { ACCESS_LEVELS, callAction } from "@openokr/core";
import { Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import { resolveAccessLevelFor } from "../../../lib/access";
import { getPool } from "../../../lib/auth";
import { getTranslations } from "../../../lib/translations";
import { requireWorkspace } from "../../../lib/workspace";
import { NudgeRuleCards } from "./rule-cards.tsx";

/**
 * The nudge volume card (UIUX-PLAN.md §4 S-36, P4-T04c).
 *
 * The screen that tells an administrator their product is annoying people. It
 * exists because §6.3 says noise has to be measurable rather than emergent, and
 * the only way that is true is if somebody can see it without asking an
 * engineer.
 *
 * **Suppressions are shown beside sends, not hidden.** A rule that fires two
 * hundred times and is suppressed a hundred and ninety of them is not a quiet
 * rule: it is a rule that would be unbearable if the guards were ever relaxed,
 * and that is exactly what an administrator should see before relaxing one.
 *
 * Behind `manage_coaching`, which is `full`. The numbers name members, and who
 * is being nudged the most is not a fact everybody in a workspace needs.
 */

const REASON_LABEL: Record<string, string> = {
  dedup: "Already said today",
  quiet_hours: "Quiet hours",
  snooze: "Snoozed by the member",
  disabled: "Rule switched off",
  ceiling: "Weekly ceiling reached",
};

/**
 * The channels a rule can be routed to (P6-G21).
 *
 * The same set a member's own primary channel is chosen from, which is what
 * makes an override substitutable for it. Built here rather than in the card:
 * a client component that imports a value from `@openokr/core` pulls the
 * database layer into its bundle and the build fails on `dns`, which is
 * exactly what happened at P6-G13b.
 */
const NUDGE_CHANNELS = [
  { value: "app", label: "in-app only" },
  { value: "email", label: "email" },
  { value: "slack", label: "Slack" },
  { value: "teams", label: "Microsoft Teams" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "telegram", label: "Telegram" },
];

export default async function NudgeVolumePage() {
  const { t } = await getTranslations();

  const { session, workspace } = await requireWorkspace();
  const level = await resolveAccessLevelFor(
    workspace.workspaceId,
    workspace.memberId,
  );

  if (level < ACCESS_LEVELS.full) {
    // Said rather than hidden. Somebody who cannot see this should know it
    // exists and who to ask, which is what a permission-denied state is for.
    return (
      <>
        <h1>{t("admin.nudges.nudgeVolume")}</h1>
        <Card>
          <CardBody>
            <p className="text-sm text-ink-2">
              {t("admin.nudges.howOftenTheProduct")}
            </p>
          </CardBody>
        </Card>
      </>
    );
  }

  const context = {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };
  const [volume, rules] = await Promise.all([
    callAction(context, "nudges.volume", { days: 30 }),
    // Every §6.4 rule with what this workspace decided about it (P6-G21).
    callAction(context, "nudges.rules", {}),
  ]);

  const total = volume.rules.reduce(
    (sum, rule) => sum + rule.sent + rule.suppressed,
    0,
  );

  return (
    <>
      <h1>{t("admin.nudges.nudgeVolume")}</h1>
      <p className="text-sm text-ink-3">
        {t("admin.nudges.theLast")} {volume.windowDays}{" "}
        {t("admin.nudges.daysNoiseIsBounded")}
      </p>

      <Card>
        <CardHeader className="justify-between">
          <h2 className="text-sm font-bold text-ink">
            {t("admin.nudges.theNoisiestRules")}
          </h2>
          <Chip tone="neutral">
            {total} {t("admin.nudges.inTheWindow")}
          </Chip>
        </CardHeader>
        <CardBody className="p-0">
          {volume.rules.length === 0 ? (
            <p className="p-3 text-sm text-ink-3">
              {t("admin.nudges.nothingHasFiredYet")}
            </p>
          ) : (
            <ul className="flex flex-col">
              {volume.rules.map((rule) => (
                <li
                  key={rule.ruleKey}
                  className="flex flex-wrap items-center justify-between gap-2 border-line border-b px-3 py-2 last:border-b-0"
                >
                  <a
                    href={`/method/${rule.ruleKey}`}
                    className="font-mono text-xs text-brand-text hover:underline"
                  >
                    {rule.ruleKey}
                  </a>
                  <span className="flex items-center gap-2 text-xs tabular-nums">
                    <span className="text-ink">
                      {rule.sent} {t("admin.nudges.sent")}
                    </span>
                    {rule.suppressed > 0 ? (
                      <span className="text-ink-3">
                        {rule.suppressed} {t("common.held")}
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-sm font-bold text-ink">
            {t("admin.nudges.whyItStayedQuiet")}
          </h2>
        </CardHeader>
        <CardBody className="flex flex-col gap-1.5">
          {volume.suppressionReasons.length === 0 ? (
            <p className="text-sm text-ink-3">
              {t("admin.nudges.nothingHasBeenHeld")}
            </p>
          ) : (
            volume.suppressionReasons.map((reason) => (
              <div
                key={reason.reason}
                className="flex items-center justify-between gap-2 text-sm"
              >
                <span className="text-ink-2">
                  {REASON_LABEL[reason.reason] ?? reason.reason}
                </span>
                <span className="tabular-nums text-ink-3">{reason.count}</span>
              </div>
            ))
          )}
          <p className="text-xs text-ink-4">
            {t("admin.nudges.aRuleThatFires")}
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="justify-between">
          <h2 className="text-sm font-bold text-ink">
            {t("admin.nudges.overTheWeeklyCeiling")}
          </h2>
          <Chip tone={volume.loudestMembers.length > 0 ? "warn" : "ok"}>
            {volume.ceilingPerWeek} {t("admin.nudges.perMemberPerWeek")}
          </Chip>
        </CardHeader>
        <CardBody>
          {volume.loudestMembers.length === 0 ? (
            <p className="text-sm text-ok">
              {t("admin.nudges.nobodyIsOverThe")}
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {volume.loudestMembers.map((member) => (
                <li
                  key={member.memberId}
                  className="flex items-center justify-between gap-2 text-sm"
                >
                  <span className="text-ink">{member.name}</span>
                  <span className="tabular-nums text-bad">
                    {member.sentThisWeek} {t("admin.nudges.thisWeek")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
      <NudgeRuleCards
        rules={rules.rules}
        quietMode={rules.quietMode}
        channels={NUDGE_CHANNELS}
      />
    </>
  );
}
