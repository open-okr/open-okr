import { ACCESS_LEVELS, callAction } from "@openokr/core";
import { Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import { resolveAccessLevelFor } from "../../../lib/access";
import { resolveLocale } from "../../../lib/locale";
import { getPool } from "../../../lib/pool";
import { getTranslations } from "../../../lib/translations";
import { requireWorkspace } from "../../../lib/workspace";
import { RestoreButton } from "./restore-button";

/**
 * Deleted items (screen S-36, completeness review M-13).
 *
 * **The delete control said an administrator could bring a thing back, and
 * there was nowhere to do it.** Goals, initiatives, tasks and documents are
 * soft-deleted, so nothing was ever lost, but no action restored one and no
 * screen listed them. The undo a delete now offers covers the six seconds
 * after it; this covers every day after that.
 *
 * **The list is only what this reader could restore.** Each row is checked at
 * the level its own restore asks, which is the level its delete asked, so an
 * administrator does not see a goal they are not the champion of. A Restore
 * here can still be refused for one reason, and it says which: the thing it
 * belongs to is deleted too, and has to come back first.
 */

const KIND_LABEL = {
  goal: "admin.deleted.kindGoal",
  initiative: "admin.deleted.kindInitiative",
  task: "admin.deleted.kindTask",
  document: "admin.deleted.kindDocument",
} as const;

export default async function DeletedItemsPage() {
  const { t } = await getTranslations();

  const { session, workspace } = await requireWorkspace();
  const level = await resolveAccessLevelFor(
    workspace.workspaceId,
    workspace.memberId,
  );

  // The layout already refuses below `full`. Checked again here because a
  // hidden control is cosmetic and this page names who deleted what.
  if (level < ACCESS_LEVELS.full) {
    return (
      <>
        <h1 className="mb-4 text-lg font-bold text-ink">
          {t("admin.deleted.title")}
        </h1>
        <Card>
          <CardBody>
            <p className="text-sm text-ink-3">
              {t("admin.deleted.onlyAnAdministrator")}
            </p>
          </CardBody>
        </Card>
      </>
    );
  }

  const { items } = await callAction(
    {
      pool: getPool(),
      workspaceId: workspace.workspaceId,
      actor: { kind: "human" as const, userId: session.user.id },
    },
    "workspace.deletedItems",
    {},
  );

  const locale = await resolveLocale();
  const when = new Intl.DateTimeFormat(locale === "ms" ? "ms-MY" : "en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <>
      <h1 className="mb-4 text-lg font-bold text-ink">
        {t("admin.deleted.title")}
      </h1>
      <Card>
        <CardHeader>
          <div className="flex min-w-0 flex-col">
            <h2 className="text-sm font-bold text-ink">
              {t("admin.deleted.whatCanComeBack")}
            </h2>
            <p className="text-xs text-ink-3">{t("admin.deleted.intro")}</p>
          </div>
        </CardHeader>
        <CardBody>
          {items.length === 0 ? (
            <p className="text-sm text-ink-3" data-testid="deleted-empty">
              {t("admin.deleted.nothingDeleted")}
            </p>
          ) : (
            <ul className="flex flex-col gap-2" data-testid="deleted-items">
              {items.map((item) => {
                const at = when.format(new Date(item.deletedAt));
                return (
                  <li
                    key={`${item.subjectType}-${item.id}`}
                    data-testid="deleted-item"
                    className="flex flex-wrap items-start justify-between gap-2.5 border-line border-b pb-2 last:border-0 last:pb-0"
                  >
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <div className="flex min-w-0 items-center gap-2">
                        <Chip>{t(KIND_LABEL[item.subjectType])}</Chip>
                        <span className="truncate text-sm text-ink">
                          {item.title}
                        </span>
                      </div>
                      <span className="text-xs text-ink-4">
                        {item.deletedBy
                          ? t("admin.deleted.deletedByOn", {
                              name: item.deletedBy,
                              date: at,
                            })
                          : t("admin.deleted.deletedOn", { date: at })}
                      </span>
                    </div>
                    <RestoreButton
                      subject={item.subjectType}
                      id={item.id}
                      title={item.title}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>
    </>
  );
}
