import { callAction, OperationError } from "@openokr/core";
import { Button, Card, CardBody, CardHeader } from "@openokr/ui";
import { revalidatePath } from "next/cache";
import { getPool } from "../../../lib/auth";
import { getTranslations } from "../../../lib/translations";
import { requireWorkspace } from "../../../lib/workspace";

/**
 * The workspace's own state (TECHNICAL-PLAN §4.1, P6-G25).
 *
 * **`workspace.setState` shipped at P2-T09 and no screen ever called it.** The
 * permission layer has collapsed a non-active workspace to view-only since the
 * same task, and `operations/freeze.ts` has kept this very action on the
 * recovery list so the switch survives its own freeze. What was missing was the
 * switch. P6-T07's rehearsal runbook asks an operator to freeze an instance and
 * lift it again, and there was nothing to press.
 *
 * **A form per state rather than a select and a save.** There are three, the
 * change is immediate and consequential, and a select that quietly held
 * "frozen" until somebody found the save button is the shape most likely to
 * freeze a workspace by accident. Each button says what it does and the current
 * one is not offered.
 *
 * **Reachable while frozen, which is the whole point.** `isRecoveryAction`
 * passes `workspace.setState` and everything under `settings.` and `people.`,
 * so an administrator who freezes the workspace can still reach this card and
 * lift it. A control that locked itself out would be worse than no control.
 */

// Each state names its whole sentence in the catalogue: what it is and what it
// means, then the button that moves to it. One message per sentence, so a
// translator never has to reassemble a label and a lowercased copy of it.
const STATES = [
  {
    value: "active",
    says: "admin.state.saysActive",
    moveTo: "admin.state.returnToActive",
  },
  {
    value: "read_only",
    says: "admin.state.saysReadOnly",
    moveTo: "admin.state.setToReadOnly",
  },
  {
    value: "frozen",
    says: "admin.state.saysFrozen",
    moveTo: "admin.state.setToFrozen",
  },
] as const;

async function setState(formData: FormData): Promise<void> {
  "use server";
  const { session, workspace } = await requireWorkspace();
  const state = String(formData.get("state") ?? "");
  if (state !== "active" && state !== "read_only" && state !== "frozen") {
    return;
  }

  try {
    await callAction(
      {
        pool: getPool(),
        workspaceId: workspace.workspaceId,
        actor: { kind: "human", userId: session.user.id },
      },
      "workspace.setState",
      { state },
    );
  } catch (error) {
    if (!(error instanceof OperationError)) {
      throw error;
    }
    return;
  }
  // The whole tree, not this page: the banner the shell renders is on every
  // screen, and a reader on another tab should not be told the workspace is
  // frozen by a save that fails.
  revalidatePath("/", "layout");
}

export async function WorkspaceStateCard({
  state,
}: {
  readonly state: "active" | "read_only" | "frozen";
}) {
  const current = STATES.find((one) => one.value === state);
  // The catalogue, from a server component (P6-G25). P6-G22b's gate had no
  // way to be satisfied here until `getTranslations` existed.
  const { t } = await getTranslations();

  return (
    <Card>
      <CardHeader>
        <div className="flex min-w-0 flex-col">
          <h2 className="text-sm font-bold text-ink">
            {t("admin.state.title")}
          </h2>
          <p className="text-xs text-ink-3">{t("admin.state.explains")}</p>
        </div>
      </CardHeader>
      <CardBody className="flex flex-col gap-3">
        <p className="text-sm text-ink-2" data-testid="workspace-state-current">
          {current ? t(current.says) : state}
        </p>
        <div className="flex flex-wrap gap-2.5">
          {STATES.filter((one) => one.value !== state).map((one) => (
            <form key={one.value} action={setState}>
              <input type="hidden" name="state" value={one.value} />
              <Button
                type="submit"
                size="sm"
                variant={one.value === "active" ? "primary" : "default"}
                data-testid={`set-state-${one.value}`}
              >
                {t(one.moveTo)}
              </Button>
            </form>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}
