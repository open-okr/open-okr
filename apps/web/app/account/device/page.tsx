import { callAction } from "@openokr/core";
import { Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import { getPool } from "../../../lib/pool";
import { getTranslations } from "../../../lib/translations";
import { requireWorkspace } from "../../../lib/workspace";
import { decide } from "./actions.ts";
import { DecisionForm } from "./decision-form.tsx";

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
    <div className="mx-auto flex max-w-xl flex-col gap-4.5">
      <Card>
        <CardHeader>
          <h1 className="text-lg font-bold text-ink">
            {t("account.device.authoriseATerminal")}
          </h1>
        </CardHeader>
        <CardBody className="flex flex-col gap-2">
          <p className="text-sm text-ink-3">
            {t("account.device.aTerminalRunning")}{" "}
            <code className="font-mono text-xs">{t("account.device.okr")}</code>{" "}
            {t("account.device.askedToActAs")}{" "}
            <span className="font-medium text-ink">{workspace.name}</span>
            {t("account.device.itWillGetA")}
          </p>
        </CardBody>
      </Card>

      {request === null ? (
        <Card>
          <CardBody className="flex flex-col gap-2">
            <p className="text-sm text-ink">
              {code
                ? "There is nothing to authorise for that code."
                : "Open the link your terminal printed to authorise it."}
            </p>
            <p className="text-xs text-ink-3">
              {code
                ? "It may have expired, been answered already, or never existed. Run the login again in your terminal to get a new one."
                : "Run okr login in a terminal and it will print a link and a code."}
            </p>
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardHeader>{t("account.device.whatIsAsking")}</CardHeader>
          <CardBody className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-ink-2">
                {t("account.device.theTerminalCallsItself")}
              </span>
              <span className="text-sm text-ink" data-testid="device-client">
                {request.clientName}
              </span>
            </div>

            <div className="flex flex-col gap-1.5">
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
              <span className="text-xs text-ink-3">
                {t("account.device.readSeesWhatYou")}
              </span>
            </div>

            <DecisionForm action={decide} userCode={code?.trim() ?? ""} />

            <p className="text-xs text-ink-3">
              {t("account.device.ifYouDidNot")}
            </p>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
