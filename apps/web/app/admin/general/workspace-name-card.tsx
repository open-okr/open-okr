import { ACCESS_LEVELS, callAction, OperationError } from "@openokr/core";
import {
  Card,
  CardBody,
  CardHeader,
  SubmitButton,
  TextInput,
} from "@openokr/ui";
import { revalidatePath } from "next/cache";
import { requireAccessLevel } from "../../../lib/access";
import { getPool } from "../../../lib/pool";
import { getTranslations } from "../../../lib/translations";

/** The schema's own limit for `workspace.rename`. */
const WORKSPACE_NAME_MAX_LENGTH = 200;

async function rename(formData: FormData): Promise<void> {
  "use server";
  // Gated here as well as by the admin layout: a server action is directly
  // reachable, and a member below `full` gets the same not-found as the page.
  const access = await requireAccessLevel(ACCESS_LEVELS.full);
  const name = String(formData.get("workspaceName") ?? "").trim();
  if (name === "") {
    return;
  }
  try {
    await callAction(
      {
        pool: getPool(),
        workspaceId: access.workspaceId,
        actor: { kind: "human", userId: access.userId },
      },
      "workspace.rename",
      { name },
    );
  } catch (error) {
    // The field's `required` and `maxLength` stop a browser sending what the
    // schema refuses, so a refusal here fails quietly like the card below.
    if (!(error instanceof OperationError)) {
      throw error;
    }
    return;
  }
  // The topbar, the sidebar and the Work Map all carry the name.
  revalidatePath("/", "layout");
}

/**
 * The workspace's own name, the one the topbar, the sidebar and the Work Map
 * show. Only setup (S-34) could change it, so somebody who renamed their
 * only space expected the header to follow and found no way to change it
 * (owner, 4 November 2026). A space is a team inside the workspace; this is
 * the organisation the workspace stands for.
 */
export async function WorkspaceNameCard({ name }: { readonly name: string }) {
  const { t } = await getTranslations();
  return (
    <Card>
      <CardHeader>
        <h2 className="text-sm font-bold text-ink">
          {t("admin.general.workspaceName.title")}
        </h2>
      </CardHeader>
      <CardBody>
        <form action={rename} className="flex flex-col gap-3">
          <TextInput
            label={t("admin.general.workspaceName.label")}
            id="workspaceName"
            name="workspaceName"
            defaultValue={name}
            required
            maxLength={WORKSPACE_NAME_MAX_LENGTH}
            className="max-w-sm"
            autoComplete="organization"
          />
          <p className="text-xs text-ink-3">
            {t("admin.general.workspaceName.hint")}
          </p>
          <div className="flex flex-wrap items-center gap-2.5 border-t border-line pt-3">
            <SubmitButton variant="primary" size="sm">
              {t("common.save")}
            </SubmitButton>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
