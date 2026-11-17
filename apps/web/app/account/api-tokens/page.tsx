import { API_BASE, callAction, resourceIdentifier } from "@openokr/core";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  CopyButton,
  NumberInput,
  TextInput,
} from "@openokr/ui";
import { KeyRound } from "lucide-react";
import { AgentCallsLine } from "../../../lib/agent-calls-line";
import { agentSetupLine, agentSetupUrl } from "../../../lib/agent-setup-prompt";
import { getInstanceName } from "../../../lib/instance-name";
import { instanceIssuer } from "../../../lib/issuer";
import { pageTitle } from "../../../lib/page-title.ts";
import { getPool } from "../../../lib/pool";
import { getTranslations } from "../../../lib/translations";
import { requireWorkspace } from "../../../lib/workspace";
import { createToken, revokeToken } from "./actions.ts";
import { agentConfiguration } from "./agent-config.ts";
import { TokenForm } from "./token-form.tsx";

export const generateMetadata = pageTitle("pageTitle.apiTokens");

/**
 * A member's own API tokens (TECHNICAL-PLAN §14, P5-T07a).
 *
 * **Every token here is you.** A token carries the authority of the member who
 * minted it, narrowed by its scopes, and nothing more. There is no service
 * account to mint one from, so the page says whose authority it is rather than
 * leaving somebody to assume a token is a separate principal.
 *
 * **It is shown once.** The row holds a digest. That is stated on the page,
 * before the button, because "copy this now" after the fact is a worse
 * experience than knowing beforehand.
 *
 * **Two doors, chosen here** (completeness review M-12). A REST token opens
 * `/api/v1` for a script or the command line. An agent token opens the agent
 * endpoint, for a local agent that cannot open a browser to go through the
 * consent screen: AI-NATIVE-PLAN §8.1's "scoped tokens remain for local and
 * scripted use". Each is refused at the other's door, and the page says how
 * to connect one rather than leaving somebody to find the address.
 */

const AUDIENCES = [
  {
    id: "rest",
    label: "account.apiTokens.forScripts",
    hint: "account.apiTokens.forScriptsHint",
  },
  {
    id: "mcp",
    label: "account.apiTokens.forAgent",
    hint: "account.apiTokens.forAgentHint",
  },
] as const;

const SCOPES = [
  {
    id: "read",
    label: "account.apiTokens.scopeRead",
    hint: "account.apiTokens.scopeReadHint",
  },
  {
    id: "write",
    label: "account.apiTokens.scopeWrite",
    hint: "account.apiTokens.scopeWriteHint",
  },
  {
    id: "destructive",
    label: "account.apiTokens.scopeDestructive",
    hint: "account.apiTokens.scopeDestructiveHint",
  },
] as const;

const shortDate = (value: string | null): string =>
  value === null ? "never" : value.slice(0, 10);

