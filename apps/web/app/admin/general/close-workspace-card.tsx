"use client";

import {
  Button,
  Card,
  CardBody,
  CardHeader,
  TextInput,
  useTranslations,
} from "@openokr/ui";
import Link from "next/link";
import { useActionState, useState } from "react";
import {
  type CloseActionState,
  closeWorkspace,
  reopenWorkspace,
} from "./close-actions";

/**
 * Closing a cloud workspace, and reopening it (docs/design/workspace-erasure.md §3
 * and §8, S-36).
 *
 * **It says everything that will happen before anybody presses anything**: the date
 * it will be deleted, where to export it, that the subscription stops and nothing
 * is refunded, and whether it can be undone. Then the workspace's address has to be
 * typed, because a closed workspace is erased once its window passes.
 *
 * Offered only to whoever holds `full` on the workspace, which is what the server
 * asks for. A closure the provider made shows no reopen button, because the server
 * would refuse it.
 */
export function CloseWorkspaceCard(
  props:
    | {
        readonly mode: "open";
        readonly slug: string;
        /** Formatted. Null while retention is off. */
        readonly eraseIfClosedToday: string | null;
        /** False when billing made it read-only: closing it is then one-way. */
        readonly mayReopenAfter: boolean;
        readonly billingOn: boolean;
      }
    | {
        readonly mode: "closed";
        readonly closedOn: string;
        readonly eraseOn: string | null;
        readonly mayReopen: boolean;
      },
) {
  const { t } = useTranslations();
  const [typed, setTyped] = useState("");
  const [closeState, closeAction, closing] = useActionState<
    CloseActionState | null,
    FormData
  >(closeWorkspace, null);
  const [reopenState, reopenAction, reopening] = useActionState<
    CloseActionState | null,
    FormData
  >(reopenWorkspace, null);

  if (props.mode === "closed") {
    return (
      <Card data-testid="close-workspace-card">
        <CardHeader>
          <h2 className="text-sm font-bold text-ink">
            {t("admin.close.closedTitle")}
          </h2>
        </CardHeader>
        <CardBody className="flex flex-col gap-3">
          <p className="text-sm text-ink-2">
            {props.eraseOn
              ? t("admin.close.closedOn", {
                  closed: props.closedOn,
                  erase: props.eraseOn,
                })
              : t("admin.close.closedKept", { closed: props.closedOn })}
          </p>
          {props.mayReopen ? (
            <form action={reopenAction} className="flex flex-col gap-2.5">
              <p className="text-xs text-ink-3">
                {t("admin.close.reopenExplains")}
              </p>
              {reopenState?.failed ? (
                <p className="text-sm text-bad" role="alert">
                  {t("admin.close.reopenFailed")}
                </p>
              ) : null}
              <div>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={reopening}
                  data-testid="reopen-workspace"
                >
                  {t("admin.close.reopen")}
                </Button>
              </div>
            </form>
          ) : (
            <p className="text-xs text-ink-3">
              {t("admin.close.onlyProvider")}
            </p>
          )}
        </CardBody>
      </Card>
    );
  }

  const matches = typed.trim() === props.slug;
  return (
    <Card data-testid="close-workspace-card">
      <CardHeader>
        <div className="flex min-w-0 flex-col">
          <h2 className="text-sm font-bold text-ink">
            {t("admin.close.title")}
          </h2>
          <p className="text-xs text-ink-3">{t("admin.close.explains")}</p>
        </div>
      </CardHeader>
      <CardBody className="flex flex-col gap-3">
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-ink-2">
          <li>
            {props.eraseIfClosedToday
              ? t("admin.close.deletedOn", { date: props.eraseIfClosedToday })
              : t("admin.close.kept")}
          </li>
          {props.billingOn ? <li>{t("admin.close.billing")}</li> : null}
          <li>
            {props.mayReopenAfter
              ? t("admin.close.mayReopen")
              : t("admin.close.providerReopens")}
          </li>
        </ul>
        <Link
          href="/admin/imports"
          className="text-sm font-semibold text-brand-text hover:underline"
        >
          {t("admin.close.exportFirst")}
        </Link>
        <form action={closeAction} className="flex flex-col gap-2.5">
          <TextInput
            name="slug"
            label={t("admin.close.typeSlug", { slug: props.slug })}
            autoComplete="off"
            spellCheck={false}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            data-testid="close-workspace-slug"
          />
          {closeState?.failed ? (
            <p className="text-sm text-bad" role="alert">
              {t("admin.close.failed")}
            </p>
          ) : null}
          <div>
            <Button
              type="submit"
              size="sm"
              disabled={!matches || closing}
              data-testid="close-workspace-submit"
            >
              {t("admin.close.confirm")}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
