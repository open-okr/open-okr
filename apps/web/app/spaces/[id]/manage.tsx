import { Card, CardBody, CardHeader } from "@openokr/ui";
import {
  addSpaceMember,
  archiveSpace,
  removeSpaceMember,
  setSpaceMemberRole,
  updateSpace,
} from "../actions.ts";
import { SpaceForm } from "../space-form.tsx";

/**
 * Managing one space (TECHNICAL-PLAN §4.2, P6-G18a).
 *
 * **Six registered writes had no caller until this.** `spaces.create`,
 * `update`, `archive`, `addMember`, `setMemberRole` and `removeMember` all
 * shipped at P3-T01 and only `join` and `leave` were ever wired, so a workspace
 * was stuck with the one space provisioning made and its membership could only
 * be changed from the command line.
 *
 * **Three roles, and they are not a hierarchy of trust.** §4.2 gives a space a
 * member, a coordinator and a manager: a coordinator runs the weekly session, a
 * manager owns the space. The picker says what each one does rather than
 * listing three words somebody has to guess between.
 *
 * **Archiving keeps everything readable.** That is the action's own promise and
 * it is worth repeating on the button, because "archive" reads like "delete" to
 * anybody who has not been told otherwise.
 */

const ROLES = [
  {
    id: "member",
    label: "Member",
    hint: "Works in the space.",
  },
  {
    id: "coordinator",
    label: "Coordinator",
    hint: "Runs the weekly session.",
  },
  {
    id: "manager",
    label: "Manager",
    hint: "Owns the space, and covers the coordinator when there is none.",
  },
] as const;

export interface ManageMember {
  readonly memberId: string;
  readonly name: string;
  readonly role: string;
}

export function SpaceManagement({
  spaceId,
  name,
  mission,
  members,
  candidates,
  canManage,
  canArchive,
}: {
  readonly spaceId: string;
  readonly name: string;
  readonly mission: string | null;
  readonly members: readonly ManageMember[];
  /** Everyone in the workspace who is not already in this space. */
  readonly candidates: readonly { id: string; name: string }[];
  readonly canManage: boolean;
  readonly canArchive: boolean;
}) {
  if (!canManage) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex min-w-0 flex-col">
          <h2 className="text-sm font-bold text-ink">Manage this space</h2>
          <p className="text-xs text-ink-3">
            Its name, who is in it, and what each of them does here.
          </p>
        </div>
      </CardHeader>
      <CardBody className="flex flex-col gap-4">
        <SpaceForm action={updateSpace} className="flex flex-col gap-2">
          <input type="hidden" name="id" value={spaceId} />
          <label className="flex flex-col gap-1 text-xs text-ink-3">
            Name
            <input
              name="name"
              defaultValue={name}
              maxLength={80}
              className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-3">
            Mission
            <input
              name="mission"
              defaultValue={mission ?? ""}
              maxLength={280}
              placeholder="What this team is for, in one line"
              className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
            />
            <span className="text-ink-4">
              Leaving it empty clears it, which is a real answer.
            </span>
          </label>
          <button
            type="submit"
            className="self-start rounded-md bg-brand px-2.5 py-1.5 text-xs font-semibold text-on-brand"
          >
            Save
          </button>
        </SpaceForm>

        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-bold text-ink-2">Roles</h3>
          <ul className="flex flex-col gap-2">
            {members.map((member) => (
              <li
                key={member.memberId}
                className="flex flex-wrap items-center justify-between gap-2 border-line border-b pb-2 last:border-0 last:pb-0"
              >
                <span className="text-sm text-ink">{member.name}</span>
                <span className="flex items-center gap-2">
                  <SpaceForm
                    action={setSpaceMemberRole}
                    className="flex items-center gap-1.5"
                  >
                    <input type="hidden" name="spaceId" value={spaceId} />
                    <input
                      type="hidden"
                      name="memberId"
                      value={member.memberId}
                    />
                    <select
                      name="role"
                      defaultValue={member.role}
                      className="rounded-md border border-line bg-surface px-1.5 py-1 text-xs text-ink"
                    >
                      {ROLES.map((role) => (
                        <option key={role.id} value={role.id}>
                          {role.label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="submit"
                      className="rounded-md border border-line px-2 py-1 text-xs font-semibold text-ink-2"
                    >
                      Set
                    </button>
                  </SpaceForm>
                  <SpaceForm action={removeSpaceMember}>
                    <input type="hidden" name="spaceId" value={spaceId} />
                    <input
                      type="hidden"
                      name="memberId"
                      value={member.memberId}
                    />
                    <button
                      type="submit"
                      className="rounded-md border border-line px-2 py-1 text-xs font-semibold text-ink-3"
                    >
                      Remove
                    </button>
                  </SpaceForm>
                </span>
              </li>
            ))}
          </ul>
          <ul className="flex flex-col gap-0.5 text-xs text-ink-4">
            {ROLES.map((role) => (
              <li key={role.id}>
                <span className="font-semibold text-ink-3">{role.label}</span>:{" "}
                {role.hint}
              </li>
            ))}
          </ul>
        </div>

        {candidates.length > 0 ? (
          <SpaceForm
            action={addSpaceMember}
            className="flex flex-wrap items-end gap-2 rounded-md bg-raised p-2.5"
          >
            <input type="hidden" name="spaceId" value={spaceId} />
            <label className="flex flex-col gap-1 text-xs text-ink-3">
              Add somebody
              <select
                name="memberId"
                required
                className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
              >
                {candidates.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-ink-3">
              As
              <select
                name="role"
                defaultValue="member"
                className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
              >
                {ROLES.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              className="rounded-md bg-brand px-2.5 py-1.5 text-xs font-semibold text-on-brand"
            >
              Add
            </button>
          </SpaceForm>
        ) : (
          <p className="text-xs text-ink-4">
            Everybody in this workspace is already in this space.
          </p>
        )}

        {canArchive ? (
          <details className="rounded-md border border-line p-2.5">
            <summary className="cursor-pointer text-xs font-semibold text-ink-2">
              Archive this space
            </summary>
            <SpaceForm
              action={archiveSpace}
              className="mt-2 flex flex-col gap-1.5"
            >
              <input type="hidden" name="id" value={spaceId} />
              <p className="text-xs text-ink-3">
                Its goals, sessions and history stay readable. It stops
                appearing in the list and nothing new can be filed in it.
              </p>
              <button
                type="submit"
                className="self-start rounded-md border border-line px-2.5 py-1.5 text-xs font-semibold text-ink-2"
              >
                Archive
              </button>
            </SpaceForm>
          </details>
        ) : null}
      </CardBody>
    </Card>
  );
}
