/**
 * WhatsApp's inbound door (AI-NATIVE-PLAN.md §6, P5-T04a).
 *
 * **Two methods, and only one of them is a message.** Meta proves the endpoint
 * belongs to whoever configured it by asking it to echo a challenge on a GET,
 * before it will ever POST. That handshake carries no signature and no body, so
 * it cannot go through the shared inbound path: it is answered here, against the
 * verify token the administrator chose, compared in constant time.
 *
 * **The workspace comes from the business number.** One WhatsApp number belongs
 * to one workspace, the same arrangement Slack's team id and the Teams directory
 * tenant have, so the installation lookup is the existing one with a different
 * provider.
 *
 * Everything after that is `lib/channel-inbound.ts`: §6's order, the duplicate
 * check, identity resolution, the rate limit and the reply.
 */
import {
  verifySubscription,
  WhatsAppChannel,
  whatsAppBusinessAccountId,
  whatsAppDeliveryId,
  whatsAppPhoneNumberId,
} from "@openokr/adapters";
import {
  openConnection,
  parseWhatsAppSecret,
  rememberConnectionConfig,
  workspaceForProviderTeam,
} from "@openokr/core";
import type { NextRequest } from "next/server";
import { refuse, runInbound } from "../../../../lib/channel-inbound";
import { getPool } from "../../../../lib/pool";
import { getKeyRing } from "../../../../lib/secrets";

export const dynamic = "force-dynamic";

/**
 * Meta's subscription handshake.
 *
 * The number is on the query string, put there by whoever configured the
 * webhook, because the handshake carries no body to read it from. A caller who
 * guesses a number they do not have a token for gets the same 403 as a caller
 * who guesses nothing, so nothing here confirms which numbers this instance
 * knows. The same 403 in the same time, too (completeness review L-10): a
 * known number is refused only after a second read and a decryption, and the
 * shared refusal floor is what keeps that from showing.
 *
 * 403 rather than the POST's 401 because that is what Meta's own examples
 * answer a token that does not match with. Every refusal here is 403, so the
 * difference between the two methods says nothing about any number.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const startedAt = Date.now();
  const parameters = request.nextUrl.searchParams;
  const phoneNumberId = parameters.get("phone_number_id") ?? "";
  if (phoneNumberId === "") {
    return refuse("whatsapp", "no_tenant", startedAt, 403);
  }

  const workspaceId = await workspaceForProviderTeam(getPool(), {
    provider: "whatsapp",
    teamId: phoneNumberId,
  });
  if (!workspaceId) {
    return refuse("whatsapp", "unknown_tenant", startedAt, 403);
  }

  const connection = await openConnection(getPool(), getKeyRing(), {
    workspaceId,
    provider: "whatsapp",
  });
  const secret = connection ? parseWhatsAppSecret(connection.secret) : null;
  if (!secret) {
    return refuse("whatsapp", "no_connection", startedAt, 403);
  }

  const challenge = verifySubscription(parameters, secret.verifyToken);
  return challenge === null
    ? refuse("whatsapp", "failed_verification", startedAt, 403)
    : new Response(challenge, {
        status: 200,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
}

export async function POST(request: NextRequest): Promise<Response> {
  return runInbound(request, {
    provider: "whatsapp",
    tenantOf: ({ rawBody }) => whatsAppPhoneNumberId(rawBody),
    buildDriver(secret, config) {
      const parsed = parseWhatsAppSecret(secret);
      const phoneNumberId = config.teamId;
      if (!parsed || typeof phoneNumberId !== "string") {
        return null;
      }
      return new WhatsAppChannel({
        // The workspace's own business number, stored when the connection was
        // made. It is what a reply is sent *from*, and the body's copy of it is
        // only what routed the request here.
        phoneNumberId,
        accessToken: parsed.accessToken,
        appSecret: parsed.appSecret,
        // Resolved from the message on this path, never from a member: the
        // reply goes back to the number the message came from.
        numberFor: () => null,
      });
    },
    async remember({ rawBody, workspaceId }) {
      // The business account the template list is asked for, learned rather
      // than configured (P5-T04b-a). Recorded after verification, for the same
      // reason the Teams service URL is: taking it from an unverified body
      // would let a caller choose which account this workspace syncs from.
      const businessAccountId = whatsAppBusinessAccountId(rawBody);
      if (businessAccountId) {
        await rememberConnectionConfig(getPool(), {
          workspaceId,
          provider: "whatsapp",
          patch: { businessAccountId },
        });
      }
    },
    deliveryId: ({ rawBody }) => whatsAppDeliveryId(rawBody),
  });
}
