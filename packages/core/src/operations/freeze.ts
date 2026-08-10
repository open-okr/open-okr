/**
 * The freeze overlay's recovery list (TECHNICAL-PLAN §4.1, §8.2, P2-T09).
 *
 * "When the workspace state is not active, the permission layer collapses
 * everything to view-only except an admin recovery list." Reads are
 * unaffected by construction: a read action never reaches `runOperation` at
 * all, only a write does. `read_only` and `frozen` are treated identically
 * here, because TECHNICAL-PLAN draws no distinction between them for this
 * check — both are simply "not active" — leaving whatever tells them apart
 * (who may set which, and why) to whichever task actually needs that
 * difference.
 *
 * The list itself is this task's own reading of "admins can still manage
 * members and settings" (IMPLEMENTATION-PLAN.md P2-T09's acceptance line),
 * not a TECHNICAL-PLAN enumeration — flagged in STATUS.md rather than
 * assumed uncontroversial. `workspace.setState` is on it on purpose: the
 * one write that must survive a freeze is the one that lifts it.
 */

const RECOVERY_ACTIONS: ReadonlySet<string> = new Set(["workspace.setState"]);

const RECOVERY_PREFIXES: readonly string[] = ["people.", "settings."];

export function isRecoveryAction(action: string): boolean {
  return (
    RECOVERY_ACTIONS.has(action) ||
    RECOVERY_PREFIXES.some((prefix) => action.startsWith(prefix))
  );
}
