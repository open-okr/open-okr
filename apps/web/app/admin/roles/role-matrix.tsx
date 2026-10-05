"use client";

import type { RoleDomain } from "@openokr/db";
import { Button, useTranslations } from "@openokr/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  createRoleAction,
  deleteRoleAction,
  setPermissionAction,
} from "./actions.ts";

/**
 * The permission matrix, and the controls that change it (P8-G13b).
 *
 * One row per role, one column per domain, and four choices in each cell.
 * Drawn as a grid rather than a form per role, because the question an
 * administrator arrives with is comparative: what may a Member do that a
 * Viewer may not. A form per role answers that only by remembering the last
 * one.
 *
 * **Owner is drawn, and drawn as fixed.** Hiding it would leave a reader
 * wondering where the most powerful role went; showing it without controls
 * says what it is and that it cannot be lowered. The reason is on the row
 * rather than in a document somebody has to find.
 *
 * **A level is a choice of four, not a number.** The §4.1 ladder is view 10,
 * comment 40, edit 70 and manage 100, plus nothing at all. An administrator
 * should never have to know those numbers, so the cell offers the words and
 * sends the number.
 */

/**
 * The domain names, written out in full.
 *
 * The catalogue gate looks for each key as a literal string, so a key
 * assembled at runtime reads as having no consumer and the key is deleted as
 * unused. CLAUDE.md records the same rule for the identifier names.
 */
const DOMAIN_LABEL: Readonly<Record<string, string>> = {
  goal: "admin.roles.domainGoal",
  kpi: "admin.roles.domainKpi",
  initiative: "admin.roles.domainInitiative",
  task: "admin.roles.domainTask",
  comment: "admin.roles.domainComment",
  space: "admin.roles.domainSpace",
  workspace: "admin.roles.domainWorkspace",
};

const LEVELS = [
  { value: 0, key: "admin.roles.levelNone" },
  { value: 10, key: "admin.roles.levelView" },
  { value: 40, key: "admin.roles.levelComment" },
  { value: 70, key: "admin.roles.levelEdit" },
  { value: 100, key: "admin.roles.levelManage" },
] as const;

export interface MatrixRole {
  readonly id: string;
  readonly name: string;
  readonly builtinKey: string | null;
  readonly isDefault: boolean;
  readonly editable: boolean;
  readonly memberCount: number;
  readonly permissions: readonly {
    readonly domain: string;
    readonly level: number;
  }[];
}

