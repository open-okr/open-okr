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
 * One retrieved passage, as a model is allowed to see it.
 *
 * Given to `answerGrounded` in a list and referred to **by index**, for the same
 * reason `ReviewableGoal` is: a model is never shown an identifier, so it cannot
 * invent a citation that points at something in another workspace, and an index
 * out of range is dropped rather than resolved. That is the structural half of
 * "a citation never points at something the viewer cannot read". The other half
 * is read time, where the reader's access is checked again.
 */
export interface GroundingSource {
  /** A short name for the passage, for the model's own prose. Never an id. */
  readonly label: string;
  /** The passage itself, already access-filtered by retrieval. */
  readonly content: string;
}

/** What the copilot is asked, and what it is allowed to read while answering. */
export interface GroundedQuestionContext {
  readonly question: string;
  /** Earlier turns in this thread, oldest first, so a follow-up makes sense. */
  readonly history: readonly {
    readonly role: "member" | "assistant";
    readonly content: string;
  }[];
  /** What retrieval found. An empty list means answer from nothing. */
  readonly sources: readonly GroundingSource[];
}

/** A grounded answer, with what it actually used and what it cost. */
export interface GroundedAnswer {
  readonly text: string;
  /**
   * Which sources the answer used, by index into `sources`.
   *
   * The claim is the model's; whether the reader may see what it points at is
   * not. Out-of-range indexes are dropped by the caller.
   */
  readonly usedSourceIndexes: readonly number[];
  readonly model?: string;
  readonly tokensIn?: number;
  readonly tokensOut?: number;
  /** What the call cost, when the host can price the model it used. */
  readonly costUsd?: number;
}

/**
 * One piece of an answer arriving (P4-T14a-b).
 *
 * A discriminated union rather than a stream of plain strings, because a reader
 * needs the words as they arrive and the product needs the finished answer's
 * citations and cost, and neither can be recovered from the other. The `done`
 * chunk carries the assembled `GroundedAnswer`, so the caller records the same
 * thing it would have recorded had it not streamed at all.
 *
 * **A stream that stops carries no `done`.** That is what tells the caller the
 * reader interrupted it: what arrived is recorded, marked as stopped, with no
 * citations, because the model never said which sources its unfinished sentence
 * rested on.
 */
export type GroundedChunk =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "done"; readonly answer: GroundedAnswer };

/**
 * One action the copilot is allowed to propose, as the model is shown it.
 *
 * `choices` holds numbered lists of **labels only**. No identifier reaches the
 * model, so a choice it makes can only be one it was shown, and a number out of
 * range resolves to nothing rather than to somebody else's space. Same rule as
 * the citation indexes, for the same reason.
 */
export interface ProposalOption {
  readonly action: string;
  readonly label: string;
  readonly whatItDoes: string;
  /** JSON Schema for the fields the model may author. */
  readonly fields: Record<string, unknown>;
  /** Numbered from one in the order given. */
  readonly choices: Readonly<Record<string, readonly string[]>>;
}

/** What the copilot is asked to turn into a proposal. */
export interface ProposalRequestContext {
  /** What the member asked for, in their words. */
  readonly request: string;
  readonly options: readonly ProposalOption[];
  /** What retrieval found, so a proposal can build on what is already there. */
  readonly sources: readonly GroundingSource[];
}

/**
 * A proposal, as the model may express one.
 *
 * The action name has to be one of the options it was given, and the fields are
 * validated against that option's own schema before anything is stored. A model
 * that names an action outside the list, or writes a field the schema refuses,
 * produces no proposal rather than a rejected one.
 */
export interface ProposedAction {
  readonly action: string;
  readonly fields: Record<string, unknown>;
  /** One sentence for the reviewer: why this, now. */
  readonly why: string;
}

/**
 * A key result as an assist may draft one (AI-NATIVE-PLAN.md §2.1, P4-T15a).
 *
 * Numbers included, because a key result without a baseline and a target fails
 * METHOD.md KR-3 and an assist that produced one would be making more work
 * rather than less. Whether they are any good is not the model's claim to make:
 * the caller runs §4's own checks over what comes back and reports what
 * genuinely passes, the same way the rewrite assist does.
 */
