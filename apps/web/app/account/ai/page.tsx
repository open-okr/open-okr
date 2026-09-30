import { ACCESS_LEVELS, callAction } from "@openokr/core";
import { Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import { resolveAccessLevelFor } from "../../../lib/access";
import { getPool } from "../../../lib/pool";
import { getTranslations } from "../../../lib/translations";
import { requireWorkspace } from "../../../lib/workspace";
import { removePersonalKey, savePersonalKey } from "./actions.ts";
import { KeyForm } from "./key-form.tsx";
import { providerWord, STATUS_WORDS } from "./words.ts";

/**
 * A member's own AI keys (completeness review M-36, P2-T14, AI-NATIVE-PLAN
 * §3.3).
 *
 * **Here rather than on the AI console.** IMPLEMENTATION-PLAN names "the
 * workspace and personal credential flows" among S-37's cards, and S-37 is
 * refused below `manage_ai`. A personal key is every member's, so a card only
 * an administrator can open would be one almost nobody who owns a key could
 * reach. The console keeps the half that is the administrator's: whether a
 * provider takes personal keys at all.
 *
 * **Written once and never read back.** The page shows whether a key is
 * stored, its last four characters, its status and when it was stored. No
 * field is pre-filled, and nothing a render could reach holds the key.
 *
 * **Every state is said rather than hidden.** A workspace that takes no
 * personal keys gets a sentence saying so and who can change it; a member
 * whose level does not let them store one sees their slots and is told why
 * there is no form. Loading and a failed read are the segment's own
 * `loading.tsx` and `error.tsx`, inside the shell.
 */

const STATUS_TONE: Readonly<Record<string, "ok" | "bad" | "warn">> = {
  verified: "ok",
  invalid: "bad",
  unverified: "warn",
};

export default async function PersonalAIKeysPage() {
  const { t } = await getTranslations();

  const { session, workspace } = await requireWorkspace();
  const [level, keys] = await Promise.all([
    resolveAccessLevelFor(workspace.workspaceId, workspace.memberId),
    callAction(
      {
        pool: getPool(),
        workspaceId: workspace.workspaceId,
        actor: { kind: "human", userId: session.user.id },
      },
      "ai.readOwnCredentialStatus",
      {},
    ),
  ]);
  // The level the two writes declare. Asked here so the form is not drawn for
  // somebody it would refuse; the actions refuse on their own whatever this
  // says.
  const canStore = level >= ACCESS_LEVELS.edit;

  return (
    <div className="flex flex-col gap-4.5">
      <Card>
        <CardHeader>
          <h1 className="text-lg font-bold text-ink">
            {t("account.aiKeys.title")}
          </h1>
        </CardHeader>
        <CardBody className="flex flex-col gap-2">
          <p className="max-w-prose text-sm text-ink-3">
            {t("account.aiKeys.intro")}
          </p>
          <p className="max-w-prose text-sm text-ink-3">
            {t("account.aiKeys.whichProvider")}
          </p>
          <p className="max-w-prose text-sm text-ink-3">
            {t("account.aiKeys.neverShown")}
          </p>
        </CardBody>
      </Card>

      {keys.length === 0 ? (
        <Card>
          <CardBody>
            <p
              className="max-w-prose text-sm text-ink-3"
              data-testid="personal-keys-empty"
            >
              {t("account.aiKeys.noneOffered")}
            </p>
          </CardBody>
        </Card>
      ) : (
        <section
          aria-label={t("account.aiKeys.providers")}
          className="flex flex-col gap-1.5"
        >
          {canStore ? null : (
            <p
              className="max-w-prose rounded-md bg-raised px-2.5 py-1.5 text-xs text-ink-2"
              data-testid="personal-keys-denied"
            >
              {t("account.aiKeys.cannotStore")}
            </p>
          )}
          {keys.map((key) => {
            const name = providerWord(t, key.provider);
            return (
              <Card key={key.provider} data-testid="personal-key">
                <CardHeader className="justify-between">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-bold text-ink">{name}</h2>
                    {key.hasPersonalCredential ? (
                      <Chip tone="ok">{t("account.aiKeys.set")}</Chip>
                    ) : (
                      <Chip tone="neutral">{t("account.aiKeys.notSet")}</Chip>
                    )}
                    {key.status ? (
                      <Chip tone={STATUS_TONE[key.status] ?? "warn"}>
                        {t(STATUS_WORDS[key.status])}
                      </Chip>
                    ) : null}
                  </div>
                  {key.keyHint ? (
                    <code className="font-mono text-xs text-ink-3">
                      {key.keyHint}
                    </code>
                  ) : null}
                </CardHeader>
                <CardBody className="flex flex-col gap-3">
                  {key.setAt ? (
                    <p className="text-xs text-ink-3">
                      {t("account.aiKeys.setOn", {
                        date: key.setAt.slice(0, 10),
                      })}
                    </p>
                  ) : null}

                  {canStore ? (
                    <KeyForm
                      action={savePersonalKey}
                      submitLabel={
                        key.hasPersonalCredential
                          ? t("admin.ai.replace")
                          : t("admin.ai.store")
                      }
                      busyLabel={t("account.aiKeys.storing")}
                      className="flex flex-col gap-2"
                    >
                      <input
                        type="hidden"
                        name="provider"
                        value={key.provider}
                      />
                      <label className="flex max-w-sm flex-col gap-1 text-xs text-ink-3">
                        {key.hasPersonalCredential
                          ? t("account.aiKeys.replaceHelp", { provider: name })
                          : t("account.aiKeys.pasteHelp", { provider: name })}
                        <input
                          name="apiKey"
                          type="password"
                          autoComplete="off"
                          spellCheck={false}
                          required
                          className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                        />
                      </label>
                    </KeyForm>
                  ) : null}

                  {/* Only where there is something to remove. The chip above
                      turning to "Not stored" is the confirmation, because the
                      render that proves the removal also takes this form away
                      with any message inside it. */}
                  {canStore && key.hasPersonalCredential ? (
                    <KeyForm
                      action={removePersonalKey}
                      submitLabel={t("account.aiKeys.remove")}
                      busyLabel={t("account.aiKeys.removing")}
                      variant="ghost"
                      className="flex flex-col gap-2 border-t border-line pt-3"
                    >
                      <input
                        type="hidden"
                        name="provider"
                        value={key.provider}
                      />
                    </KeyForm>
                  ) : null}
                </CardBody>
              </Card>
            );
          })}
        </section>
      )}
    </div>
  );
}
