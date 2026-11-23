"use client";

import type { RoleDomain } from "@openokr/db";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  SelectInput,
  Spinner,
  TextInput,
  useTranslations,
} from "@openokr/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  createRoleAction,
  deleteRoleAction,
  type RoleResult,
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
  session: "admin.roles.domainSession",
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
  // What started the write in flight (a cell, a delete, the new role), so only
  // that control shows a spinner.
  const [acting, setActing] = useState<string | null>(null);

  // A refused name for the new role, shown under its box (guided-inputs §4.2).
  const [nameRefused, setNameRefused] = useState<string | null>(null);

  const run = (name: string, work: () => Promise<RoleResult>) => {
    setProblem(null);
    setNameRefused(null);
    setActing(name);
    start(async () => {
      const result = await work();
      if (result.error || result.fields) {
        setProblem(result.error);
        setNameRefused(result.fields?.name ?? null);
        return;
      }
      router.refresh();
    });
  };

  return (
    <Card>
      <CardHeader className="justify-between">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="text-sm font-semibold text-ink">
            {t("admin.roles.permissions")}
          </h2>
          <p className="text-xs text-ink-3">
            {t("admin.roles.permissionsHint")}
          </p>
        </div>
        {/* Hidden while the form is open: the form's own submit carries the
         * same name, and two buttons called "Add role" would read as one. */}
        {adding ? null : (
          <Button type="button" size="sm" onClick={() => setAdding(true)}>
            {t("admin.roles.addRole")}
          </Button>
        )}
      </CardHeader>
      <CardBody className="flex flex-col gap-4">
        {problem ? (
          <p role="alert" className="text-xs text-bad">
            {problem}
          </p>
        ) : null}

        {/* The table scrolls, the page never does: eight domains and five
         * choices do not fit a phone, and shrinking the cells would make the
         * words unreadable before it made the table fit. */}
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[67rem] table-fixed border-collapse">
            <thead>
              <tr className="border-b border-line">
                <th
                  scope="col"
                  className="w-[160px] px-3 py-2 text-start text-[10px] font-bold uppercase tracking-wider text-ink-3"
                >
                  {t("admin.roles.role")}
                </th>
                {domains.map((domain) => (
                  <th
                    key={domain}
                    scope="col"
                    className="px-1 py-2 text-start text-[10px] font-bold uppercase tracking-wider text-ink-3"
                  >
                    {t(DOMAIN_LABEL[domain] ?? "admin.roles.domainGoal")}
                  </th>
                ))}
                <th scope="col" className="w-[88px] px-3 py-2">
                  <span className="sr-only">{t("admin.roles.rowActions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {roles.map((role) => (
                <tr key={role.id} className="border-b border-line align-top">
                  <th scope="row" className="w-[160px] px-3 py-2.5 text-start">
                    <span className="flex flex-col gap-0.5">
                      <span className="text-sm font-semibold text-ink">
                        {role.name}
                      </span>
                      {/* Two spans rather than one sentence glued from two
                       * pieces: a message assembled beside another value is one
                       * a translator cannot place, which the catalogue gate
                       * refuses and is right to. */}
                      <span className="text-xs font-normal text-ink-3">
                        {t("admin.roles.heldBy", { count: role.memberCount })}
                      </span>
                      {role.isDefault ? (
                        <span className="text-xs font-normal text-ink-3">
                          {t("admin.roles.isDefault")}
                        </span>
                      ) : null}
                      {role.editable ? null : (
                        <span className="text-xs font-normal text-ink-3">
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
                      domain: t(
                        DOMAIN_LABEL[domain] ?? "admin.roles.domainGoal",
                      ),
                    });
                    return (
                      <td key={domain} className="px-1 py-2.5">
                        {role.editable ? (
                          <span className="flex items-center gap-1">
                            <SelectInput
                              className="min-w-0 flex-1"
                              label={label}
                              hideLabel
                              value={level}
                              disabled={pending}
                              onChange={(event) =>
                                run(`${role.id}:${domain}`, () =>
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
                              // `w-auto`, so the browser sizes the select to its
                              // widest choice in whatever language is showing.
                              // At the kit's `w-full` a percentage width counts
                              // as nothing when the table shares out its width,
                              // and the columns shrank until "Manage" read
                              // "Man" (Q-10d, 0.8.0 acceptance test).
                              inputClassName={
                                /* direction-neutral: The chevron offset is set on the inline end in both directions. */
                                "h-7 w-full min-w-0 ps-1 pe-5! bg-position-[right_0.25rem_center] rtl:bg-position-[left_0.25rem_center] text-xs"
                              }
                            >
                              {LEVELS.map((entry) => (
                                <option key={entry.value} value={entry.value}>
                                  {t(entry.key)}
                                </option>
                              ))}
                            </SelectInput>
                            {pending && acting === `${role.id}:${domain}` ? (
                              <Spinner />
                            ) : null}
                          </span>
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

                  <td className="px-3 py-2.5 text-end">
                    {role.editable && role.builtinKey === null ? (
                      confirming === role.id ? (
                        <span className="flex flex-col items-end gap-1">
                          <Button
                            type="button"
                            size="sm"
                            disabled={pending}
                            pending={pending && acting === `delete:${role.id}`}
                            onClick={() =>
                              run(`delete:${role.id}`, async () => {
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
          <div className="grid grid-cols-12 gap-x-6 gap-y-4">
            <div className="col-span-12 md:col-span-9">
              <TextInput
                label={t("admin.roles.addRole")}
                hideLabel
                // Focused through a ref rather than `autoFocus`, which also
                // steals focus when a page loads with one of these already open.
                ref={(node) => node?.focus()}
                value={name}
                placeholder={t("admin.roles.namePlaceholder")}
                disabled={pending}
                error={nameRefused}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setName("");
                    setAdding(false);
                  }
                }}
                maxLength={60}
                className="w-full"
                inputClassName="px-2 text-xs"
              />
            </div>
            <div className="col-span-12 flex items-start gap-2 md:col-span-3">
              <Button
                type="button"
                variant="primary"
                className="flex-1"
                disabled={
                  name.trim() === "" || (pending && acting !== "create")
                }
                pending={pending && acting === "create"}
                onClick={() =>
                  run("create", async () => {
                    const result = await createRoleAction({
                      name: name.trim(),
                    });
                    if (!result.error && !result.fields) {
                      setName("");
                      setAdding(false);
                    }
                    return result;
                  })
                }
              >
                {t("admin.roles.addRole")}
              </Button>
              <Button
                type="button"
                className="flex-1"
                disabled={pending}
                onClick={() => {
                  setName("");
                  setAdding(false);
                }}
              >
                {t("common.cancel")}
              </Button>
            </div>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
