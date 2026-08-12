/**
 * The activity table's own context resolution (TECHNICAL-PLAN §4.11,
 * P2-T07): "an access-scope context set by the fail-closed resolver."
 *
 * `resolveSubjectContext` (P2-T02) is fail-closed the way an access check
 * has to be: an unregistered subject type raises, because silently
 * granting access would be the dangerous direction to be wrong in. Filling
 * in an activity's `context_id` is not an access check, and raising here
 * would take down the whole write the activity is riding alongside over a
 * feed column. This wraps it the other way: an unresolvable context
 * resolves to `undefined` rather than throwing, and an activity with no
 * context is invisible to every context-filtered feed query rather than
 * wrongly visible to one it should not reach — still fail-closed, just
 * failing towards "not shown" instead of "operation aborted".
 */
import type { WorkspaceTx } from "@openokr/db";
import { resolveSubjectContext } from "../access/reads.ts";

type AnyTx<TSchema extends Record<string, unknown> = Record<string, never>> =
  WorkspaceTx<TSchema>;

export async function resolveActivityContext<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  workspaceId: string,
  subjectType: string,
  subjectId: string,
): Promise<string | undefined> {
  try {
    const context = await resolveSubjectContext(
      tx,
      subjectType,
      subjectId,
      workspaceId,
    );
    return context?.contextId;
  } catch {
    return undefined;
  }
}
