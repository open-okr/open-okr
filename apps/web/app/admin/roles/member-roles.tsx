"use client";

import { useTranslations } from "@openokr/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { assignRoleAction } from "./actions.ts";

/**
 * Who holds which role (P8-G13b).
 *
 * One line per person and a choice beside each. The alternative, a people
 * screen with a role column, answers "what is this person" well and "who are
 * my administrators" badly, and the second is the question somebody opens
 * this card with.
 *
 * **"No role" is offered and is a real answer.** A member with none holds
 * exactly what their bindings give them, which is what every member held
 * before roles existed. Taking a role away is therefore a narrowing somebody
 * may genuinely want, not a broken state.
 */
export function MemberRoles({
  members,
  roles,
}: {
  readonly members: readonly {
    readonly id: string;
    readonly name: string;
    readonly roleId: string | null;
  }[];
  readonly roles: readonly { readonly id: string; readonly name: string }[];
}) {
  const { t } = useTranslations();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);

  const assign = (memberId: string, roleId: string | null) => {
    setProblem(null);
    start(async () => {
      const result = await assignRoleAction({ memberId, roleId });
      if (result.error) {
        setProblem(result.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-2.5">
      {problem ? (
        <p role="alert" className="text-xs text-bad">
          {problem}
        </p>
      ) : null}

      <ul className="flex flex-col divide-y divide-line">
        {members.map((member) => (
          <li
            key={member.id}
            className="flex flex-wrap items-center justify-between gap-2 py-2"
          >
            <span className="min-w-0 text-sm text-ink">{member.name}</span>
            <select
              value={member.roleId ?? ""}
              aria-label={t("admin.roles.roleFor", { name: member.name })}
              disabled={pending}
              onChange={(event) =>
                assign(member.id, event.target.value || null)
              }
              className="h-7 w-48 rounded-control border border-line-2 bg-surface px-1.5 text-xs text-ink outline-none focus:border-brand"
            >
              <option value="">{t("admin.roles.noRole")}</option>
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
          </li>
        ))}
      </ul>
    </div>
  );
}
