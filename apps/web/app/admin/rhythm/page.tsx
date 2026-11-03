import { ACCESS_LEVELS, callAction } from "@openokr/core";
import {
  METHOD_SECTIONS,
  methodSectionAnchor,
  OPERATING_PRINCIPLES,
  principlesCited,
} from "@openokr/method";
import { resolveAccessLevelFor } from "../../../lib/access";
import { methodDocumentUrl } from "../../../lib/app-version";
import { getPool } from "../../../lib/auth";
import { getTranslations } from "../../../lib/translations";
import { requireWorkspace } from "../../../lib/workspace";
import { RhythmForm } from "./rhythm-form";

/**
 * The rhythm and thresholds card (UIUX-PLAN.md §4 S-36, TECHNICAL-PLAN §4.14,
 * METHOD.md §11, P3-T02).
 *
 * §11's registry, rendered from the registry itself rather than from a hand-kept
 * list of fields. Every parameter shows what this workspace resolves it to, what
 * the canon says, which METHOD.md section defines it and why that default is the
 * one shipped, because an admin about to change a threshold should be able to
 * read the argument for leaving it alone.
 *
 * **Each threshold's hint is worked out here**: the principles its reason
 * cites by number, each with its title, the part of the method it comes from,
 * and a link to that section. A reason that says "(principle 5)" otherwise
 * sends the reader to a document they do not have open.
 */
export default async function RhythmSettingsPage() {
  const { t } = await getTranslations();

  const { session, workspace } = await requireWorkspace();

  const rhythm = await callAction(
    {
      pool: getPool(),
      workspaceId: workspace.workspaceId,
      actor: { kind: "human", userId: session.user.id },
    },
    "rhythm.read",
    {},
  );

  // `rhythm.update` requires `full`, which is what `manage_coaching` grants.
  // Read here for the form's state; the server refuses regardless.
  const level = await resolveAccessLevelFor(
    workspace.workspaceId,
    workspace.memberId,
  );

  const hints = Object.fromEntries(
    rhythm.registry.map((entry) => {
      const cited = entry.section.split(",")[0]?.trim() ?? "";
      return [
        entry.key,
        {
          why: entry.why,
          section: METHOD_SECTIONS[cited] ?? null,
          href: methodDocumentUrl(methodSectionAnchor(cited) ?? undefined),
          principles: principlesCited(entry.why).flatMap((number) =>
            OPERATING_PRINCIPLES.filter(
              (principle) => principle.number === number,
            ),
          ),
        },
      ];
    }),
  );
  // The two thresholds with a column of their own are the check-in card's
  // dropdowns, named by their fields there. Handed over under those names so
  // the form itself never writes a threshold key.
  const checkInHints = {
    defaultCheckInFrequency: hints["cadence.checkInFrequency"],
    checkInAnchorDay: hints["cadence.anchorDay"],
  };

  return (
    <>
      <h1 className="text-lg font-bold text-ink">
        {t("admin.rhythm.rhythmAndThresholds")}
      </h1>
      <p className="text-sm text-ink-3">
        {t("admin.rhythm.everyNumberTheMethod")}
      </p>
      <RhythmForm
        rhythm={rhythm}
        hints={hints}
        checkInHints={checkInHints}
        canManage={level >= ACCESS_LEVELS.full}
      />
    </>
  );
}
