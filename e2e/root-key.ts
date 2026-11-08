/**
 * The root key both end-to-end servers run under.
 *
 * Fixed rather than generated, so a restart mid-run does not orphan anything
 * sealed before it. Production refuses to run without one; this is not
 * production.
 *
 * **One module, because two readers need the same value.** `playwright.config.ts`
 * hands it to the servers, and `hosting.ts` seals a payment provider's keys under
 * it, the way an operator's are stored, so the server can open them. Two copies
 * of the literal would agree only until somebody changed one.
 */
export const E2E_ENCRYPTION_KEY =
  "5UB2Ez1oQ0Rr8sT1n5x7yWl4qKcM9vHfJbGdApXeZi0=";