export default async function ApiTokensPage() {
  const { t } = await getTranslations();

  const { session, workspace } = await requireWorkspace();
  const { tokens } = await callAction(
    {
      pool: getPool(),
      workspaceId: workspace.workspaceId,
      actor: { kind: "human", userId: session.user.id },
    },
    "tokens.mine",
    {},
  );
  // The address every grant and every agent token is checked against, so the
  // one an agent is told to use is the one it will be accepted at.
  const agentEndpoint = resourceIdentifier(instanceIssuer());
  const setupUrl = agentSetupUrl(instanceIssuer());
  const instanceName = await getInstanceName();

  const activeCount = tokens.filter((token) => !token.revokedAt).length;
  const description = "text-xs text-ink-3";

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-bold text-ink">
          {t("account.apiTokens.apiTokens")}
        </h1>
        <p className="max-w-prose text-sm text-ink-3">
          {t("account.apiTokens.aTokenLetsA")}{" "}
          <code className="font-mono text-xs">{API_BASE}</code>{" "}
          {t("account.apiTokens.surfaceItCarriesYour")}
        </p>
      </header>

      <Card>
        <CardHeader className="flex-col items-stretch gap-0.5">
          <h2 className="text-sm font-semibold text-ink">
            {t("account.apiTokens.newToken")}
          </h2>
          <p className={description}>
            {t("account.apiTokens.theTokenIsShown")}
          </p>
        </CardHeader>
        <TokenForm
          action={createToken}
          agentEndpoint={agentEndpoint}
          setupUrl={setupUrl}
          bodyClassName="grid grid-cols-12 gap-x-6 gap-y-4"
          submit={
            <Button type="submit" variant="primary" size="sm">
              {t("account.apiTokens.createToken")}
            </Button>
          }
        >
          <div className="col-span-12 md:col-span-6">
            <TextInput
              label={t("common.name")}
              name="name"
              required
              maxLength={120}
              placeholder={t("account.apiTokens.deployScript")}
            />
          </div>
          <div className="col-span-12 md:col-span-6">
            <NumberInput
              label={t("account.apiTokens.expiresAfterInDays")}
              name="expiresInDays"
              min={1}
              max={3650}
              step={1}
              placeholder={t("account.apiTokens.leaveEmptyForNo")}
            />
          </div>

          <fieldset className="col-span-12 flex flex-col gap-2">
            <legend className="mb-1 text-xs font-semibold text-ink-2">
              {t("account.apiTokens.whatItIsFor")}
            </legend>
            <div className="grid grid-cols-12 gap-x-6 gap-y-3">
              {AUDIENCES.map((audience) => (
                <label
                  key={audience.id}
                  className="col-span-12 flex items-start gap-2 text-sm text-ink md:col-span-6"
                >
                  <input
                    type="radio"
                    name="audience"
                    value={audience.id}
                    defaultChecked={audience.id === "rest"}
                    className="mt-1"
                  />
                  <span className="flex flex-col">
                    {t(audience.label)}
                    <span className="text-xs text-ink-3">
                      {t(audience.hint)}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="col-span-12 flex flex-col gap-2">
            <legend className="mb-1 text-xs font-semibold text-ink-2">
              {t("account.apiTokens.scopes")}
            </legend>
            <div className="grid grid-cols-12 gap-x-6 gap-y-3">
              {SCOPES.map((scope) => (
                <label
                  key={scope.id}
                  className="col-span-12 flex items-start gap-2 text-sm text-ink md:col-span-4"
                >
                  <input
                    type="checkbox"
                    name={`scope.${scope.id}`}
                    defaultChecked={scope.id === "read"}
                    className="mt-1"
                  />
                  <span className="flex flex-col">
                    {t(scope.label)}
                    <span className="text-xs text-ink-3">{t(scope.hint)}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </TokenForm>
      </Card>

      <Card>
        <CardHeader className="flex-col items-stretch gap-0.5">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-ink">
              {t("account.apiTokens.yourTokens")}
            </h2>
            <span className="rounded-full bg-raised px-2 text-xs font-semibold text-ink-3">
              {activeCount}
            </span>
          </div>
          <p className={description}>{t("account.apiTokens.revokeHint")}</p>
        </CardHeader>
        <CardBody>
          {tokens.length === 0 ? (
            <p className="text-sm text-ink-3">
              {t("account.apiTokens.youHaveNoTokens")}
            </p>
          ) : (
            // Scrolls inside the card at about five rows; tabIndex lets a
            // keyboard user scroll it.
            <ul
              // biome-ignore lint/a11y/noNoninteractiveTabindex: a scroll region must be focusable to scroll by keyboard
              tabIndex={0}
              aria-label={t("account.apiTokens.listLabel")}
              className="max-h-[296px] overflow-y-auto overscroll-contain rounded-lg border border-line"
            >
              {tokens.map((token, index) => (
                <li
                  key={token.id}
                  className={`flex items-center gap-3 px-3 py-2.5 ${index === 0 ? "" : "border-line border-t"}`}
                  data-testid="token-row"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-raised text-ink-3">
                    <KeyRound className="size-4" aria-hidden="true" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                      {token.name}
                      {token.revokedAt ? (
                        <Chip tone="bad">{t("common.revoked")}</Chip>
                      ) : (
                        <Chip tone="ok">{t("common.active")}</Chip>
                      )}
                      <Chip tone="neutral">
                        {token.audience === "mcp"
                          ? t("account.apiTokens.audienceAgent")
                          : t("account.apiTokens.audienceRest")}
                      </Chip>
                      <code className="font-mono text-xs text-ink-3">
                        {token.prefix}…
                      </code>
                    </span>
                    <span className="text-xs text-ink-3">
                      {t("account.apiTokens.expiresLastUsed", {
                        scopes: token.scopes.join(", "),
                        expiresAt: shortDate(token.expiresAt),
                        lastUsedAt: shortDate(token.lastUsedAt),
                      })}
                    </span>
                    {/* Why it stopped, when its owner did not stop it (plan
                     * 0.7.0 A4): never who, which the audit row records. */}
                    {token.revokedReason ? (
                      <span className="text-xs text-bad">
                        {token.revokedReason}
                      </span>
                    ) : null}
                    {token.audience === "mcp" ? (
                      <AgentCallsLine kind="token" id={token.id} />
                    ) : null}
                  </span>
                  {token.revokedAt ? null : (
                    <TokenForm
                      action={revokeToken}
                      className="flex shrink-0 flex-col items-end gap-1"
                    >
                      <input type="hidden" name="id" value={token.id} />
                      <Button type="submit" size="sm">
                        {t("common.revoke")}
                      </Button>
                    </TokenForm>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="flex-col items-stretch gap-0.5">
          <h2 className="text-sm font-semibold text-ink">
            {t("account.apiTokens.connectAnAgent")}
          </h2>
          <p className={description}>{t("account.apiTokens.agentIntro")}</p>
        </CardHeader>
        <CardBody className="grid grid-cols-12 gap-x-6 gap-y-4">
          {/* docs/design/agent-setup-prompt.md §4: the OAuth prompt, so an
              agent that can open a browser needs no token at all. */}
          <div className="col-span-12 flex flex-col items-start gap-1">
            <CopyButton
              text={agentSetupLine({ instanceName, setupUrl })}
              variant="primary"
              size="sm"
            >
              {t("account.apiTokens.copySetupPrompt")}
            </CopyButton>
            <p className="text-xs text-ink-3">
              {t("account.apiTokens.copySetupPromptHint")}
            </p>
          </div>
          <div className="col-span-12 flex flex-col gap-2.5 md:col-span-6">
            <p className="text-sm text-ink-3">
              {t("account.apiTokens.agentHow", { endpoint: agentEndpoint })}
            </p>
            <p className="text-sm text-ink-3">
              {t("account.apiTokens.agentSameRules")}
            </p>
            <p className="text-sm text-ink-3">
              {t("account.apiTokens.agentToolsets")}
            </p>
          </div>
          <div className="col-span-12 md:col-span-6">
            <pre
              data-testid="agent-configuration"
              className="whitespace-pre-wrap break-all rounded-md bg-raised px-2.5 py-2 font-mono text-xs text-ink-2"
            >
              {agentConfiguration(
                agentEndpoint,
                t("account.apiTokens.tokenPlaceholder"),
              )}
            </pre>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
