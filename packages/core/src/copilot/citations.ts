/**
 * Citations, resolved and filtered at the moment somebody reads them
 * (AI-NATIVE-PLAN.md §2.4, P4-T14a-a).
 *
 * **Why read time and not write time, when the sources were already filtered.**
 * Retrieval only ever hands the copilot passages the asker could read, so a
 * citation is safe the second it is stored. It does not stay safe. A member
 * leaves a space, a goal is deleted, a workspace suspends somebody: the stored
 * citation still points where it pointed, and the thread is still there to open.
 * So the stored row is the claim about what the answer used, and this module
 * decides what a reader is shown, every time, by asking `mayRead` again.
 *
 * A citation the reader may not read is **dropped, not marked**. "One source
 * withheld" is itself a fact about a thing they cannot see, and a count of
 * hidden goals in a space is worth guessing at.
 */
import type { AiCitation } from "@openokr/db";
import { mayRead } from "../embeddings/governing.ts";
import {
  embeddableTextInTx,
  isEmbeddableType,
} from "../embeddings/subjects.ts";
import type { OperationTx } from "../operations/operation.ts";

/** One citation a reader is allowed to see, with something to show for it. */
export interface ResolvedCitation {
  readonly entityType: string;
  readonly entityId: string;
  /** The entity's own first line, which is its title for everything that has one. */
  readonly label: string;
}

/** How much of an entity's text becomes its citation label. */
const LABEL_LENGTH = 120;

/**
 * The first line of an entity's embeddable text, shortened.
 *
 * Every embeddable type puts its title first, so the first line is the title
 * where there is one and the opening words of the prose where there is not. This
 * derives the label from the same function that produced the chunk rather than
 * querying eleven tables a second time for their titles.
 */
export function citationLabel(text: string): string {
  const firstLine = text.split("\n").find((line) => line.trim() !== "") ?? "";
  const trimmed = firstLine.trim();
  return trimmed.length <= LABEL_LENGTH
    ? trimmed
    : `${trimmed.slice(0, LABEL_LENGTH - 1).trimEnd()}…`;
}

/**
 * The citations on one message that this member may read, in the stored order.
 *
 * Order is the answer's own, because a citation list is read next to prose that
 * refers to them in sequence.
 */
export async function readableCitations(
  tx: OperationTx,
  input: {
    readonly workspaceId: string;
    readonly memberId: string;
    readonly citations: readonly AiCitation[];
  },
): Promise<ResolvedCitation[]> {
  const resolved: ResolvedCitation[] = [];
  for (const citation of input.citations) {
    // A type outside the embeddable set cannot be labelled and, by `mayRead`'s
    // own default, cannot be authorised either. Both answers are "not shown".
    if (!isEmbeddableType(citation.entityType)) {
      continue;
    }
    const readable = await mayRead(tx, {
      workspaceId: input.workspaceId,
      memberId: input.memberId,
      entityType: citation.entityType,
      entityId: citation.entityId,
    });
    if (!readable) {
      continue;
    }
    const text = await embeddableTextInTx(
      tx,
      input.workspaceId,
      citation.entityType,
      citation.entityId,
    );
    // Readable but empty means the entity is there with nothing left to quote.
    // Still a citation, with the type as its only label.
    resolved.push({
      entityType: citation.entityType,
      entityId: citation.entityId,
      label: text ? citationLabel(text) : "",
    });
  }
  return resolved;
}
