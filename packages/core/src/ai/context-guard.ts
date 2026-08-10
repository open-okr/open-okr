/**
 * The context-window guard (AI-NATIVE-PLAN.md §3.4, P2-T15): "blocks
 * oversized requests" before any call is made, not after a provider
 * rejects one. Pure, so a feature can check before spending a call, and a
 * test can prove it without a database or a real provider.
 */
export interface ContextWindowGuardInput {
  /** The caller's own token estimate for what it is about to send. */
  readonly estimatedTokens: number;
  readonly contextWindow: number;
  /** Headroom the reply itself needs. Defaults to a conservative slice of
   * the window rather than zero, since a request that exactly fills the
   * window leaves no room for a model to answer at all. */
  readonly reserveForCompletion?: number;
}

export interface ContextWindowGuardResult {
  readonly allowed: boolean;
  readonly reason?: string;
}

const DEFAULT_COMPLETION_RESERVE_RATIO = 0.1;

export function guardContextWindow(
  input: ContextWindowGuardInput,
): ContextWindowGuardResult {
  const reserve =
    input.reserveForCompletion ??
    Math.ceil(input.contextWindow * DEFAULT_COMPLETION_RESERVE_RATIO);
  const budget = input.contextWindow - reserve;

  if (input.estimatedTokens > budget) {
    return {
      allowed: false,
      reason:
        `This request is about ${input.estimatedTokens} tokens, which leaves ` +
        `no room for a reply within this model's ${input.contextWindow}-token ` +
        `context window (${reserve} reserved for the completion). Shorten the ` +
        `request or route this call to a model with a larger window.`,
    };
  }
  return { allowed: true };
}
