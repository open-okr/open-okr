/**
 * The built-in agents' sight of an item that belongs to no space
 * (completeness review H-04).
 *
 * The Champion and the Coach are bound to spaces, one view binding each, as
 * spaces are created. A company goal, an individual goal and a KPI that
 * belongs to no space had nothing an agent could be bound through, so once
 * their readers honoured bindings (`agents/scope.ts`) they would have stopped
 * seeing exactly the goals the whole company is working to. Each such item is
 * bound here, by name, as it is created: least privilege stays literal and
 * nothing the agents covered before goes dark.
 */
import type { WorkspaceTx } from "@openokr/db";
import { bindChampionToSpaceInTx } from "./champion.ts";
import { bindCoachToSpaceInTx } from "./coach.ts";

export async function bindAgentsToContextInTx<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: WorkspaceTx<TSchema>,
  input: { readonly workspaceId: string; readonly contextId: string },
): Promise<void> {
  // Named for spaces because spaces came first; each binds its agent's member
  // group at view on whatever context it is given, and a workspace whose agent
  // does not exist yet is not an error.
  await bindChampionToSpaceInTx(tx, input);
  await bindCoachToSpaceInTx(tx, input);
}