export interface DraftedKeyResult {
  readonly title: string;
  readonly unit: string | null;
  readonly direction: "increase" | "reduce" | "maintain" | "move";
  readonly indicatorType: "leading" | "lagging";
  readonly baseline: number;
  readonly target: number;
}

/** An objective drafted from an ambition, with the measures under it. */
export interface DraftedObjective {
  readonly title: string;
  /** Plain text. The editor document is assembled by the caller. */
  readonly description: string;
  readonly keyResults: readonly DraftedKeyResult[];
}

/** What the drafting assist is told about the ambition it is turning over. */
export interface AmbitionContext {
  /** What somebody typed, in their words. */
  readonly ambition: string;
  /** The space it would belong to, for tone. Null at workspace level. */
  readonly spaceName: string | null;
  /** Objectives already in this cycle, so a draft does not repeat one. */
  readonly existingTitles: readonly string[];
}

/** What the measure assist is asked to put numbers on. */
export interface MeasureContext {
  readonly keyResultTitle: string;
  readonly goalTitle: string;
  /** The unit already chosen, when there is one. */
  readonly unit: string | null;
}

/**
 * A parent suggested by meaning, positional (P4-T15a).
 *
 * `candidateIndex` points into the list the caller supplied, which it built
 * from goals this member may actually read. So the suggestion is safe by
 * construction: there is no index that resolves to a goal they cannot see.
 */
export interface SuggestedParent {
  readonly candidateIndex: number;
  /** One specific sentence about why this parent, for the reader to judge. */
  readonly reason: string;
}

/** What the alignment assist is shown: one child and the possible parents. */
export interface ParentContext {
  readonly childTitle: string;
  readonly childDescription: string;
  /** Numbered from one in the order given. Never an identifier. */
  readonly candidates: readonly {
    readonly title: string;
    readonly level: string;
  }[];
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
  /**
   * AI-NATIVE-PLAN.md §2.4's grounded answer over retrieved passages.
   *
   * Null when the model would rather say nothing, which is not a failure: §2.4's
   * own degradation is full-text search, so a caller that gets null shows the
   * passages retrieval found and no prose. That is a smaller answer, not a
   * broken one, and it is what a provider-off workspace gets every time.
   */
  answerGrounded?(
    context: GroundedQuestionContext,
  ): Promise<GroundedAnswer | null>;
  /**
   * The same answer, arriving as it is written (P4-T14a-b).
   *
   * Optional beside `answerGrounded` rather than replacing it: a provider or a
   * model without streaming still answers, and a caller that cannot stream (a
   * chat command, an external agent asking once) wants the whole thing anyway.
   * A host that implements one and not the other is a host with one fewer
   * surface, not a broken one.
   */
  streamGrounded?(
    context: GroundedQuestionContext,
    signal?: AbortSignal,
  ): AsyncIterable<GroundedChunk>;
  /**
   * A proposal from a request, chosen from a curated list (P4-T14b-a).
   *
   * Null when the request does not match anything on the list, which is the
   * common case and not a failure: most questions are questions. A copilot that
   * proposed something for every sentence would be a copilot nobody trusts with
   * the apply button.
   */
  proposeAction?(
    context: ProposalRequestContext,
  ): Promise<ProposedAction | null>;
  /**
   * §2.1's objective draft, from a plain-language ambition.
   *
   * Null when there is nothing to draft, which includes an ambition that is
   * already an objective. The caller judges what comes back against §4 and
   * shows the reader which checks it passes, so a confident draft that fails
   * OBJ-1 is presented as failing OBJ-1.
   */
  draftObjective?(context: AmbitionContext): Promise<DraftedObjective | null>;
  /** §2.1's measure suggestion: a unit, a direction, a baseline and a target. */
  suggestMeasure?(
    context: MeasureContext,
  ): Promise<Omit<DraftedKeyResult, "title"> | null>;
  /**
   * §2.1's alignment suggestion, positional.
   *
   * Null when none of the candidates is a plausible parent, which is a real
   * answer: an objective with no parent is often correct, and inventing one is
   * how an alignment tree becomes a decoration.
   */
  suggestParent?(context: ParentContext): Promise<SuggestedParent | null>;
  /** Dollars spent so far, for the run row and the §4.14 cap. */
  spentUsd(): number;
}
