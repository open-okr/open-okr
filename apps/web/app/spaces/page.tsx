import { ACCESS_LEVELS, callAction } from "@openokr/core";
import { Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import Link from "next/link";
import { resolveAccessLevelFor } from "../../lib/access";
import { getPool } from "../../lib/auth";
import { getTranslations } from "../../lib/translations";
import { requireWorkspace } from "../../lib/workspace";
import { createSpace } from "./actions.ts";
import { SpaceForm } from "./space-form.tsx";

/**
 * The space list (TECHNICAL-PLAN §4.2, P3-T01).
 *
 * The shell for team homes, not the home itself: S-01's Work Map and the goal
 * surfaces are what a space page eventually holds, and both are later tasks.
 * What this proves now is that the access model reaches spaces correctly, which
 * is what P3-T01 is actually for. Every space a member can see is here, with
 * their own role in it, or a join action when they have none.
 *
 * Everything shown comes from one registry action. The page runs no query.
 */
export default async function SpacesPage() {
  const { t } = await getTranslations();

  const { session, workspace } = await requireWorkspace();

  const context = {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };
  const spaces = await callAction(context, "spaces.list", {});

  // Creating a space is a workspace administrator's call, the same level the
  // action declares. Below it the form is not drawn, and the action refuses
  // anyway: a hidden control is cosmetic.
  const level = await resolveAccessLevelFor(
    workspace.workspaceId,
    workspace.memberId,
  );
  const canCreate = level >= ACCESS_LEVELS.full;
  const members = canCreate
    ? await callAction(context, "people.directory", {})
    : [];

  return (
    <div className="stagger flex flex-col gap-4.5">
      <Card>
        <CardHeader>
          <h1 className="text-lg font-bold text-ink">{t("spaces.spaces")}</h1>
          <p className="text-sm text-ink-3">
            {t("spaces.teamHomesEverySpace")}
          </p>
        </CardHeader>
        <CardBody className="flex flex-col gap-3">
          {spaces.length === 0 ? (
            <p className="text-sm text-ink-3">
              {t("spaces.noSpacesYetProvisioning")}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {spaces.map((space) => (
                <li key={space.id}>
                  <Link
                    href={`/spaces/${space.id}`}
                    className="flex items-center justify-between gap-3 rounded-md px-3 py-2 hover:bg-bg-2"
                  >
                    <span className="flex flex-col">
                      <span className="font-medium text-ink">{space.name}</span>
                      {space.mission ? (
                        <span className="text-sm text-ink-3">
                          {space.mission}
                        </span>
                      ) : null}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="tabular text-sm text-ink-3">
                        {space.memberCount}{" "}
                        {space.memberCount === 1 ? "member" : "members"}
                      </span>
                      {space.ownRole ? (
                        <Chip tone="brand">{space.ownRole}</Chip>
                      ) : (
                        <Chip tone="neutral">{t("spaces.notAMember")}</Chip>
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {canCreate ? (
        <Card>
          <CardHeader>
            <div className="flex min-w-0 flex-col">
              <h2 className="text-sm font-bold text-ink">
                {t("spaces.createASpace")}
              </h2>
              <p className="text-xs text-ink-3">{t("spaces.aTeamHomeIts")}</p>
            </div>
          </CardHeader>
          <CardBody>
            <SpaceForm action={createSpace} className="flex flex-col gap-2">
              <label className="flex flex-col gap-1 text-xs text-ink-3">
                {t("common.name")}
                <input
                  name="name"
                  required
                  maxLength={80}
                  placeholder={t("spaces.productSalesPlatform")}
                  className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-ink-3">
                {t("common.mission")}
                <input
                  name="mission"
                  maxLength={280}
                  placeholder={t("common.whatThisTeamIs")}
                  className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-ink-3">
                {t("common.manager")}
                <select
                  name="managerMemberId"
                  className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                >
                  <option value="">{t("spaces.nobodyYet")}</option>
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="submit"
                className="self-start rounded-md bg-brand px-2.5 py-1.5 text-xs font-semibold text-on-brand"
              >
                {t("spaces.createTheSpace")}
              </button>
            </SpaceForm>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
