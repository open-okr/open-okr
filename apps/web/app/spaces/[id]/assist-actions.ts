"use server";

/**
 * The space home's assist (completeness review M-09).
 *
 * `blockers.summarise` was built at P4-T15b-b beside the board it summarises,
 * and the board reached the space home while the summary reached nothing. A
 * read that writes nothing, run as the reader, with the drafter the workspace
 * has or none.
 */
import { callAction } from "@openokr/core";
import { assistContext } from "../../../lib/assists";

/**
 * The board, summarised, or null.
 *
 * The board's order is the product's and the action returns it unchanged
 * beside the words; the surface keeps showing its own board and uses only the
 * prose.
 */
export async function summariseBlockersAction(spaceId: string) {
  return callAction(await assistContext(), "blockers.summarise", { spaceId });
}
