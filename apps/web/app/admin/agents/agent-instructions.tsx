"use client";

import type { ModelTier } from "@openokr/db";
/**
 * An agent's instructions on Admin, Agents (docs/design/agent-instructions.md
 * §2, plan 0.7.0 A7): the two stages with their history, and "Plan a run" for
 * a custom agent while a provider is configured. The Coach's and the
 * Champion's are shown read-only: they follow the method (I8).
 */
import { Button, Chip, TextArea, useTranslations } from "@openokr/ui";
import { useActionState, useState, useTransition } from "react";
import {
  type InstructionsState,
  type PlanAnswer,
  planRunAction,
  restoreInstructionsAction,
  saveInstructionsAction,
  startPlannedRunAction,
} from "./instruction-actions";

type Stage = "planning" | "execution";

interface Version {
  readonly version: number;
  readonly text: string;
  readonly savedBy: string | null;
  readonly savedAt: string | null;
}

export function AgentInstructions({
  agentId,
  agentName,
  editable,
  currentStage,
  stages,
  canPlan,
  tier,
}: {
  readonly agentId: string;
  readonly agentName: string;
  readonly editable: boolean;
  readonly currentStage: Stage;
  readonly stages: readonly {
    readonly stage: Stage;
    readonly history: readonly Version[];
  }[];
  /** A custom agent, switched on, with a provider configured (I9). */
  readonly canPlan: boolean;
  readonly tier: ModelTier | null;
}) {
  const { t } = useTranslations();
  return (
    <details className="text-sm" data-testid={`agent-instructions-${agentId}`}>
      <summary className="cursor-pointer text-xs font-semibold text-ink-2">
        {t("admin.agents.instructions.heading", { name: agentName })}
      </summary>
      <div className="mt-2 flex flex-col gap-3">
        {editable ? null : (
          <p className="text-xs text-ink-3">
            {t("admin.agents.instructions.followsTheMethod", {
              name: agentName,
            })}
          </p>
        )}
        {stages.map((one) => (
          <StageCard
            key={one.stage}
            agentId={agentId}
            stage={one.stage}
            inUse={one.stage === currentStage}
            history={one.history}
            editable={editable}
          />
        ))}
        {canPlan ? <PlanRun agentId={agentId} tier={tier} /> : null}
      </div>
    </details>
  );
}

function StageCard({
  agentId,
  stage,
  inUse,
  history,
  editable,
}: {
  readonly agentId: string;
  readonly stage: Stage;
  readonly inUse: boolean;
  readonly history: readonly Version[];
  readonly editable: boolean;
}) {
  const { t } = useTranslations();
  const [state, formAction, pending] = useActionState<
    InstructionsState,
    FormData
  >(saveInstructionsAction, {});
  const [restoring, startRestore] = useTransition();
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const newest = history[0];
  const label =
    stage === "planning"
      ? t("admin.agents.instructions.whilePlanning")
      : t("admin.agents.instructions.whileRunning");

  return (
    <section className="flex flex-col gap-1.5 rounded-md border border-line p-2.5">
      <h3 className="flex items-center gap-2 text-xs font-bold text-ink">
        {label}
        {inUse ? (
          <Chip tone="brand">{t("admin.agents.instructions.inUseNow")}</Chip>
        ) : null}
      </h3>
      {editable ? (
        <form action={formAction} className="flex flex-col gap-1.5">
          <input type="hidden" name="agentId" value={agentId} />
          <input type="hidden" name="stage" value={stage} />
          <TextArea
            label={label}
            hideLabel
            name="text"
            rows={3}
            maxLength={4000}
            defaultValue={newest?.text ?? ""}
            error={state.fields?.text}
          />
          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" pending={pending}>
              {t("admin.agents.instructions.save")}
            </Button>
            {state.saved ? (
              <span role="status" className="text-xs text-ok">
                {t("admin.agents.instructions.savedAs", {
                  version: state.saved,
                })}
              </span>
            ) : null}
            {state.error ? (
              <span role="alert" className="text-xs text-bad">
                {state.error}
              </span>
            ) : null}
          </div>
        </form>
      ) : (
        <p className="whitespace-pre-wrap text-xs text-ink-2">
          {newest?.text || t("admin.agents.instructions.none")}
        </p>
      )}
      {history.length > 1 ? (
        <ol
          aria-label={t("admin.agents.instructions.history", { stage: label })}
          className="flex flex-col gap-1"
        >
          {history.map((version, index) => (
            <li
              key={version.version}
              className="flex flex-wrap items-center gap-2 text-xs text-ink-3"
            >
              <span>
                {version.version === 0
                  ? t("admin.agents.instructions.original")
                  : t("admin.agents.instructions.versionBy", {
                      version: version.version,
                      name: version.savedBy ?? "",
                    })}
              </span>
              {editable && index > 0 ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  pending={restoring}
                  onClick={() =>
                    startRestore(async () => {
                      const result = await restoreInstructionsAction({
                        agentId,
                        stage,
                        version: version.version,
                      });
                      setRestoreError(result.error);
                    })
                  }
                >
                  {t("admin.agents.instructions.restore", {
                    version: version.version,
                  })}
                </Button>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
      {restoreError ? (
        <p role="alert" className="text-xs text-bad">
          {restoreError}
        </p>
      ) : null}
    </section>
  );
}

function PlanRun({
  agentId,
  tier,
}: {
  readonly agentId: string;
  readonly tier: ModelTier | null;
}) {
  const { t } = useTranslations();
  const [planning, startPlanning] = useTransition();
  const [starting, startStarting] = useTransition();
  const [answer, setAnswer] = useState<PlanAnswer | null>(null);
  const [started, setStarted] = useState<string | null>(null);

  return (
    <section className="flex flex-col gap-1.5">
      <Button
        type="button"
        size="sm"
        variant="ai"
        className="self-start"
        pending={planning}
        onClick={() =>
          startPlanning(async () => {
            setStarted(null);
            setAnswer(await planRunAction(agentId, tier));
          })
        }
      >
        {t("admin.agents.instructions.planARun")}
      </Button>
      {answer?.kind === "refused" ? (
        <p role="alert" className="text-xs text-bad">
          {answer.reason}
        </p>
      ) : null}
      {answer?.kind === "planned" ? (
        answer.tasks.length === 0 ? (
          <p className="text-xs text-ink-3">
            {t("admin.agents.instructions.nothingToDo")}
          </p>
        ) : (
          <>
            <ol
              aria-label={t("admin.agents.instructions.theProposedRun")}
              className="flex list-decimal flex-col gap-1 pl-5 text-xs"
            >
              {answer.tasks.map((task, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: a plan's tasks have no ids and the list is drawn once, never reordered.
                <li key={`${task.action}-${index}`}>
                  <span className="font-mono text-ink">{task.action}</span>
                  {task.why ? (
                    <span className="text-ink-3"> {task.why}</span>
                  ) : null}
                </li>
              ))}
            </ol>
            <Button
              type="button"
              size="sm"
              className="self-start"
              pending={starting}
              onClick={() =>
                startStarting(async () => {
                  const result = await startPlannedRunAction(
                    agentId,
                    answer.tasks,
                  );
                  setStarted(
                    result.error ?? t("admin.agents.instructions.started"),
                  );
                  if (!result.error) {
                    setAnswer(null);
                  }
                })
              }
            >
              {t("admin.agents.instructions.startThisRun")}
            </Button>
          </>
        )
      ) : null}
      {started ? (
        <p role="status" className="text-xs text-ink-2">
          {started}
        </p>
      ) : null}
    </section>
  );
}
