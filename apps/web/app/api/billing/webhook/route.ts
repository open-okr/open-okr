import { BillingSignatureError, createBilling } from "@openokr/adapters";
import { applyBillingEvent, resolveBillingSettings } from "@openokr/core";
import type { NextRequest } from "next/server";
import { getPool } from "../../../../lib/pool";
import { getKeyRing } from "../../../../lib/secrets";

export const dynamic = "force-dynamic";

/**
 * The payment provider's webhook (docs/design/billing.md §5).
 *
 * **The signature comes first**, before anything is read or written. With billing
 * off this route does not exist. A failure after the signature, such as Stripe not
 * answering when asked for the subscription, is a 500 on purpose: Stripe retries, and
 * nothing was recorded, so the retry applies it.
 */
export async function POST(request: NextRequest): Promise<Response> {
  const settings = await resolveBillingSettings(getPool(), getKeyRing());
  if (settings.provider === "none") {
    return new Response(null, { status: 404 });
  }
  const billing = await createBilling(settings);
  const body = await request.text();

  let event: Awaited<ReturnType<typeof billing.parseWebhook>>;
  try {
    event = await billing.parseWebhook(
      body,
      request.headers.get("stripe-signature") ?? "",
    );
  } catch (error) {
    if (error instanceof BillingSignatureError) {
      return new Response(null, { status: 400 });
    }
    throw error;
  }

  await applyBillingEvent(getPool(), billing, event);
  return new Response(null, { status: 200 });
}
