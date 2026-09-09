"use client";

import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  useTranslations,
} from "@openokr/ui";
import { useState, useTransition } from "react";
import { setNudgeRuleAction, setQuietModeAction } from "./rule-actions";

/**
 * A card per §6.4 rule (S-36, P6-G21, GAP-AUDIT G-04).
 *
 * **Every switch existed and none had a handle.** `nudge_rules` has held
 * `enabled`, `channel_override` and `quiet_mode_exempt` since P4-T04b, and the
 * suppression decision has read the first and the third all along. A workspace
 * being drowned by its own product could see the volume on this very page and
 * could not turn anything down.
 *
 * **The volume is the argument, so it sits on the row.** "This one sent
 * forty-one messages last week" is the sentence that makes the decision; the
 * rule's key is not.
 *
 * **A disabled rule goes quiet and says so.** It does not vanish: the run still
 * writes a nudge row with `disabled` as its suppression reason, which is what
 * keeps this page honest about what the product decided rather than about what
 * it happened to send.
 */

export interface RuleRow {
  readonly key: string;
  readonly fires: string;
  readonly recipient: string;
  readonly escalates: boolean;
  readonly deterministic: boolean;
  readonly enabled: boolean;
  readonly channelOverride: string | null;
  readonly quietModeExempt: boolean;
  /**
   * The §11 ladder this rule owns, null on the twenty-one that own none
   * (P6-G21b). `own` is null while the workspace is on the canon, which is
   * what lets the fields show §11's numbers as placeholders rather than as
   * something somebody typed.
   */
  readonly ladder: {
    readonly rungs: readonly string[];
    readonly canon: Readonly<Record<string, number>>;
    readonly own: Readonly<Record<string, number>> | null;
    readonly governs: readonly string[];
  } | null;
  readonly configured: boolean;
  readonly sent: number;
  readonly suppressed: number;
}

/** Where a message can be sent. Passed in, never imported: this is a client. */
export interface ChannelChoice {
  readonly value: string;
  readonly label: string;
}

/**
 * A workspace's own escalation ladder for one rule (§11, P6-G21b).
 *
 * **Every rung is submitted together, because a ladder is one value.** The
 * rungs must increase, so a field that saved on its own would refuse half the
 * ways of getting from one valid ladder to another: raising the coordinator
 * above the sponsor is a legal intermediate state of typing and an illegal
 * ladder to store.
 *
 * **Empty means the canon**, and the placeholder shows what the canon is. The
 * alternative, pre-filling §11's numbers, makes a workspace that never chose
 * anything look like one that chose exactly the default, and stores a copy
 * that would survive a change to §11.
 */
function LadderEditor({
  rule,
  pending,
  onSave,
}: {
  readonly rule: RuleRow;
  readonly pending: boolean;
  readonly onSave: (ladder: Record<string, number> | null) => void;
}) {
  const { t } = useTranslations();

  const ladder = rule.ladder;
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      (ladder?.rungs ?? []).map((rung) => [
        rung,
        ladder?.own?.[rung] === undefined ? "" : String(ladder.own[rung]),
      ]),
    ),
  );

  if (!ladder) {
    return null;
  }

  const filled = ladder.rungs.filter((rung) => draft[rung]?.trim() !== "");
  const partial = filled.length > 0 && filled.length < ladder.rungs.length;

  return (
    <div
      className="flex flex-col gap-1.5 rounded-md bg-raised px-2.5 py-2"
      data-testid={`ladder-${rule.key}`}
    >
      <span className="text-xs text-ink-3">
        {t("admin.nudges.ruleCards.thisRuleOwns11")} {ladder.governs.join(", ")}
        {t("admin.nudges.ruleCards.leaveEveryFieldEmpty")}
      </span>
      <div className="flex flex-wrap items-end gap-2.5">
        {ladder.rungs.map((rung) => (
          <label
            key={rung}
            className="flex flex-col gap-0.5 text-xs text-ink-3"
          >
            {rung}
            <input
              type="number"
              min={0}
              value={draft[rung] ?? ""}
              disabled={pending}
              placeholder={String(ladder.canon[rung] ?? "")}
              aria-label={`${rung} for ${rule.key}`}
              onChange={(event) =>
                setDraft((held) => ({ ...held, [rung]: event.target.value }))
              }
              className="w-20 rounded-md border border-line bg-bg px-2 py-1 text-xs text-ink"
            />
          </label>
        ))}
        <Button
          type="button"
          size="sm"
          disabled={pending || partial}
          data-testid={`save-ladder-${rule.key}`}
          onClick={() =>
            onSave(
              filled.length === 0
                ? null
                : Object.fromEntries(
                    ladder.rungs.map((rung) => [rung, Number(draft[rung])]),
                  ),
            )
          }
        >
          {filled.length === 0 ? "Use §11's" : "Save the ladder"}
        </Button>
      </div>
      {partial ? (
        <span className="text-xs text-warn">
          {t("admin.nudges.ruleCards.aLadderIsOne")}
        </span>
      ) : null}
    </div>
  );
}

