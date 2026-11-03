import { ACCESS_LEVELS, callAction } from "@openokr/core";
import {
  compareProfiles,
  methodSectionAnchor,
  PRACTICE_KEYS,
  PROFILE_KEYS,
  practiceSettingName,
  switchProfile,
} from "@openokr/method";
import { resolveAccessLevelFor } from "../../../lib/access";
import { methodDocumentUrl } from "../../../lib/app-version";
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
 *
 * **The comparison of all five is `compareProfiles`**, the function
 * `method:check` holds METHOD.md §12.3 to, so this screen and the document
 * show the same table. It and the setting names are worked out here rather
 * than in the browser, which would otherwise download every check's catalogue
 * to read one title from each.
 *
 * **Every name the method defines explains itself in place**: a hover on each
 * setting, profile and comparison row says what it decides and links to the
 * exact METHOD.md section, so nobody has to open the document to read the
 * screen. The links are one map from section to address, worked out here.
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
  const settingNames = Object.fromEntries(
    PRACTICE_KEYS.map((key) => [key, practiceSettingName(key)]),
  );
  const comparison = compareProfiles();
  const sectionLink = (section: string) =>
    methodDocumentUrl(methodSectionAnchor(section) ?? undefined);
  const methodLinks = Object.fromEntries(
    [
      "12",
      "12.2",
      "12.3",
      ...practice.registry.map((entry) => entry.section),
      ...comparison.map((row) => row.section),
    ].map((section) => [section, sectionLink(section)]),
  );

  return (
    <>
      <h1 className="text-lg font-bold text-ink">
        {t("admin.practice.title")}
      </h1>
      <p className="text-sm text-ink-3">
        {t("admin.practice.intro")}{" "}
        <a
          href={methodLinks["12"]}
          target="_blank"
          rel="noreferrer"
          data-testid="practice-method-link"
          className="font-semibold text-brand-text underline"
        >
          {t("admin.practice.readMethod")}
          <span className="sr-only"> {t("admin.practice.opensInNewTab")}</span>
        </a>
      </p>
      <PracticeForm
        practice={practice}
        previews={previews}
        thresholdLabels={thresholdLabels}
        settingNames={settingNames}
        comparison={comparison}
        methodLinks={methodLinks}
        canManage={level >= ACCESS_LEVELS.full}
      />
    </>
  );
}
