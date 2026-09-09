import { API_BASE, callAction } from "@openokr/core";
import { Button, Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import { getPool } from "../../../lib/pool";
import { getTranslations } from "../../../lib/translations";
import { requireWorkspace } from "../../../lib/workspace";
import { createToken, revokeToken } from "./actions.ts";
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
 */

const SCOPES = [
  {
    id: "read",
    label: "Read",
    hint: "Every read action. Nothing changes.",
  },
  {
    id: "write",
    label: "Write",
    hint: "Create and update. Still bounded by what you can do.",
  },
  {
    id: "destructive",
    label: "Destructive",
    hint: "Removes things people can see. Grant only when something needs it.",
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

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4.5">
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
          <TokenForm action={createToken} className="flex flex-col gap-3">
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
                    {scope.label}
                    <span className="text-xs text-ink-3">{scope.hint}</span>
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

            <input type="hidden" name="audience" value="rest" />

            <Button type="submit" variant="primary" size="sm" className="w-fit">
              {t("account.apiTokens.createToken")}
            </Button>
          </TokenForm>
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
                  <code className="font-mono text-xs text-ink-3">
                    {token.prefix}…
                  </code>
                </span>
                <span className="text-xs text-ink-3">
                  {token.scopes.join(", ")} {t("account.apiTokens.expires")}{" "}
                  {shortDate(token.expiresAt)} {t("account.apiTokens.lastUsed")}{" "}
                  {shortDate(token.lastUsedAt)}
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
