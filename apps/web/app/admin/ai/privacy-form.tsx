"use client";

import {
  RefusedFields,
  SettingsSaveBar,
  TokenInput,
  useTranslations,
} from "@openokr/ui";
import { type ReactNode, useActionState, useEffect, useState } from "react";
import { savePrivacy } from "./actions.ts";
import { NOTHING_YET } from "./form-state.ts";

export interface PrivacyValues {
  readonly contextEgress: string;
  readonly redactPersonalData: boolean;
  readonly noTraining: boolean;
  readonly allowedHosts: readonly string[];
}

export interface PrivacyLevel {
  readonly value: string;
  readonly label: string;
  readonly help: string;
}

/**
 * The privacy controls on the 12-column grid with the card's footer save bar
 * (docs/design/settings-page-layout.md). The banners above the controls and
 * the notes below them arrive as children, already translated.
 *
 * **On a local provider the controls are greyed out and there is no bar.** The
 * footer's buttons sit outside the disabled fieldset, and a disabled field
 * posts nothing, so a save from there would write the defaults over what is
 * stored.
 */
export function PrivacyForm({
  initial,
  levels,
  local,
  maxHosts,
  banners,
  notes,
}: {
  readonly initial: PrivacyValues;
  readonly levels: readonly PrivacyLevel[];
  readonly local: boolean;
  readonly maxHosts: number;
  readonly banners: ReactNode;
  readonly notes: ReactNode;
}) {
  const { t } = useTranslations();
  const formId = "ai-privacy-form";
  const [state, formAction, pending] = useActionState(savePrivacy, NOTHING_YET);
  const [baseline, setBaseline] = useState(initial);
  const [level, setLevel] = useState(initial.contextEgress);
  const [redact, setRedact] = useState(initial.redactPersonalData);
  const [noTraining, setNoTraining] = useState(initial.noTraining);
  const [hosts, setHosts] = useState<readonly string[]>(initial.allowedHosts);

  const hostsKey = hosts.join("\n");
  const changed: string[] = [];
  if (level !== baseline.contextEgress) {
    changed.push(t("admin.ai.privacy.contextLevel"));
  }
  if (redact !== baseline.redactPersonalData) {
    changed.push(t("admin.ai.privacy.redact"));
  }
  if (noTraining !== baseline.noTraining) {
    changed.push(t("admin.ai.privacy.noTraining"));
  }
  if (hostsKey !== baseline.allowedHosts.join("\n")) {
    changed.push(t("admin.ai.privacy.allowedHosts"));
  }

  // A save the server accepted is the new baseline, so the bar goes quiet.
  // Only a new answer from the server moves the baseline, so the values are
  // read at the moment it arrives.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    if (state !== NOTHING_YET && state.ok) {
      setBaseline({
        contextEgress: level,
        redactPersonalData: redact,
        noTraining,
        allowedHosts: hosts,
      });
    }
  }, [state]);

  return (
    <>
      <form
        id={formId}
        action={formAction}
        onReset={(event) => {
          event.preventDefault();
          setLevel(baseline.contextEgress);
          setRedact(baseline.redactPersonalData);
          setNoTraining(baseline.noTraining);
          setHosts(baseline.allowedHosts);
        }}
        aria-busy={pending}
        className="grid grid-cols-12 gap-x-6 gap-y-4 p-3.5"
      >
        <div className="col-span-12 flex flex-col gap-3 empty:hidden">
          {banners}
        </div>
        {/* Greyed out rather than hidden on a local provider: the settings
            are still stored and apply the moment a remote one is routed. */}
        <RefusedFields fields={state.fields}>
          <fieldset
            disabled={local}
            className="col-span-12 grid grid-cols-12 gap-x-6 gap-y-4 disabled:opacity-60"
          >
            <fieldset className="col-span-12 grid grid-cols-12 gap-x-6 gap-y-3">
              <legend className="col-span-12 mb-1 text-xs font-semibold text-ink-2">
                {t("admin.ai.privacy.contextLevel")}
              </legend>
              {levels.map((one) => (
                <label
                  key={one.value}
                  className="col-span-12 flex items-start gap-2 text-sm md:col-span-4"
                >
                  <input
                    type="radio"
                    name="contextEgress"
                    value={one.value}
                    checked={level === one.value}
                    onChange={() => setLevel(one.value)}
                    className="mt-0.5 size-4"
                  />
                  <span className="flex flex-col">
                    <span className="text-ink">{one.label}</span>
                    <span className="text-xs text-ink-3">{one.help}</span>
                  </span>
                </label>
              ))}
            </fieldset>

            <label className="col-span-12 flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                name="redactPersonalData"
                checked={redact}
                onChange={(event) => setRedact(event.target.checked)}
                className="mt-0.5 size-4"
              />
              <span className="flex flex-col">
                <span className="text-ink">{t("admin.ai.privacy.redact")}</span>
                <span className="text-xs text-ink-3">
                  {t("admin.ai.privacy.redactHelp")}
                </span>
              </span>
            </label>

            <label className="col-span-12 flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                name="noTraining"
                checked={noTraining}
                onChange={(event) => setNoTraining(event.target.checked)}
                className="mt-0.5 size-4"
              />
              <span className="flex flex-col">
                <span className="text-ink">
                  {t("admin.ai.privacy.noTraining")}
                </span>
                <span className="text-xs text-ink-3">
                  {t("admin.ai.privacy.noTrainingHelp")}
                </span>
              </span>
            </label>

            {/* A chip each, checked as it is made by the rule the action
              applies, a pasted address reduced to its host (§4.11). */}
            <TokenInput
              className="col-span-12"
              id="ai-privacy-hosts"
              label={t("admin.ai.privacy.allowedHosts")}
              name="allowedHosts"
              joiner={"\n"}
              rule="host"
              max={maxHosts}
              value={hosts}
              onValueChange={(entries) => setHosts(entries)}
              placeholder={t("admin.ai.privacy.allowedHostsPlaceholder")}
              description={t("admin.ai.privacy.allowedHostsHelp")}
            />
          </fieldset>
        </RefusedFields>
        <div className="col-span-12 flex flex-col gap-1.5 border-t border-line pt-3 text-xs text-ink-3">
          {notes}
        </div>
      </form>
      {local ? null : (
        <SettingsSaveBar
          mode="footer"
          formId={formId}
          unsaved={changed}
          saved={state.ok && state.message ? state.message : null}
          error={state.ok ? null : state.message || null}
          pending={pending}
        />
      )}
    </>
  );
}
