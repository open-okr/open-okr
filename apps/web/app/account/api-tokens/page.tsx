import { API_BASE, callAction, resourceIdentifier } from "@openokr/core";
import { Button, Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import { instanceIssuer } from "../../../lib/issuer";
import { getPool } from "../../../lib/pool";
import { getTranslations } from "../../../lib/translations";
import { requireWorkspace } from "../../../lib/workspace";
import { createToken, revokeToken } from "./actions.ts";
import { agentConfiguration } from "./agent-config.ts";
import { TokenForm } from "./token-form.tsx";

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

  return (
    <div className="flex flex-col gap-4.5">
      <Card>
        <CardHeader>
          <h1 className="text-lg font-bold text-ink">
            {t("account.apiTokens.apiTokens")}
          </h1>
        </CardHeader>
        <CardBody className="flex flex-col gap-2">
          <p className="text-sm text-ink-3">
            {t("account.apiTokens.aTokenLetsA")}{" "}
            <code className="font-mono text-xs">{API_BASE}</code>{" "}
            {t("account.apiTokens.surfaceItCarriesYour")}
          </p>
          <p className="text-sm text-ink-3">
            {t("account.apiTokens.theTokenIsShown")}
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>{t("account.apiTokens.newToken")}</CardHeader>
        <CardBody>
          <TokenForm
            action={createToken}
            agentEndpoint={agentEndpoint}
            className="flex flex-col gap-3"
          >
            <label className="flex flex-col gap-1 text-xs font-semibold text-ink-2">
              {t("common.name")}
              <input
                type="text"
                name="name"
                required
                maxLength={120}
                placeholder={t("account.apiTokens.deployScript")}
                className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm font-normal text-ink"
              />
            </label>

            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1 text-xs font-semibold text-ink-2">
                {t("account.apiTokens.whatItIsFor")}
              </legend>
              {AUDIENCES.map((audience) => (
                <label
                  key={audience.id}
                  className="flex items-start gap-2 text-sm text-ink"
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
            </fieldset>

            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1 text-xs font-semibold text-ink-2">
                {t("account.apiTokens.scopes")}
              </legend>
              {SCOPES.map((scope) => (
                <label
                  key={scope.id}
                  className="flex items-start gap-2 text-sm text-ink"
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
            </fieldset>

            <label className="flex flex-col gap-1 text-xs font-semibold text-ink-2">
              {t("account.apiTokens.expiresAfterInDays")}
              <input
                type="number"
                name="expiresInDays"
                min={1}
                max={3650}
                placeholder={t("account.apiTokens.leaveEmptyForNo")}
                className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm font-normal text-ink"
              />
            </label>

            <Button type="submit" variant="primary" size="sm" className="w-fit">
              {t("account.apiTokens.createToken")}
            </Button>
          </TokenForm>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>{t("account.apiTokens.connectAnAgent")}</CardHeader>
        <CardBody className="flex flex-col gap-2">
          <p className="text-sm text-ink-3">
            {t("account.apiTokens.agentIntro")}
          </p>
          <p className="text-sm text-ink-3">
            {t("account.apiTokens.agentHow", { endpoint: agentEndpoint })}
          </p>
          <pre
            data-testid="agent-configuration"
            className="whitespace-pre-wrap break-all rounded-md bg-raised px-2.5 py-2 font-mono text-xs text-ink-2"
          >
            {agentConfiguration(
              agentEndpoint,
              t("account.apiTokens.tokenPlaceholder"),
            )}
          </pre>
          <p className="text-sm text-ink-3">
            {t("account.apiTokens.agentSameRules")}
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>{t("account.apiTokens.yourTokens")}</CardHeader>
        <CardBody className="flex flex-col gap-3">
          {tokens.length === 0 ? (
            <p className="text-sm text-ink-3">
              {t("account.apiTokens.youHaveNoTokens")}
            </p>
          ) : (
            tokens.map((token) => (
              <div
                key={token.id}
                className="flex flex-col gap-1.5 rounded-lg border border-line p-3"
                data-testid="token-row"
              >
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
                {token.revokedAt ? null : (
                  <TokenForm action={revokeToken}>
                    <input type="hidden" name="id" value={token.id} />
                    <Button type="submit" variant="ghost" size="sm">
                      {t("common.revoke")}
                    </Button>
                  </TokenForm>
                )}
              </div>
            ))
          )}
        </CardBody>
      </Card>
    </div>
  );
}
