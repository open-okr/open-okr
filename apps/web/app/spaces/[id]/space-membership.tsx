import { callAction, OperationError } from "@openokr/core";
import { Button } from "@openokr/ui";
import { revalidatePath } from "next/cache";
import { getPool } from "../../../lib/auth";
import { requireWorkspace } from "../../../lib/workspace";

/**
 * Join and leave (P3-T01).
 *
 * A server action per direction rather than one with a mode flag: the two are
 * different writes with different refusals, and the registry declares them
 * separately for exactly that reason. Both go through the action contract, so
 * the audit row, the activity row and the access rebinding all happen without
 * this file knowing they exist.
 */

async function join(formData: FormData): Promise<void> {
  "use server";

  const spaceId = String(formData.get("spaceId") ?? "");
  const { session, workspace } = await requireWorkspace();

  try {
    await callAction(
      {
        pool: getPool(),
        workspaceId: workspace.workspaceId,
        actor: { kind: "human", userId: session.user.id },
      },
      "spaces.join",
      { spaceId },
    );
  } catch (error) {
    // A refusal is a normal outcome. The error surface for one belongs to the
    // goal surfaces at P3-T10, which is where a member first meets a write that
    // can fail for a reason worth explaining.
    if (!(error instanceof OperationError)) {
      throw error;
    }
    return;
  }

  revalidatePath(`/spaces/${spaceId}`);
  revalidatePath("/spaces");
}

async function leave(formData: FormData): Promise<void> {
  "use server";

  const spaceId = String(formData.get("spaceId") ?? "");
  const { session, workspace } = await requireWorkspace();

  try {
    await callAction(
      {
        pool: getPool(),
        workspaceId: workspace.workspaceId,
        actor: { kind: "human", userId: session.user.id },
      },
      "spaces.leave",
      { spaceId },
    );
  } catch (error) {
    if (!(error instanceof OperationError)) {
      throw error;
    }
    return;
  }

  revalidatePath(`/spaces/${spaceId}`);
  revalidatePath("/spaces");
}

export function SpaceMembership({
  spaceId,
  ownRole,
}: {
  readonly spaceId: string;
  readonly ownRole: "member" | "manager" | "coordinator" | null;
}) {
  if (!ownRole) {
    return (
      <form action={join} className="flex items-center gap-3">
        <input type="hidden" name="spaceId" value={spaceId} />
        <p className="text-sm text-ink-3">You are not in this space.</p>
        <Button type="submit">Join</Button>
      </form>
    );
  }

  return (
    <form action={leave} className="flex items-center gap-3">
      <input type="hidden" name="spaceId" value={spaceId} />
      <p className="text-sm text-ink-3">
        You are in this space as {ownRole}.
        {ownRole === "manager"
          ? " Appoint another manager before you leave."
          : ""}
      </p>
      <Button type="submit" variant="ghost">
        Leave
      </Button>
    </form>
  );
}
