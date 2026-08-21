/**
 * The drafting capability, declared here and implemented elsewhere (P4-T05c-b).
 *
 * **Why an interface in `packages/core` rather than a provider call.** Drafting
 * needs a model, a model needs a driver, and every vendor driver lives in
 * `packages/adapters`, which `packages/core` may not import. The Champion's run
 * is an action, and actions live here. So core states the shape of the
 * capability and the host supplies it, exactly as it already does for the key
 * ring on `ActionCallContext`.
 *
 * **Absent means the provider is off, and that is the normal case.** Every
 * trigger, ladder, gate and corridor works without a drafter; it adds language
 * to a proposal and never decides that the proposal should exist. A run with no
 * drafter proposes the same changes, worded by the method rather than by a
 * model. CLAUDE.md's "deterministic first" is this interface being optional.
 *
 * "Drafter" covers everything a model does for the agents, which is writing
 * language and reading meaning. Nothing here throws on a model that misbehaves. Each method returns null when
 * it cannot produce something the schema accepts, and the caller carries on with
 * the deterministic answer: a proposal a human still reviews is worth more than
 * a run that fell over.
 */
import type { RichTextDocument } from "../rich-text/schema.ts";

/** What a drafted check-in offers, in the shape `goals.publishDraftedCheckIn` takes. */
export interface DraftedCheckIn {
  readonly status: "on_track" | "caution" | "off_track";
  /** 0 to 1, in §3.2's own scale. */
  readonly confidence: number;
  readonly narrative: RichTextDocument;
}

/** What the drafter is told about a goal whose check-in is overdue. */
export interface CheckInDraftContext {
  readonly goalTitle: string;
  readonly daysOverdue: number;
  /** The last published status, or null when this is the first check-in. */
  readonly previousStatus: string | null;
  /** Each key result, with how far along it is. */
  readonly keyResults: readonly {
    readonly title: string;
    readonly progressPct: number;
  }[];
}

/**
 * One goal, as a model is allowed to see it.
 *
 * Given to `reviewAlignment` in a list, and referred to **by index**. A model
 * is never shown or asked for an identifier: it cannot invent an index that
 * points at a goal in another workspace, and an index out of range is dropped
 * rather than resolved. That is the whole reason findings come back positional.
 */
export interface ReviewableGoal {
  readonly title: string;
  /** Plain text, already extracted from the editor document. */
  readonly description: string;
  readonly level: string;
  /** The space's name, or null for a workspace-level goal. */
  readonly spaceName: string | null;
  /** The index of this goal's parent in the same list, when it has one here. */
  readonly parentIndex: number | null;
  readonly keyResultTitles: readonly string[];
}

/** A §5.3 finding, positional so no identifier ever comes from a model. */
export interface SemanticFinding {
  readonly kind: "relink" | "dependency" | "conflict" | "gap";
  readonly subjectIndex: number;
  /** The second goal, for the kinds that involve one. Null for a gap. */
  readonly targetIndex: number | null;
  readonly severity: "high" | "medium" | "low";
  /** One specific sentence, as §5.3 requires. */
  readonly reason: string;
}

/** What the assist is asked to fix, and what it is judged against afterwards. */
export interface RewriteContext {
  /** The sentence as written today. */
  readonly text: string;
  /** The check it fails, by its §4 id, with the catalogue's own prompt. */
  readonly ruleId: string;
  readonly rulePrompt: string;
  /** The objective it belongs to, so a rewrite stays about the right thing. */
  readonly goalTitle: string;
}

export interface RecoveryTitleContext {
  readonly kpiTitle: string;
  /** The template title §6.5 would produce, which is the fallback. */
  readonly templateTitle: string;
  readonly achievementPct: number | null;
}

/**
 * What a host must provide for the agents to write language.
 *
 * **Every capability is optional and every one may answer null.** A host may
 * implement drafting and not review, and a capability that is missing is the
 * same to a caller as one that declined: the deterministic answer stands. That
 * shape was learned the hard way, by adding a third method and breaking every
 * stand-in that implemented the first two.
 */
export interface AgentDrafter {
  /** A check-in a champion can read, correct and publish. Null to propose none. */
  draftCheckIn?(context: CheckInDraftContext): Promise<DraftedCheckIn | null>;
  /**
   * A better sentence for a recovery objective than the §6.5 template.
   *
   * Null falls back to the template, which is not a degraded outcome: the
   * template is what P3-T14 golden-master tested and what the deterministic
   * path has always used.
   */
  refineRecoveryTitle?(context: RecoveryTitleContext): Promise<string | null>;
  /**
   * METHOD.md §5.3's semantic review over a set of goals.
   *
   * Null when there is nothing to say or nothing could be said. An empty array
   * is different and means the model read them and found nothing, which is a
   * real answer that clears any finding still open.
   */
  reviewAlignment?(
    goals: readonly ReviewableGoal[],
  ): Promise<readonly SemanticFinding[] | null>;
  /**
   * A corrected sentence for one failing check.
   *
   * The text only. **Whether it actually satisfies the rule is not the model's
   * to claim**: the caller re-runs §4's own checks over what comes back and
   * reports what genuinely passes, so an assist cannot talk its way past a
   * rule it did not fix.
   */
  rewriteForRule?(context: RewriteContext): Promise<string | null>;
  /** Dollars spent so far, for the run row and the §4.14 cap. */
  spentUsd(): number;
}
