/**
 * METHOD.md §5.3's semantic review (P4-T06b-b).
 *
 * §5.2 asks whether the tree is wired correctly and answers from structure
 * alone. §5.3 asks a different question that structure cannot reach: two goals
 * can be perfectly wired and still pull against each other. Answering it means
 * reading what the goals say, which is why this is the one part of the Coach
 * that needs a provider and the one trigger in §6.4's catalogue marked as not
 * deterministic.
 *
 * **A model is never shown an identifier and never asked for one.** The goals go
 * out as a list and findings come back as indices into that list, so a model
 * cannot name a goal in another workspace, cannot invent a uuid, and an index
 * out of range is dropped rather than resolved. Everything a model returns is
 * untrusted input, and the cheapest way to keep it harmless is to give it
 * nothing dangerous to say.
 *
 * **With no provider this writes nothing, and clears nothing.** Absent is not
 * the same as "the model read them and found nothing": the first leaves
 * yesterday's findings where they are, the second retires them. A workspace
 * that turns AI off keeps the findings it already had rather than watching them
 * vanish.
 */
import { activeOnly, goals, keyResults, spaces } from "@openokr/db";
import { eq, isNull } from "drizzle-orm";
import type { AgentDrafter, ReviewableGoal } from "../agents/drafter.ts";
import type { OperationTx } from "../operations/operation.ts";
import { excerptRichText } from "../rich-text/excerpt.ts";
import { reconcileFindingsInTx, type WantedFinding } from "./service.ts";

/** The four §5.3 types, reconciled one slice at a time. */
const SEMANTIC_KINDS = ["relink", "dependency", "conflict", "gap"] as const;

export interface SemanticSweepResult {
  readonly examined: number;
  readonly found: number;
  /** True when no provider was available, so nothing was read or retired. */
  readonly skipped: boolean;
}

/**
 * Reviews one cycle's goals and reconciles §5.3's four finding kinds.
 *
 * Workspace scope, like the divergence sweep and for the same reason: a
 * conflict between two spaces belongs to neither, and writing it into both
 * slices would show it twice and need two dismissals for one decision. That is
 * also what makes the acceptance criterion true, because one row dismissed on
 * either side is dismissed for both.
 */
export async function sweepSemanticInTx(
  tx: OperationTx,
  input: {
    readonly workspaceId: string;
    readonly cycleId: string;
    readonly drafter?: AgentDrafter;
  },
): Promise<SemanticSweepResult> {
  if (!input.drafter) {
    return { examined: 0, found: 0, skipped: true };
  }

  const rows = await tx
    .select({
      id: goals.id,
      title: goals.title,
      description: goals.description,
      level: goals.level,
      spaceId: goals.spaceId,
      parentGoalId: goals.parentGoalId,
    })
    .from(goals)
    .where(
      activeOnly(
        goals,
        eq(goals.workspaceId, input.workspaceId),
        eq(goals.cycleId, input.cycleId),
        isNull(goals.closedAt),
      ),
    );

  // One goal cannot conflict with itself, and a review of one goal is what the
  // Draft Coach already does inline as somebody types.
  if (rows.length < 2) {
    return { examined: rows.length, found: 0, skipped: false };
  }

  const spaceNames = new Map<string, string>();
  for (const space of await tx
    .select({ id: spaces.id, name: spaces.name })
    // openokr:allow-raw-read: names only, the same read and the same reason as
    // the register card in `actions/alignment.ts`. Every human member holds
    // `view` on every space through P3-T01's `workspace_standard` binding, so a
    // name discloses nothing the spaces list does not, and a sweep has no
    // acting member to scope the getter by. A model told "Sales" rather than a
    // uuid is also the point: it is describing goals, not addressing them.
    .from(spaces)
    .where(activeOnly(spaces, eq(spaces.workspaceId, input.workspaceId)))) {
    spaceNames.set(space.id, space.name);
  }

  const indexOf = new Map(rows.map((row, index) => [row.id, index]));
  const reviewable: ReviewableGoal[] = [];
  for (const row of rows) {
    const measures = await tx
      .select({ title: keyResults.title })
      .from(keyResults)
      .where(activeOnly(keyResults, eq(keyResults.goalId, row.id)));
    reviewable.push({
      title: row.title,
      // Plain text through the one shared module, never the editor document:
      // a model has no use for marks and every reason not to see attributes or
      // mention ids. Bounded too, because a long description from every goal
      // in a cycle is the input that makes a review cost real money.
      description: row.description
        ? excerptRichText(row.description as never, 400)
        : "",
      level: row.level,
      spaceName: row.spaceId ? (spaceNames.get(row.spaceId) ?? null) : null,
      parentIndex:
        row.parentGoalId !== null
          ? (indexOf.get(row.parentGoalId) ?? null)
          : null,
      keyResultTitles: measures.map((measure) => measure.title),
    });
  }

  const findings = await input.drafter.reviewAlignment(reviewable);
  if (findings === null) {
    // The model could not answer. Distinct from an empty list, and treated the
    // same as having no provider: yesterday's findings stay.
    return { examined: rows.length, found: 0, skipped: true };
  }

  const byKind = new Map<string, WantedFinding[]>(
    SEMANTIC_KINDS.map((kind) => [kind, []]),
  );

  for (const finding of findings) {
    const subject = rows[finding.subjectIndex];
    // Out of range is dropped without comment. A model pointing past the end of
    // the list it was given has said nothing about any goal that exists.
    if (!subject) {
      continue;
    }
    const target =
      finding.targetIndex === null ? null : rows[finding.targetIndex];
    if (finding.targetIndex !== null && !target) {
      continue;
    }
    // A finding about a goal and itself is not a finding.
    if (target && target.id === subject.id) {
      continue;
    }
    byKind.get(finding.kind)?.push({
      // §6.4's key for a semantic conflict. The other three kinds carry no
      // trigger of their own: they appear in the findings list rather than as
      // a message, so they carry no rule key rather than borrowing one.
      ruleKey: finding.kind === "conflict" ? "quality.conflict" : "",
      subjectGoalId: subject.id,
      targetGoalId: target?.id ?? null,
      severity: finding.severity,
      reason: finding.reason,
    });
  }

  let found = 0;
  for (const kind of SEMANTIC_KINDS) {
    const wanted = byKind.get(kind) ?? [];
    found += wanted.length;
    await reconcileFindingsInTx(tx, {
      workspaceId: input.workspaceId,
      cycleId: input.cycleId,
      scope: "workspace",
      scopeId: null,
      source: "coach",
      kind,
      wanted,
    });
  }

  return { examined: rows.length, found, skipped: false };
}
