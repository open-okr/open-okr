import { callAction, OperationError } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { getPool } from "../lib/auth";
import { requireWorkspace } from "../lib/workspace";

/**
 * Renaming the current workspace (screen S-36 covers this properly at P2-T08).
 *
 * This exists to wire the action contract registry's typed client into the
 * application, which is a P1-T07 deliverable. Everything the write needs —
 * validation, authorisation, the audit row, the activity row and the outbox
 * row — comes from calling one registry action. The page knows none of it.
 */

async function rename(formData: FormData): Promise<void> {
  "use server";

  const { session, workspace } = await requireWorkspace();

  try {
    await callAction(
      {
        pool: getPool(),
        workspaceId: workspace.workspaceId,
        actor: { kind: "human", userId: session.user.id },
      },
      "workspace.rename",
      { name: String(formData.get("name") ?? "") },
    );
  } catch (error) {
    // A refusal is a normal outcome, not a crash. The real error surface
    // arrives with the design system at P2-T10; until then, failing quietly
    // beats rendering a stack trace at somebody.
    if (!(error instanceof OperationError)) {
      throw error;
    }
    return;
  }

  revalidatePath("/");
}

export function RenameWorkspace({ name }: { name: string }) {
  return (
    <form action={rename}>
      <label htmlFor="workspace-name">Workspace name</label>{" "}
      <input
        id="workspace-name"
        name="name"
        defaultValue={name}
        maxLength={200}
        required
      />{" "}
      <button type="submit">Rename</button>
    </form>
  );
}