function Rule({
  rule,
  channels,
}: {
  readonly rule: RuleRow;
  readonly channels: readonly ChannelChoice[];
}) {
  const { t } = useTranslations();

  const [pending, start] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);

  const change = (patch: Parameters<typeof setNudgeRuleAction>[0]) => {
    setProblem(null);
    start(async () => {
      const result = await setNudgeRuleAction(patch);
      setProblem(result.error);
    });
  };

  return (
    <div className="flex flex-col gap-1.5 border-line border-b py-2.5 last:border-0 last:pb-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2.5">
        <span className="flex min-w-0 flex-col">
          <span className="flex flex-wrap items-center gap-2">
            <code className="text-sm text-ink">{rule.key}</code>
            {rule.configured ? (
              <Chip tone="brand">{t("common.changed")}</Chip>
            ) : null}
            {rule.escalates ? (
              <Chip tone="neutral">
                {t("admin.nudges.ruleCards.escalates")}
              </Chip>
            ) : null}
            {rule.deterministic ? null : (
              <Chip tone="agent">{t("admin.nudges.ruleCards.needsAi")}</Chip>
            )}
          </span>
          <span className="text-xs text-ink-3">
            {rule.fires}. {rule.recipient}.
          </span>
        </span>
        <span className="flex flex-none items-center gap-2 text-xs text-ink-3">
          <span data-testid={`volume-${rule.key}`}>
            {rule.sent} {t("admin.nudges.ruleCards.sent")} {rule.suppressed}{" "}
            {t("common.held")}
          </span>
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          size="sm"
          variant={rule.enabled ? "default" : "primary"}
          disabled={pending}
          data-testid={`toggle-${rule.key}`}
          onClick={() => change({ ruleKey: rule.key, enabled: !rule.enabled })}
        >
          {rule.enabled ? "Turn off" : "Turn on"}
        </Button>

        <label className="flex items-center gap-1.5 text-xs text-ink-3">
          {t("admin.nudges.ruleCards.sendOn")}
          <select
            value={rule.channelOverride ?? ""}
            disabled={pending}
            aria-label={`Channel for ${rule.key}`}
            onChange={(event) =>
              change({
                ruleKey: rule.key,
                channelOverride:
                  event.target.value === ""
                    ? null
                    : (event.target.value as NonNullable<
                        Parameters<
                          typeof setNudgeRuleAction
                        >[0]["channelOverride"]
                      >),
              })
            }
            className="rounded-md border border-line bg-bg px-2 py-1 text-xs text-ink"
          >
            <option value="">
              {t("admin.nudges.ruleCards.eachMemberSOwn")}
            </option>
            {channels.map((channel) => (
              <option key={channel.value} value={channel.value}>
                {channel.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-1.5 text-xs text-ink-3">
          <input
            type="checkbox"
            checked={rule.quietModeExempt}
            disabled={pending}
            onChange={(event) =>
              change({
                ruleKey: rule.key,
                quietModeExempt: event.target.checked,
              })
            }
            className="size-3.5"
          />
          {t("admin.nudges.ruleCards.speaksThroughQuietMode")}
        </label>
      </div>

      <LadderEditor
        rule={rule}
        pending={pending}
        onSave={(ladder) =>
          change({ ruleKey: rule.key, escalationLadder: ladder })
        }
      />

      {rule.enabled ? null : (
        <span className="text-xs text-warn">
          {t("admin.nudges.ruleCards.heldTheRunStill")}
        </span>
      )}

      {problem ? (
        <span role="alert" className="text-xs text-bad">
          {problem}
        </span>
      ) : null}
    </div>
  );
}

export function NudgeRuleCards({
  rules,
  quietMode,
  channels,
}: {
  readonly rules: readonly RuleRow[];
  readonly quietMode: boolean;
  readonly channels: readonly ChannelChoice[];
}) {
  const { t } = useTranslations();

  const [pending, start] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4.5">
      <Card>
        <CardHeader className="justify-between">
          <div className="flex min-w-0 flex-col">
            <h2 className="font-semibold text-ink">
              {t("admin.nudges.ruleCards.workspaceQuietMode")}
            </h2>
            <p className="text-sm text-ink-3">
              {t("admin.nudges.ruleCards.holdsEveryRuleThat")}
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant={quietMode ? "primary" : "default"}
            disabled={pending}
            data-testid="quiet-mode"
            onClick={() => {
              setProblem(null);
              start(async () => {
                const result = await setQuietModeAction(!quietMode);
                setProblem(result.error);
              });
            }}
          >
            {quietMode ? "Quiet mode is on" : "Turn quiet mode on"}
          </Button>
        </CardHeader>
        {problem ? (
          <CardBody>
            <p role="alert" className="text-xs text-bad">
              {problem}
            </p>
          </CardBody>
        ) : null}
      </Card>

      <Card>
        <CardHeader>
          <div className="flex min-w-0 flex-col">
            <h2 className="font-semibold text-ink">
              {t("admin.nudges.ruleCards.rules")}
              {rules.length})
            </h2>
            <p className="text-sm text-ink-3">
              {t("admin.nudges.ruleCards.everyTriggerMethodMd")}
            </p>
          </div>
        </CardHeader>
        <CardBody className="flex flex-col">
          {rules.map((rule) => (
            <Rule key={rule.key} rule={rule} channels={channels} />
          ))}
        </CardBody>
      </Card>
    </div>
  );
}
