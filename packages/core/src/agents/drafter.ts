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
 * Nothing here throws on a model that misbehaves. Each method returns null when
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

export interface RecoveryTitleContext {
  readonly kpiTitle: string;
  /** The template title §6.5 would produce, which is the fallback. */
  readonly templateTitle: string;
  readonly achievementPct: number | null;
}

/**
 * What a host must provide for the agents to write language.
 *
 * Both methods may return null, and both are expected to: a provider that is
 * off, a budget that is spent, or output the schema refused twice all end here.
 */
export interface AgentDrafter {
  /** A check-in a champion can read, correct and publish. Null to propose none. */
  draftCheckIn(context: CheckInDraftContext): Promise<DraftedCheckIn | null>;
  /**
   * A better sentence for a recovery objective than the §6.5 template.
   *
   * Null falls back to the template, which is not a degraded outcome: the
   * template is what P3-T14 golden-master tested and what the deterministic
   * path has always used.
   */
  refineRecoveryTitle(context: RecoveryTitleContext): Promise<string | null>;
  /** Dollars spent so far, for the run row and the §4.14 cap. */
  spentUsd(): number;
}
