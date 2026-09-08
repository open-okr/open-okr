"use client";

import { Button, Card, CardBody, CardHeader, Chip } from "@openokr/ui";
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
  readonly configured: boolean;
  readonly sent: number;
  readonly suppressed: number;
}

/** Where a message can be sent. Passed in, never imported: this is a client. */
export interface ChannelChoice {
  readonly value: string;
  readonly label: string;
}

function Rule({
  rule,
  channels,
}: {
  readonly rule: RuleRow;
  readonly channels: readonly ChannelChoice[];
}) {
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
            {rule.configured ? <Chip tone="brand">changed</Chip> : null}
            {rule.escalates ? <Chip tone="neutral">escalates</Chip> : null}
            {rule.deterministic ? null : <Chip tone="agent">needs AI</Chip>}
          </span>
          <span className="text-xs text-ink-3">
            {rule.fires}. {rule.recipient}.
          </span>
        </span>
        <span className="flex flex-none items-center gap-2 text-xs text-ink-3">
          <span data-testid={`volume-${rule.key}`}>
            {rule.sent} sent, {rule.suppressed} held
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
          Send on
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
            <option value="">each member&apos;s own channel</option>
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
          Speaks through quiet mode
        </label>
      </div>

      {rule.enabled ? null : (
        <span className="text-xs text-warn">
          Held. The run still records each one with its reason, so this page
          keeps saying what the product decided.
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
  const [pending, start] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4.5">
      <Card>
        <CardHeader className="justify-between">
          <div className="flex min-w-0 flex-col">
            <h2 className="font-semibold text-ink">Workspace quiet mode</h2>
            <p className="text-sm text-ink-3">
              Holds every rule that is not exempt. METHOD.md §6.3 puts an
              escalation through regardless, because the ladder widening past
              the person who owns the work is the case quiet mode is not for.
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
            <h2 className="font-semibold text-ink">Rules ({rules.length})</h2>
            <p className="text-sm text-ink-3">
              Every trigger METHOD.md §6.4 defines, with what this workspace has
              decided about it and what it sent in the last seven days. A rule
              nobody has touched follows the canon, and the absence of a stored
              row is what says so.
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
