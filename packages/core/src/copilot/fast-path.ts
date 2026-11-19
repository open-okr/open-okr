/**
 * Narrow fast path for anchored single-record copilot questions (docs/design/copilot-first-word.md).
 *
 * Bypasses model tool selection for a first-turn read-only question anchored to
 * an objective, KPI, initiative or task when the scoped anchor read succeeded
 * and contains the requested fact.
 */

const MUTATION_PATTERN =
  /\b(propose|create|add|make|new|update|change|set|edit|delete|remove|check\s*in|assign|draft|submit|cadang|cadangkan|buat|tambah|baharu|baru|kemaskini|ubah|tetap|tetapkan|padam|buang|semak|semakan|tugaskan|draf|hantar)\b/i;

const MULTI_OR_COMPARATIVE_PATTERN =
  /\b(other|another|compare|comparison|versus|vs|all|list|every|both|across|lain|banding|bandingkan|semua|senarai|senaraikan|setiap|kedua|merentasi)\b/i;

interface FieldRule {
  readonly pattern: RegExp;
  readonly factRequired?: RegExp;
}

const FIELD_RULES: readonly FieldRule[] = [
  // Health / status
  {
    pattern: /\b(health|status|condition|kesihatan|status)\b/i,
    factRequired:
      /(status|health):|di landasan|on_track|at_risk|behind|done|in_progress|todo|backlog/i,
  },
  // Champion / Owner / Assignee / Reviewer
  {
    pattern:
      /\b(champion|owner|assignee|reviewer|juara|pemilik|penerima tugas|penyemak)\b/i,
    factRequired: /(champion|owner|assignee|assignees|reviewer):/i,
  },
  // Values / Target / Progress (KPI / KR)
  {
    pattern:
      /\b(current value|latest value|target value|baseline value|target|progress|nilai semasa|nilai terkini|nilai sasaran|sasaran|garis dasar|kemajuan)\b/i,
    factRequired:
      /(currentValue|targetValue|baselineValue|progress|value|target):|\d+/i,
  },
  // Due date / Cycle
  {
    pattern:
      /\b(due date|due on|deadline|cycle|tarikh akhir|tarikh tamat|kitaran)\b/i,
    factRequired: /(dueOn|cycle):/i,
  },
  // Checklist (task)
  {
    pattern: /\b(checklist|senarai semak)\b/i,
    factRequired: /checklist:/i,
  },
  // Explicit short summary / overview
  {
    pattern:
      /\b(summar(y|ise|ize)|overview|ringkas|ringkasan|ringkaskan|gambaran keseluruhan)\b/i,
    // The anchor text itself is the summary fact
    factRequired: undefined,
  },
];

export interface FastPathCheckInput {
  readonly historyLength: number;
  readonly anchorKind: string | null;
  readonly anchorReadOutcome: string | null;
  readonly question: string;
  readonly anchorText?: string;
}

/**
 * Determines whether a question qualifies for the fast path.
 */
export function isEligibleForFastPath(input: FastPathCheckInput): boolean {
  // 1. Must be a first turn
  if (input.historyLength > 0) {
    return false;
  }

  // 2. Must be anchored to an objective, KPI, initiative or task
  if (
    !input.anchorKind ||
    !["goal", "kpi", "initiative", "task"].includes(input.anchorKind)
  ) {
    return false;
  }

  // 3. Anchor read must have succeeded and have content
  if (
    input.anchorReadOutcome !== "ok" ||
    !input.anchorText ||
    input.anchorText.trim().length === 0
  ) {
    return false;
  }

  const q = input.question.trim();
  if (q.length === 0) {
    return false;
  }

  // 4. Must be read-only: any mutation/proposal keyword disqualifies
  if (MUTATION_PATTERN.test(q)) {
    return false;
  }

  // 5. Must not be comparative or multi-record
  if (MULTI_OR_COMPARATIVE_PATTERN.test(q)) {
    return false;
  }

  // 6. Must explicitly request one field or a summary of this record
  for (const rule of FIELD_RULES) {
    if (rule.pattern.test(q)) {
      if (rule.factRequired === undefined) {
        return true;
      }
      if (rule.factRequired.test(input.anchorText)) {
        return true;
      }
    }
  }

  // Ambiguous prompts route to the current read loop
  return false;
}
