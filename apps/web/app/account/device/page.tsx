import { callAction } from "@openokr/core";
import { Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import { pageTitle } from "../../../lib/page-title.ts";
import { getPool } from "../../../lib/pool";
import { getTranslations } from "../../../lib/translations";
import { requireWorkspace } from "../../../lib/workspace";
import { decide } from "./actions.ts";
import { DeviceCodeEntry } from "./code-entry.tsx";
import { DecisionForm } from "./decision-form.tsx";

export const generateMetadata = pageTitle("pageTitle.device");

/**
 * Authorising a terminal (TECHNICAL-PLAN §14, P5-T07c-b).
 *
 * **Behind the ordinary session gate, which is the point.** A terminal cannot
 * prove who it is; a browser already has. The proxy sends a signed-out visitor to
 * sign in and back here, so the flow works from a machine that has never been
 * logged in without the terminal ever seeing a password.
 *
 * **It says what is being asked for before it offers a button.** The scopes are
 * the terminal's request, shown as they are, and there is no control for changing
 * them: what is granted is what was asked, and the way to grant less is to refuse
 * and ask for less.
 *
 * **The name is the terminal's own claim.** It is displayed as text and read as
 * nothing: a machine calling itself "Ada's laptop" has only said so.
 */
export default async function DevicePage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const { t } = await getTranslations();

  const { code } = await searchParams;
  const { session, workspace } = await requireWorkspace();

  const request =
    code && code.trim() !== ""
      ? await callAction(
          {
            pool: getPool(),
            workspaceId: workspace.workspaceId,
            actor: { kind: "human", userId: session.user.id },
          },
          "tokens.pendingDevice",
          { userCode: code.trim() },
        )
      : null;

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-bold text-ink">
          {t("account.device.authoriseATerminal")}
        </h1>
        <p className="max-w-prose text-sm text-ink-3">
          {t("account.device.aTerminalAskedToActAsYou", {
            command: "okr",
            workspace: workspace.name,
          })}
        </p>
      </header>

      {request === null ? (
        <Card>
          <CardHeader className="flex-col items-stretch gap-0.5">
            <h2 className="text-sm font-semibold text-ink">
              {code
                ? t("account.device.nothingToAuthoriseForThatCode")
                : t("account.device.openTheLinkYourTerminalPrinted")}
            </h2>
            <p className="text-xs text-ink-3">
              {code
                ? t("account.device.itMayHaveExpired")
                : t("account.device.runLoginInATerminal", {
                    command: "okr login",
                  })}
            </p>
          </CardHeader>
          <CardBody className="flex flex-col gap-3">
            {/* The link is the easy way, and a typed code the way when the
                terminal is on another machine or its link would not copy. */}
            <p className="text-sm text-ink">
              {t("account.device.codeEntry.youCanAlsoType")}
            </p>
            <DeviceCodeEntry />
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-ink">
              {t("account.device.whatIsAsking")}
            </h2>
          </CardHeader>
          <CardBody className="grid grid-cols-12 gap-x-6 gap-y-4">
            <div className="col-span-12 flex flex-col gap-1 md:col-span-6">
              <span className="text-xs font-semibold text-ink-2">
                {t("account.device.theTerminalCallsItself")}
              </span>
              <span className="text-sm text-ink" data-testid="device-client">
                {request.clientName}
              </span>
            </div>

            <div className="col-span-12 flex flex-col gap-1.5 md:col-span-6">
              <span className="text-xs font-semibold text-ink-2">
                {t("account.device.scopesItAskedFor")}
              </span>
              <span className="flex flex-wrap gap-1.5">
                {request.requestedScopes.map((scope) => (
                  <Chip
                    key={scope}
                    tone={scope === "destructive" ? "bad" : "neutral"}
                  >
                    {scope}
                  </Chip>
                ))}
              </span>
            </div>

            <p className="col-span-12 rounded-md bg-raised px-2.5 py-1.5 text-xs text-ink-3">
              {t("account.device.readSeesWhatYou")}
            </p>
          </CardBody>
          <DecisionForm action={decide} userCode={code?.trim() ?? ""} />
        </Card>
      )}
    </div>
  );
}
