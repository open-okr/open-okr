import { ACCESS_LEVELS, callAction } from "@openokr/core";
import {
  ALIGNMENT_CHECKS,
  CYCLE_CHECKS,
  GATE_TITLES,
  KEY_RESULT_CHECKS,
  OBJECTIVE_CHECKS,
  PROFILE_KEYS,
  switchProfile,
} from "@openokr/method";
import { resolveAccessLevelFor } from "../../../lib/access";
import { getPool } from "../../../lib/auth";
import { getTranslations } from "../../../lib/translations";
import { requireWorkspace } from "../../../lib/workspace";
import { PracticeForm } from "./practice-form";

/**
 * The practice settings (UIUX-PLAN.md S-36, METHOD.md §12, P9-T05).
 *
 * Generated from the registry `practice.read` returns, the way the rhythm card
 * is generated from §11's, so a setting added to §12 next month appears here
 * with no change to this file.
 *
 * **What each profile would change is worked out here, before anything is
 * chosen**, by the same `switchProfile` the action runs. The preview and the
 * write cannot disagree, because they are one function.
 */
export default async function PracticeSettingsPage() {
  const { t } = await getTranslations();
  const { session, workspace } = await requireWorkspace();
  const context = {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };

  const [practice, rhythm, level] = await Promise.all([
    callAction(context, "practice.read", {}),
    callAction(context, "rhythm.read", {}),
    resolveAccessLevelFor(workspace.workspaceId, workspace.memberId),
  ]);

  const previews = Object.fromEntries(
    PROFILE_KEYS.filter((key) => key !== practice.profile).map((key) => [
      key,
      switchProfile(
        {
          profile: practice.profile,
          overrides: practice.overrides,
          thresholds: rhythm.thresholds as Record<string, unknown>,
        },
        key,
      ),
    ]),
  );
  const thresholdLabels = Object.fromEntries(
    rhythm.registry.map((entry) => [entry.key, entry.label]),
  );
  const checkTitles = Object.fromEntries(
    [
      ...OBJECTIVE_CHECKS,
      ...KEY_RESULT_CHECKS,
      ...ALIGNMENT_CHECKS,
      ...CYCLE_CHECKS,
    ].map((check) => [check.id, check.title]),
  );

  return (
    <>
      <h1 className="text-lg font-bold text-ink">
        {t("admin.practice.title")}
      </h1>
      <p className="text-sm text-ink-3">{t("admin.practice.intro")}</p>
      <PracticeForm
        practice={practice}
        previews={previews}
        thresholdLabels={thresholdLabels}
        checkTitles={checkTitles}
        gateTitles={[...GATE_TITLES]}
        canManage={level >= ACCESS_LEVELS.full}
      />
    </>
  );
}
