import { ACCESS_LEVELS, callAction } from "@openokr/core";
import { Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import { resolveAccessLevelFor } from "../../../lib/access";
import { getPool } from "../../../lib/auth";
import { requireWorkspace } from "../../../lib/workspace";

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

export default async function NudgeVolumePage() {
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
        <h1>Nudge volume</h1>
        <Card>
          <CardBody>
            <p className="text-sm text-ink-2">
              How often the product speaks, and to whom, is behind the coaching
              permission. Ask a workspace administrator.
            </p>
          </CardBody>
        </Card>
      </>
    );
  }

  const volume = await callAction(
    {
      pool: getPool(),
      workspaceId: workspace.workspaceId,
      actor: { kind: "human", userId: session.user.id },
    },
    "nudges.volume",
    { days: 30 },
  );

  const total = volume.rules.reduce(
    (sum, rule) => sum + rule.sent + rule.suppressed,
    0,
  );

  return (
    <>
      <h1>Nudge volume</h1>
      <p className="text-sm text-ink-3">
        The last {volume.windowDays} days. Noise is bounded and measurable
        rather than emergent, and this is where it is measured.
      </p>

      <Card>
        <CardHeader className="justify-between">
          <h2 className="text-sm font-bold text-ink">The noisiest rules</h2>
          <Chip tone="neutral">{total} in the window</Chip>
        </CardHeader>
        <CardBody className="p-0">
          {volume.rules.length === 0 ? (
            <p className="p-3 text-sm text-ink-3">
              Nothing has fired yet. A workspace with no goals under a cadence
              has nothing to be nudged about.
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
                    <span className="text-ink">{rule.sent} sent</span>
                    {rule.suppressed > 0 ? (
                      <span className="text-ink-3">{rule.suppressed} held</span>
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
          <h2 className="text-sm font-bold text-ink">Why it stayed quiet</h2>
        </CardHeader>
        <CardBody className="flex flex-col gap-1.5">
          {volume.suppressionReasons.length === 0 ? (
            <p className="text-sm text-ink-3">
              Nothing has been held back. Every nudge the product decided on was
              delivered.
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
            A rule that fires often and is held most of the time is not a quiet
            rule. It is one that would be unbearable if a guard were relaxed.
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="justify-between">
          <h2 className="text-sm font-bold text-ink">
            Over the weekly ceiling
          </h2>
          <Chip tone={volume.loudestMembers.length > 0 ? "warn" : "ok"}>
            {volume.ceilingPerWeek} per member per week
          </Chip>
        </CardHeader>
        <CardBody>
          {volume.loudestMembers.length === 0 ? (
            <p className="text-sm text-ok-text">
              Nobody is over the ceiling. The §11 limit is doing its job before
              anybody has to notice.
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
                    {member.sentThisWeek} this week
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </>
  );
}
