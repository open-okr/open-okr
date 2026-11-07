import { mayCreateOwnWorkspace } from "@openokr/core";
import { notFound } from "next/navigation";
import { pageTitle } from "../../../lib/page-title.ts";
import { getPool } from "../../../lib/pool";
import { getTranslations } from "../../../lib/translations";
import { requireWorkspace } from "../../../lib/workspace";
import { createOwnWorkspaceAction } from "./actions";
import { NewOwnWorkspaceForm } from "./new-own-workspace-form";

export const generateMetadata = pageTitle("pageTitle.newWorkspace");

/**
 * S-50 New workspace: starting another one, where sign-up is open to this person
 * (docs/design/hosting-profiles.md §3).
 *
 * Not-found where it is not. A form that can only be refused is worse than no form,
 * and the action refuses independently: this is the courtesy, not the control.
 */
export const dynamic = "force-dynamic";

export default async function NewWorkspacePage() {
  const { session } = await requireWorkspace();
  if (!(await mayCreateOwnWorkspace(getPool(), session.user.email))) {
    notFound();
  }
  const { t } = await getTranslations();
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-bold text-ink text-lg">
          {t("workspaces.new.title")}
        </h1>
        <p className="text-ink-2 text-sm">{t("workspaces.new.intro")}</p>
      </header>
      <NewOwnWorkspaceForm action={createOwnWorkspaceAction} />
    </div>
  );
}
