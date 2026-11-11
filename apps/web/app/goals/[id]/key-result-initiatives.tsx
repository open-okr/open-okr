import type { callAction } from "@openokr/core";
import { EntityPicker, SubmitButton } from "@openokr/ui";
import Link from "next/link";
import { getTranslations } from "../../../lib/translations";
import { ActionForm } from "../../cycle/action-form.tsx";
import { UnlinkButton } from "../../initiatives/[id]/unlink-button.tsx";
import {
  linkKeyResultAction,
  unlinkKeyResultAction,
} from "../../initiatives/actions.ts";

type Initiative = Awaited<
  ReturnType<typeof callAction<"initiatives.list">>
>[number];

/**
 * The initiatives that move one key result, on its row of the objective page
 * (UIUX-PLAN S-14, plan 0.8.0 I1).
 *
 * S-14 always listed "linked initiatives" here and nothing drew them, so an
 * initiative could be tied to a key result only from the initiative's side.
 * Each is a link to its page. A writer of an open objective may unlink one,
 * link one that exists, or start a new one already tied to this key result,
 * which opens "Add an initiative" with it chosen. Linking asks for edit on the
 * initiative as well as on the objective, and a refusal says which, under the
 * picker, so the list offers what the reader can see rather than guessing.
 */
export async function KeyResultInitiatives({
  keyResultId,
  keyResultTitle,
  initiatives,
  linkable,
  canLink,
}: {
  readonly keyResultId: string;
  readonly keyResultTitle: string;
  /** The initiatives linked to this key result, as `initiatives.list` reads them. */
  readonly initiatives: readonly Initiative[];
  /** Every initiative the reader can see, of which those not linked are offered. */
  readonly linkable: readonly Initiative[];
  /** A writer of an open objective. */
  readonly canLink: boolean;
}) {
  const { t } = await getTranslations();
  const linked = new Set(initiatives.map((initiative) => initiative.id));
  const choices = linkable.filter((initiative) => !linked.has(initiative.id));

  return (
    <div
      className="flex flex-col gap-1"
      data-testid={`key-result-initiatives-${keyResultId}`}
    >
      <span className="text-xs font-semibold text-ink-2">
        {t("goals.detail.initiatives")}
      </span>
      {initiatives.length === 0 ? (
        <span className="text-xs text-ink-3">
          {t("goals.detail.noInitiativeMovesThis")}
        </span>
      ) : (
        <ul className="flex flex-col gap-1">
          {initiatives.map((initiative) => (
            <li key={initiative.id} className="flex items-center gap-2">
              <Link
                href={`/initiatives/${initiative.id}`}
                className="min-w-0 truncate text-xs text-brand-text hover:underline"
              >
                {initiative.title}
              </Link>
              {canLink ? (
                <UnlinkButton
                  label={t("goals.detail.unlinkInitiative", {
                    title: initiative.title,
                  })}
                  onUnlink={unlinkKeyResultAction.bind(
                    null,
                    initiative.id,
                    keyResultId,
                  )}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canLink ? (
        <div className="flex flex-wrap items-end gap-2">
          {choices.length > 0 ? (
            <ActionForm
              action={linkKeyResultAction}
              className="flex flex-wrap items-end gap-2"
            >
              <input type="hidden" name="keyResultId" value={keyResultId} />
              <EntityPicker
                label={t("goals.detail.initiativeToLink", {
                  title: keyResultTitle,
                })}
                hideLabel
                name="id"
                required
                options={choices.map((initiative) => ({
                  id: initiative.id,
                  label: initiative.title,
                  detail: initiative.spaceName,
                }))}
                className="w-56"
              />
              <SubmitButton
                bare
                className="rounded-md border border-line px-2 py-1 text-xs font-semibold text-ink-2 hover:border-brand hover:text-brand-text"
              >
                {t("common.link")}
              </SubmitButton>
            </ActionForm>
          ) : null}
          <Link
            href={`/initiatives?keyResult=${keyResultId}#title`}
            className="text-xs font-semibold text-brand-text hover:underline"
          >
            {t("goals.detail.newInitiativeForKeyResult")}
          </Link>
        </div>
      ) : null}
    </div>
  );
}
