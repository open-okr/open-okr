/**
 * Microsoft Teams' inbound door (AI-NATIVE-PLAN.md §6, P5-T03a).
 *
 * **One endpoint for every tenant, because the activity says which.** Slack puts
 * a team id on the payload and Telegram says nothing, so Telegram needs a path
 * per workspace. Teams carries the Azure directory tenant on every activity,
 * which is the same shape as Slack's and needs no path segment.
 *
 * **The service URL is recorded here and nowhere else.** There is no way to
 * discover where to send a Teams message: it arrives on inbound activities and
 * outbound has to use it. `remember` writes it onto the connection after the
 * activity has been verified, which is the only order that is safe: recording a
 * service URL from an unverified request would let a caller choose where this
 * instance sends its replies.
 *
 * Everything else is `lib/channel-inbound.ts`: §6's order, the duplicate check,
 * identity resolution, the rate limit and the reply.
 */
import {
  TeamsChannel,
  teamsDeliveryId,
  teamsServiceUrl,
  teamsTenantId,
} from "@openokr/adapters";
import {
  parseTeamsSecret,
  rememberConnectionConfig,
  workspaceForProviderTeam,
} from "@openokr/core";
import type { NextRequest } from "next/server";
import { runInbound } from "../../../../lib/channel-inbound";
import { getPool } from "../../../../lib/pool";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<Response> {
  return runInbound(request, {
    provider: "teams",
    resolveWorkspace({ rawBody }) {
      const tenant = teamsTenantId(rawBody);
      return tenant
        ? workspaceForProviderTeam(getPool(), {
            provider: "teams",
            teamId: tenant,
          })
        : Promise.resolve(null);
    },
    buildDriver(secret, config) {
      const parsed = parseTeamsSecret(secret);
      if (!parsed) {
        return null;
      }
      const serviceUrl = config.serviceUrl;
      return new TeamsChannel({
        appId: parsed.appId,
        appPassword: parsed.appPassword,
        ...(typeof serviceUrl === "string" ? { serviceUrl } : {}),
        // Resolved from the activity on this path, never from a member: the
        // reply goes back to the conversation the message came from.
        conversationFor: () => null,
      });
    },
    async remember({ rawBody, workspaceId }) {
      const serviceUrl = teamsServiceUrl(rawBody);
      if (serviceUrl) {
        await rememberConnectionConfig(getPool(), {
          workspaceId,
          provider: "teams",
          patch: { serviceUrl },
        });
      }
    },
    deliveryId: ({ rawBody }) => teamsDeliveryId(rawBody),
  });
}