export function RoleMatrix({
  roles,
  domains,
}: {
  readonly roles: readonly MatrixRole[];
  /** The domains a role can speak about, in the order they are drawn. */
  readonly domains: readonly RoleDomain[];
}) {
  const { t } = useTranslations();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);

  const run = (work: () => Promise<{ error: string | null }>) => {
    setProblem(null);
    start(async () => {
      const result = await work();
      if (result.error) {
        setProblem(result.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-3">
      {problem ? (
        <p role="alert" className="text-xs text-bad">
          {problem}
        </p>
      ) : null}

      {/* The table scrolls, the page never does: seven domains and five
       * choices do not fit a phone, and shrinking the cells would make the
       * words unreadable before it made the table fit. */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[52rem] border-collapse">
          <thead>
            <tr className="border-b border-line">
              <th
                scope="col"
                className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-ink-3"
              >
                {t("admin.roles.role")}
              </th>
              {domains.map((domain) => (
                <th
                  key={domain}
                  scope="col"
                  className="px-2 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-ink-3"
                >
                  {t(DOMAIN_LABEL[domain] ?? "admin.roles.domainGoal")}
                </th>
              ))}
              <th scope="col" className="px-3 py-2">
                <span className="sr-only">{t("admin.roles.rowActions")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {roles.map((role) => (
              <tr key={role.id} className="border-b border-line align-top">
                <th scope="row" className="px-3 py-2.5 text-left">
                  <span className="flex flex-col gap-0.5">
                    <span className="text-sm font-semibold text-ink">
                      {role.name}
                    </span>
                    {/* Two spans rather than one sentence glued from two
                     * pieces: a message assembled beside another value is one
                     * a translator cannot place, which the catalogue gate
                     * refuses and is right to. */}
                    <span className="text-[11px] text-ink-3">
                      {t("admin.roles.heldBy", { count: role.memberCount })}
                    </span>
                    {role.isDefault ? (
                      <span className="text-[11px] text-ink-3">
                        {t("admin.roles.isDefault")}
                      </span>
                    ) : null}
                    {role.editable ? null : (
                      <span className="text-[11px] text-ink-4">
                        {t("admin.roles.ownerIsFixed")}
                      </span>
                    )}
                  </span>
                </th>

                {domains.map((domain) => {
                  const level =
                    role.permissions.find((entry) => entry.domain === domain)
                      ?.level ?? 0;
                  const label = t("admin.roles.cellFor", {
                    role: role.name,
                    domain: t(DOMAIN_LABEL[domain] ?? "admin.roles.domainGoal"),
                  });
                  return (
                    <td key={domain} className="px-2 py-2.5">
                      {role.editable ? (
                        <select
                          value={level}
                          aria-label={label}
                          disabled={pending}
                          onChange={(event) =>
                            run(() =>
                              setPermissionAction({
                                roleId: role.id,
                                domain,
                                level: Number(event.target.value) as
                                  | 0
                                  | 10
                                  | 40
                                  | 70
                                  | 100,
                              }),
                            )
                          }
                          className="h-7 w-full rounded-control border border-line-2 bg-surface px-1.5 text-xs text-ink outline-none focus:border-brand"
                        >
                          {LEVELS.map((entry) => (
                            <option key={entry.value} value={entry.value}>
                              {t(entry.key)}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-xs text-ink-3">
                          {t(
                            LEVELS.find((entry) => entry.value === level)
                              ?.key ?? "admin.roles.levelNone",
                          )}
                        </span>
                      )}
                    </td>
                  );
                })}

                <td className="px-3 py-2.5 text-right">
                  {role.editable && role.builtinKey === null ? (
                    confirming === role.id ? (
                      <span className="flex items-center justify-end gap-1">
                        <Button
                          type="button"
                          size="sm"
                          disabled={pending}
                          onClick={() =>
                            run(async () => {
                              const result = await deleteRoleAction({
                                id: role.id,
                              });
                              setConfirming(null);
                              return result;
                            })
                          }
                        >
                          {t("common.delete")}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => setConfirming(null)}
                        >
                          {t("common.cancel")}
                        </Button>
                      </span>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        disabled={pending}
                        onClick={() => setConfirming(role.id)}
                      >
                        {t("common.delete")}
                      </Button>
                    )
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {adding ? (
        <div className="flex flex-wrap items-center gap-2">
          <input
            // Focused through a ref rather than `autoFocus`, which also steals
            // focus when a page loads with one of these already open.
            ref={(node) => node?.focus()}
            value={name}
            aria-label={t("admin.roles.addRole")}
            placeholder={t("admin.roles.namePlaceholder")}
            disabled={pending}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setName("");
                setAdding(false);
              }
            }}
            className="h-7.5 w-56 rounded-control border border-line bg-surface px-2 text-xs text-ink outline-none focus:border-brand"
          />
          <Button
            type="button"
            variant="primary"
            disabled={pending || name.trim() === ""}
            onClick={() =>
              run(async () => {
                const result = await createRoleAction({ name: name.trim() });
                if (!result.error) {
                  setName("");
                  setAdding(false);
                }
                return result;
              })
            }
          >
            {t("common.save")}
          </Button>
          <Button
            type="button"
            disabled={pending}
            onClick={() => {
              setName("");
              setAdding(false);
            }}
          >
            {t("common.cancel")}
          </Button>
        </div>
      ) : (
        <div>
          <Button type="button" onClick={() => setAdding(true)}>
            {t("admin.roles.addRole")}
          </Button>
        </div>
      )}
    </div>
  );
}
