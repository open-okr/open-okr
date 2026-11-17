"use client";

import type { ModelTier } from "@openokr/db";
/**
 * An agent's instructions on Admin, Agents (docs/design/agent-instructions.md
 * §2, plan 0.7.0 A7): the two stages with their history, and "Plan a run" for
 * a custom agent while a provider is configured. The Coach's and the
 * Champion's are shown read-only: they follow the method (I8).
 */
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  SettingsSaveBar,
  TextArea,
  useTranslations,
} from "@openokr/ui";
import { useActionState, useEffect, useState, useTransition } from "react";
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
    <div
      className="flex flex-col gap-4"
      data-testid={`agent-instructions-${agentId}`}
    >
      <div className="flex flex-col gap-1">
        <h3 className="text-xs font-semibold tracking-wide text-ink-4 uppercase">
          {t("admin.agents.instructions.heading", { name: agentName })}
        </h3>
        {editable ? null : (
          <p className="max-w-prose text-xs text-ink-3">
            {t("admin.agents.instructions.followsTheMethod", {
              name: agentName,
            })}
          </p>
        )}
      </div>
      {stages.map((one) => (
        <StageCard
          key={one.stage}
          agentId={agentId}
          agentName={agentName}
          stage={one.stage}
          inUse={one.stage === currentStage}
          history={one.history}
          editable={editable}
        />
      ))}
      {canPlan ? (
        <PlanRun agentId={agentId} agentName={agentName} tier={tier} />
      ) : null}
    </div>
  );
}

function StageCard({
  agentId,
  agentName,
  stage,
  inUse,
  history,
  editable,
}: {
  readonly agentId: string;
  readonly agentName: string;
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
  const stored = newest?.text ?? "";
  const [value, setValue] = useState(stored);
  const [baseline, setBaseline] = useState(stored);
  const formId = `agent-instructions-form-${agentId}-${stage}`;
  const label =
    stage === "planning"
      ? t("admin.agents.instructions.whilePlanning")
      : t("admin.agents.instructions.whileRunning");

  // What the server stores is the new baseline, after a save or a restore.
  useEffect(() => {
    setValue(stored);
    setBaseline(stored);
  }, [stored]);

  return (
    <Card data-testid={`agent-stage-${agentId}-${stage}`}>
      <CardHeader>
        <div className="flex min-w-0 flex-col">
          <h4 className="flex flex-wrap items-center gap-2 text-sm font-bold text-ink">
            {label}
            {inUse ? (
              <Chip tone="brand">
                {t("admin.agents.instructions.inUseNow")}
              </Chip>
            ) : null}
          </h4>
          <p className="text-xs text-ink-3">
            {t("admin.agents.instructions.stageAbout", { name: agentName })}
          </p>
        </div>
      </CardHeader>
      {editable ? (
        <form
          id={formId}
          action={formAction}
          onReset={(event) => {
            event.preventDefault();
            setValue(baseline);
          }}
          aria-busy={pending}
          className="grid grid-cols-12 gap-x-6 gap-y-4 p-3.5"
        >
          <input type="hidden" name="agentId" value={agentId} />
          <input type="hidden" name="stage" value={stage} />
          <TextArea
            className="col-span-12"
            label={label}
            hideLabel
            name="text"
            rows={3}
            maxLength={4000}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            error={state.fields?.text}
          />
        </form>
      ) : (
        <CardBody>
          <p className="whitespace-pre-wrap text-xs text-ink-2">
            {newest?.text || t("admin.agents.instructions.none")}
          </p>
        </CardBody>
      )}
      {history.length > 1 ? (
        <div className="border-t border-line p-3.5">
          <ol
            aria-label={t("admin.agents.instructions.history", {
              stage: label,
            })}
            // biome-ignore lint/a11y/noNoninteractiveTabindex: a list that scrolls has to be reachable from the keyboard.
            tabIndex={0}
            className="flex max-h-[296px] flex-col gap-1 overflow-y-auto"
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
        </div>
      ) : null}
      {restoreError ? (
        <p role="alert" className="px-3.5 pb-3 text-xs text-bad">
          {restoreError}
        </p>
      ) : null}
      {editable ? (
        <SettingsSaveBar
          mode="footer"
          formId={formId}
          unsaved={value === baseline ? [] : [label]}
          saved={
            state.saved
              ? t("admin.agents.instructions.savedAs", {
                  version: state.saved,
                })
              : null
          }
          error={
            state.error ??
            (state.fields?.text
              ? t("admin.agents.instructions.nothingSaved")
              : null)
          }
          pending={pending}
          saveLabel={t("admin.agents.instructions.save")}
        />
      ) : null}
    </Card>
  );
}

function PlanRun({
  agentId,
  agentName,
  tier,
}: {
  readonly agentId: string;
  readonly agentName: string;
  readonly tier: ModelTier | null;
}) {
  const { t } = useTranslations();
  const [planning, startPlanning] = useTransition();
  const [starting, startStarting] = useTransition();
  const [answer, setAnswer] = useState<PlanAnswer | null>(null);
  const [started, setStarted] = useState<string | null>(null);

  return (
    <Card data-testid={`agent-plan-${agentId}`}>
      <CardHeader className="justify-between">
        <div className="flex min-w-0 flex-col">
          <h4 className="text-sm font-bold text-ink">
            {t("admin.agents.instructions.planARun")}
          </h4>
          <p className="text-xs text-ink-3">
            {t("admin.agents.instructions.planARunAbout", { name: agentName })}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="ai"
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
      </CardHeader>
      {answer === null && started === null ? null : (
        <CardBody className="flex flex-col gap-2">
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
        </CardBody>
      )}
    </Card>
  );
}
