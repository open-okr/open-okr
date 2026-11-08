/**
 * Stopping the bill when a workspace closes (docs/design/workspace-erasure.md §3).
 *
 * Runs from the outbox row the closing Operation wrote, so a closure that rolled
 * back asks nothing of the provider, and a provider that does not answer is asked
 * again until it does. Nothing is refunded: the period already paid for runs out.
 */
import { activeOnly, billingAccounts, withWorkspace } from "@openokr/db";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";

/** The calls closing and erasing need, satisfied by the adapters' Billing port. */
export interface SubscriptionEnder {
  readonly provider: string;
  endSubscription(ref: string): Promise<void>;
  /** Erasure's: removes the customer, their cards and address. */
  deleteCustomer(ref: string): Promise<void>;
}

/** Over already, so there is nothing to stop. */
const ENDED = new Set(["canceled", "unpaid", "incomplete_expired"]);

/**
 * Asks the provider to stop renewing this workspace's subscription. Returns what
 * it did, or why it did nothing, for the relay's log.
 */
export async function endSubscriptionOnClosing(
  pool: Pool,
  workspaceId: string,
  billing: Pick<SubscriptionEnder, "provider" | "endSubscription"> | null,
): Promise<"ended" | string> {
  const [account] = await withWorkspace(drizzle(pool), workspaceId, (tx) =>
    tx
      .select({
        provider: billingAccounts.provider,
        subscriptionRef: billingAccounts.subscriptionRef,
        status: billingAccounts.status,
      })
      .from(billingAccounts)
      .where(
        activeOnly(
          billingAccounts,
          eq(billingAccounts.workspaceId, workspaceId),
        ),
      )
      .limit(1),
  );
  if (!account?.subscriptionRef) {
    return "the workspace has no subscription";
  }
  if (account.status && ENDED.has(account.status)) {
    return "the subscription has already ended";
  }
  if (!billing || billing.provider !== account.provider) {
    // Recorded rather than retried: a provider turned off since is a setup to
    // fix, and the operator console still shows the subscription.
    return `no ${account.provider} billing is configured to stop it`;
  }
  await billing.endSubscription(account.subscriptionRef);
  return "ended";
}
