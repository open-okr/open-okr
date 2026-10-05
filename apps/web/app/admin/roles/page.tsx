import { callAction } from "@openokr/core";
import { ROLE_DOMAINS } from "@openokr/db";
import { Card, CardBody, CardHeader } from "@openokr/ui";
import { getPool } from "../../../lib/pool";
import { getTranslations } from "../../../lib/translations";
import { requireWorkspace } from "../../../lib/workspace";
import { MemberRoles } from "./member-roles.tsx";
import { RoleMatrix } from "./role-matrix.tsx";

/**
 * Roles and what each one may do (P8-G13b,
 * docs/design/p8-g13-workspace-roles.md).
 *
 * **Who may edit an objective used to be answerable only by reading the
 * binding table.** It came from membership of the space that owned it, through
 * one `space_standard` binding at level 70, which no screen showed and which
 * could only be changed by moving people between spaces. P8-G13a put that
 * question in a matrix; this is where somebody reads and changes it.
 *
 * **Two cards, because they are two questions.** The matrix says what each
 * role may do. The list below says who holds which role. An administrator
 * arrives with one or the other and never with both at once.
 *
 * **A role raises a level and never lowers one**, which the page says in the
 * open rather than leaving somebody to discover it. Lowering Member on
 * objectives does not take away the edit a champion holds on their own
 * objective, because `can()` takes the maximum over the bindings reaching
 * somebody and the level their role grants. There is no deny rule, and §4.1
 * has never had one.
 */
export default async function RolesPage() {
  const { t } = await getTranslations();
  const { session, workspace } = await requireWorkspace();
  const context = {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };

  const { roles } = await callAction(context, "roles.list", {});
  const members = await callAction(context, "people.directory", {});

  return (
    <div className="flex flex-col gap-4.5">
      <Card>
        <CardHeader className="flex-col items-stretch gap-1">
          <h1 className="text-sm font-bold text-ink">
            {t("admin.roles.title")}
          </h1>
          <p className="text-xs text-ink-3">{t("admin.roles.explains")}</p>
        </CardHeader>
        <CardBody>
          <RoleMatrix roles={roles} domains={ROLE_DOMAINS} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="flex-col items-stretch gap-1">
          <h2 className="text-sm font-bold text-ink">
            {t("admin.roles.whoHoldsWhat")}
          </h2>
          <p className="text-xs text-ink-3">
            {t("admin.roles.guestsHoldNone")}
          </p>
        </CardHeader>
        <CardBody>
          <MemberRoles
            // A human only. A guest, an agent and a placeholder hold no role
            // by design, and offering to give one would be offering to undo
            // that.
            members={members
              .filter((member) => member.kind === "human")
              .map((member) => ({
                id: member.id,
                name: member.name,
                roleId: member.roleId,
              }))}
            roles={roles.map((role) => ({ id: role.id, name: role.name }))}
          />
        </CardBody>
      </Card>
    </div>
  );
}
