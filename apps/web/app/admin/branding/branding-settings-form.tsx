import { callAction, OperationError } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { getPool } from "../../../lib/auth";
import { requireWorkspace } from "../../../lib/workspace";

/** The branding admin card (screen S-36, P2-T08). One field today: the
 * primary colour. Empty means the product's own default theme, not an
 * unanswered question, so clearing the field is a valid save. */

async function save(formData: FormData): Promise<void> {
  "use server";
  const { session, workspace } = await requireWorkspace();
  const primaryColor = String(formData.get("primaryColor") ?? "").trim();

  try {
    await callAction(
      {
        pool: getPool(),
        workspaceId: workspace.workspaceId,
        actor: { kind: "human", userId: session.user.id },
      },
      "settings.updateWorkspaceBranding",
      {
        branding: primaryColor === "" ? {} : { primaryColor },
      },
    );
  } catch (error) {
    if (!(error instanceof OperationError)) {
      throw error;
    }
    return;
  }
  revalidatePath("/admin/branding");
}

async function reset(): Promise<void> {
  "use server";
  const { session, workspace } = await requireWorkspace();
  await callAction(
    {
      pool: getPool(),
      workspaceId: workspace.workspaceId,
      actor: { kind: "human", userId: session.user.id },
    },
    "settings.resetWorkspaceSettings",
    { card: "branding" },
  );
  revalidatePath("/admin/branding");
}

export function BrandingSettingsForm({
  branding,
}: {
  branding: Record<string, unknown>;
}) {
  return (
    <>
      <form action={save}>
        <p>
          <label htmlFor="primaryColor">Primary colour (hex)</label>
          <br />
          <input
            id="primaryColor"
            name="primaryColor"
            placeholder="#336699"
            defaultValue={String(branding.primaryColor ?? "")}
          />
        </p>
        <button type="submit">Save</button>
      </form>
      <form action={reset}>
        <button type="submit">Reset to defaults</button>
      </form>
    </>
  );
}
