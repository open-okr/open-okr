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
  whatsAppDeliveryId,
  whatsAppPhoneNumberId,
} from "@openokr/adapters";
import {
  openConnection,
  parseWhatsAppSecret,
  workspaceForProviderTeam,
} from "@openokr/core";
import type { NextRequest } from "next/server";
import { runInbound } from "../../../../lib/channel-inbound";
import { getPool } from "../../../../lib/pool";
import { getKeyRing } from "../../../../lib/secrets";

export const dynamic = "force-dynamic";

/** Refused, and never says why: a body would confirm the endpoint exists. */
const refused = (): Response => new Response(null, { status: 403 });

/**
 * Meta's subscription handshake.
 *
 * The number is on the query string, put there by whoever configured the
 * webhook, because the handshake carries no body to read it from. A caller who
 * guesses a number they do not have a token for gets the same 403 as a caller
 * who guesses nothing, so nothing here confirms which numbers this instance
 * knows.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const parameters = request.nextUrl.searchParams;
  const phoneNumberId = parameters.get("phone_number_id") ?? "";
  if (phoneNumberId === "") {
    return refused();
  }

  const workspaceId = await workspaceForProviderTeam(getPool(), {
    provider: "whatsapp",
    teamId: phoneNumberId,
  });
  if (!workspaceId) {
    return refused();
  }

  const connection = await openConnection(getPool(), getKeyRing(), {
    workspaceId,
    provider: "whatsapp",
  });
  const secret = connection ? parseWhatsAppSecret(connection.secret) : null;
  if (!secret) {
    return refused();
  }

  const challenge = verifySubscription(parameters, secret.verifyToken);
  return challenge === null
    ? refused()
    : new Response(challenge, {
        status: 200,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
}

export async function POST(request: NextRequest): Promise<Response> {
  return runInbound(request, {
    provider: "whatsapp",
    resolveWorkspace({ rawBody }) {
      const number = whatsAppPhoneNumberId(rawBody);
      return number
        ? workspaceForProviderTeam(getPool(), {
            provider: "whatsapp",
            teamId: number,
          })
        : Promise.resolve(null);
    },
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
    deliveryId: ({ rawBody }) => whatsAppDeliveryId(rawBody),
  });
}
