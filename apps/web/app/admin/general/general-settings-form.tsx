import { callAction, OperationError } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { getPool } from "../../../lib/auth";
import { requireWorkspace } from "../../../lib/workspace";

/**
 * The general admin card (screen S-36, P2-T08): timezone, language and
 * trusted email domains, one save for the whole card. Unstyled until
 * P2-T10; a refusal fails quietly rather than rendering a stack trace, the
 * same tradeoff `rename-workspace.tsx` already makes.
 */

async function save(formData: FormData): Promise<void> {
  "use server";
  const { session, workspace } = await requireWorkspace();

  const timezone = String(formData.get("timezone") ?? "").trim();
  const language = String(formData.get("language") ?? "").trim();
  const trustedEmailDomains = String(formData.get("trustedEmailDomains") ?? "")
    .split(",")
    .map((domain) => domain.trim())
    .filter((domain) => domain.length > 0);

  try {
    await callAction(
      {
        pool: getPool(),
        workspaceId: workspace.workspaceId,
        actor: { kind: "human", userId: session.user.id },
      },
      "settings.updateWorkspaceGeneral",
      {
        timezone: timezone === "" ? undefined : timezone,
        language: language === "" ? undefined : language,
        trustedEmailDomains,
      },
    );
  } catch (error) {
    if (!(error instanceof OperationError)) {
      throw error;
    }
    return;
  }
  revalidatePath("/admin/general");
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
    { card: "general" },
  );
  revalidatePath("/admin/general");
}

export function GeneralSettingsForm({
  settings,
}: {
  settings: Record<string, unknown>;
}) {
  const trustedEmailDomains = Array.isArray(settings.trustedEmailDomains)
    ? (settings.trustedEmailDomains as string[]).join(", ")
    : "";

  return (
    <>
      <form action={save}>
        <p>
          <label htmlFor="timezone">Timezone</label>
          <br />
          <input
            id="timezone"
            name="timezone"
            defaultValue={String(settings.timezone ?? "")}
          />
        </p>
        <p>
          <label htmlFor="language">Language</label>
          <br />
          <input
            id="language"
            name="language"
            defaultValue={String(settings.language ?? "")}
          />
        </p>
        <p>
          <label htmlFor="trustedEmailDomains">
            Trusted email domains (comma-separated)
          </label>
          <br />
          <input
            id="trustedEmailDomains"
            name="trustedEmailDomains"
            defaultValue={trustedEmailDomains}
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
