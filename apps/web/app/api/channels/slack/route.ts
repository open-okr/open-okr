/**
 * Slack's inbound door (AI-NATIVE-PLAN.md §6, P5-T02a).
 *
 * One endpoint for all three shapes Slack sends: an event callback, a slash
 * command, and an interaction. The order of the checks below is §6's order and
 * it is not rearrangeable:
 *
 * 1. the signature, over the raw bytes, before anything is parsed
 * 2. the replay window
 * 3. the delivery id, against the message log
 * 4. the sender, against a *verified* identity
 * 5. the member, active and not suspended
 * 6. the rate limit for that member
 *
 * Steps 1 and 2 are the driver's, because the algorithm is Slack's own. Steps 3
 * to 6 are `resolveInbound`'s, because they are the same four questions for
 * every provider. Steps 7 and 8, resolving a command and authorising it, are
 * P5-T06's router and are deliberately absent: this endpoint accepts and
 * records, and does not act.
 *
 * **Every answer is a 200 with an empty body, except a failed signature.** §6
 * says so and the reason is in §5.3: a helpful error confirms the workspace
 * exists. An attacker who guesses an instance learns whether their guess was
 * right from a 404, from a message, and from a slow answer. They learn nothing
 * from this.
 *
 * **No session, and no `requireWorkspace`.** The caller is Slack, not a browser
 * with a cookie. The workspace is resolved from the Slack team id on the
 * payload against `channel_connections`, which is why a payload for a team
 * nobody connected gets the same silence as everything else.
 */
import { SlackChannel, slackDeliveryId } from "@openokr/adapters";
import {
  handleInbound,
  INBOUND_RATE_LIMIT,
  INBOUND_RATE_WINDOW_SECONDS,
  openConnection,
  parseSlackSecret,
  workspaceForProviderTeam,
} from "@openokr/core";
import type { NextRequest } from "next/server";
import { getCache } from "../../../../lib/cache";
import { getPool } from "../../../../lib/pool";
import { getKeyRing } from "../../../../lib/secrets";

export const dynamic = "force-dynamic";

/** Empty, always the same, and never says why. */
const silence = () => new Response(null, { status: 200 });
const refused = () => new Response(null, { status: 401 });

const headerRecord = (request: NextRequest): Record<string, string> => {
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  return headers;
};

/** Slack's team id, from whichever of the three shapes this is. */
function teamIdFrom(rawBody: string): string | null {
  if (rawBody.startsWith("{")) {
    try {
      const parsed = JSON.parse(rawBody) as Record<string, unknown>;
      if (typeof parsed.team_id === "string") {
        return parsed.team_id;
      }
      const team = parsed.team as Record<string, unknown> | undefined;
      if (team && typeof team.id === "string") {
        return team.id;
      }
    } catch {
      return null;
    }
    return null;
  }

  const form = new URLSearchParams(rawBody);
  const direct = form.get("team_id");
  if (direct) {
    return direct;
  }
  // An interaction puts everything inside one JSON field.
  const payload = form.get("payload");
  if (payload) {
    try {
      const parsed = JSON.parse(payload) as Record<string, unknown>;
      const team = parsed.team as Record<string, unknown> | undefined;
      if (team && typeof team.id === "string") {
        return team.id;
      }
    } catch {
      return null;
    }
  }
  return null;
}

export async function POST(request: NextRequest): Promise<Response> {
  // The bytes, once. Reading the body twice is not possible, and the signature
  // covers exactly these bytes rather than a re-serialisation of them.
  const rawBody = await request.text();
  const headers = headerRecord(request);

  // Slack's own endpoint verification, which arrives before an app is
  // installed anywhere and therefore cannot be tied to a workspace. Answered
  // only when the signature is valid against the instance-level secret, which
  // is why the check below repeats after the connection is found.
  const teamId = teamIdFrom(rawBody);
  if (!teamId) {
    return silence();
  }

  const workspaceId = await workspaceForProviderTeam(getPool(), {
    provider: "slack",
    teamId,
  });
  if (!workspaceId) {
    // A team nobody connected. Same silence as an unlinked sender.
    return silence();
  }

  const connection = await openConnection(getPool(), getKeyRing(), {
    workspaceId,
    provider: "slack",
  });
  const secret = connection ? parseSlackSecret(connection.secret) : null;
  if (!secret) {
    return silence();
  }

  const driver = new SlackChannel({
    botToken: secret.botToken,
    signingSecret: secret.signingSecret,
    // Never used on this path: nothing here sends.
    slackUserFor: () => null,
  });

  // Steps 1 and 2. Before anything reads the body as data.
  if (!(await driver.verifyInbound({ headers, rawBody }))) {
    return refused();
  }

  // Slack's URL verification handshake, which is only honoured once the
  // signature has proved it came from Slack.
  if (rawBody.startsWith("{")) {
    const parsed = JSON.parse(rawBody) as Record<string, unknown>;
    if (parsed.type === "url_verification") {
      return Response.json({ challenge: parsed.challenge });
    }
  }

  const message = await driver.parseInbound(rawBody);
  const deliveryId = slackDeliveryId({ headers, rawBody });
  if (!message || !deliveryId) {
    return silence();
  }

  const cache = getCache();
  const outcome = await handleInbound(getPool(), {
    workspaceId,
    provider: "slack",
    deliveryId,
    externalSenderId: message.externalSenderId,
    text: message.text,
    now: new Date(),
    async withinRateLimit(key) {
      const result = await cache.rateLimit(
        key,
        INBOUND_RATE_LIMIT,
        INBOUND_RATE_WINDOW_SECONDS,
      );
      return result.allowed;
    },
  });

  // A linked identity is the one case that earns a reply, because the member
  // asked for one and is now known. Everything else is silence, whether it was
  // a duplicate, an unknown sender, a suspended member or a rate limit: §6
  // gives the rate limit a plain message, and that message needs the router to
  // send it (P5-T02b), so for now it is recorded and quiet rather than a reply
  // this endpoint invents.
  if (outcome.kind === "linked") {
    // openokr:allow-side-effect: the reply to a member who has just proved
    // their own account, on an inbound path rather than a write path. Nothing
    // was queued for it because nothing else needs to know it happened, and a
    // confirmation that arrived a minute after the code was typed would read
    // as a failure.
    const replier = new SlackChannel({
      botToken: secret.botToken,
      signingSecret: secret.signingSecret,
      slackUserFor: () => message.externalSenderId,
    });
    // openokr:allow-side-effect: the reply to a member who has just proved
    // their own account, on an inbound path rather than a write path.
    await replier.send(
      { memberId: outcome.memberId, externalId: message.externalSenderId },
      { text: "Your account is linked. OpenOKR will send your nudges here." },
    );
  }

  return silence();
}
