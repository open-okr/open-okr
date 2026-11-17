import { ACCESS_LEVELS, callAction } from "@openokr/core";
import { Card, CardBody } from "@openokr/ui";
import { resolveAccessLevelFor } from "../../../lib/access";
import { pageTitle } from "../../../lib/page-title.ts";
import { getPool } from "../../../lib/pool";
import { getTranslations } from "../../../lib/translations";
import { requireWorkspace } from "../../../lib/workspace";
import { KeysCard } from "./keys-card.tsx";
import { providerWord, STATUS_WORDS } from "./words.ts";

export const generateMetadata = pageTitle("pageTitle.accountAi");

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
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-bold text-ink">
          {t("account.aiKeys.title")}
        </h1>
        <p className="max-w-prose text-sm text-ink-3">
          {t("account.aiKeys.intro")}
        </p>
      </header>

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
        <KeysCard
          canStore={canStore}
          title={t("account.aiKeys.providers")}
          description={t("account.aiKeys.whichProvider")}
          neverShown={t("account.aiKeys.neverShown")}
          denied={
            <p
              className="max-w-prose rounded-md bg-raised px-2.5 py-1.5 text-xs text-ink-2"
              data-testid="personal-keys-denied"
            >
              {t("account.aiKeys.cannotStore")}
            </p>
          }
          rows={keys.map((key) => {
            const name = providerWord(t, key.provider);
            return {
              provider: key.provider,
              name,
              hasKey: key.hasPersonalCredential,
              statusLabel: key.status ? t(STATUS_WORDS[key.status]) : null,
              statusTone: STATUS_TONE[key.status ?? ""] ?? "warn",
              keyHint: key.keyHint,
              storedOn: key.setAt
                ? t("account.aiKeys.setOn", { date: key.setAt.slice(0, 10) })
                : null,
              fieldLabel: key.hasPersonalCredential
                ? t("account.aiKeys.replaceHelp", { provider: name })
                : t("account.aiKeys.pasteHelp", { provider: name }),
              unsavedLabel: t("account.aiKeys.keyOf", { provider: name }),
            };
          })}
        />
      )}
    </div>
  );
}
