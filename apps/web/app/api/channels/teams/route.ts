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
 * **The check-in is a card here, as §5.3 asks** (completeness review M-23).
 * `checkin` with a goal answers with the adaptive card rather than the first of
 * four questions, and the card's submit comes back through this same door.
 * Both are handled in `instead`, which runs only after §6's steps one to six:
 * the token verified, the delivery not a repeat, the sender a linked and active
 * member inside their rate limit. A submission therefore needs no identity
 * lookup of its own, unlike Slack's, which Slack posts in a shape that never
 * reaches the message path.
 *
 * Everything else is `lib/channel-inbound.ts`: §6's order, the duplicate check,
 * identity resolution, the rate limit and the reply.
 */
import {
  checkInCard,
  parseCardSubmission,
  TeamsChannel,
  TeamsSigningKeys,
  teamsDeliveryId,
  teamsServiceUrl,
  teamsTenantId,
  verifyTeamsToken,
} from "@openokr/adapters";
import {
  CHECK_IN_COMMAND,
  callAction,
  parseCommand,
  parseTeamsSecret,
  rememberConnectionConfig,
  submitCheckIn,
} from "@openokr/core";
import { CHECK_IN_STATUSES } from "@openokr/db";
import type { NextRequest } from "next/server";
import {
  CONVERSATION_MINUTES,
  runInbound,
} from "../../../../lib/channel-inbound";
import { getPool } from "../../../../lib/pool";

export const dynamic = "force-dynamic";

/**
 * Microsoft's signing keys, for every request this process serves.
 *
 * One source for the check before the lookup and the driver's check after
 * it, so the keys are fetched once a day rather than on every request, which
 * is what a driver built per request used to do. They are Microsoft's, the
 * same for every tenant, so sharing them across workspaces shares nothing a
 * workspace owns.
 */
const signingKeys = new TeamsSigningKeys();

/**
 * A driver that replies to the conversation this activity came from.
 *
 * The service URL is the activity's own. `verifyInbound` has already checked it
 * against the one Microsoft signed into the token, and `remember` has written it
 * onto the connection, so it is the same value the connection now holds.
 */
function replyingDriver(secret: string, rawBody: string): TeamsChannel | null {
  const parsed = parseTeamsSecret(secret);
  const serviceUrl = teamsServiceUrl(rawBody);
  if (!parsed || !serviceUrl) {
    return null;
  }
  return new TeamsChannel({
    appId: parsed.appId,
    appPassword: parsed.appPassword,
    serviceUrl,
    conversationFor: () => null,
  });
}

export async function POST(request: NextRequest): Promise<Response> {
  return runInbound(request, {
    provider: "teams",
    // Microsoft's signature, the issuer, the expiry and the service URL, all
    // before a tenant is looked up (completeness review L-10). The audience
    // is the driver's, after, because only the connection knows the app id.
    verifyFirst: async ({ rawBody, headers }) =>
      (await verifyTeamsToken({ rawBody, headers }, { keys: signingKeys })) !==
      null,
    tenantOf: ({ rawBody }) => teamsTenantId(rawBody),
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
        signingKeys,
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

    async instead({
      rawBody,
      workspaceId,
      secret,
      memberId,
      userId,
      text,
      now,
    }) {
      const driver = replyingDriver(secret, rawBody);
      if (!driver) {
        return false;
      }

      // A submitted card. Always answered here once it is recognised: it has
      // no text, and letting it fall through to the router would read an empty
      // line as the answer to whatever conversation was in progress.
      const submission = parseCardSubmission(rawBody);
      if (submission) {
        const published = await submitCheckIn(
          {
            pool: getPool(),
            workspaceId,
            provider: "teams",
            memberId,
            userId,
            now,
            minutes: CONVERSATION_MINUTES,
          },
          {
            goalId: submission.reference,
            fields: {
              status: submission.fields.status ?? "",
              confidence: submission.fields.confidence ?? "",
              narrative: submission.fields.narrative ?? "",
            },
          },
        );
        // openokr:allow-side-effect: the reply to a form somebody just
        // submitted, on an inbound path rather than a write path. The check-in
        // itself committed through the Operation pipeline above.
        await driver.send(
          { memberId, externalId: submission.externalSenderId },
          {
            text:
              published.kind === "none"
                ? "I could not read that form."
                : published.text,
          },
        );
        return true;
      }

      // `checkin` naming a goal opens the card. With no goal named it falls
      // through to the router, which finds the one owed or asks which, the
      // same as Slack does with no trigger.
      const parsed = parseCommand(text);
      if (
        parsed.kind !== "command" ||
        parsed.command.verb !== CHECK_IN_COMMAND
      ) {
        return false;
      }
      const goalId = parsed.args.goal ?? "";
      const message = await driver.parseInbound(rawBody);
      if (!goalId || !message) {
        return false;
      }

      try {
        // Read as the member, so a goal they cannot see is refused before a
        // card is drawn for it. Whether they may check it in is decided when
        // they submit, by the write itself.
        const goal = await callAction(
          { pool: getPool(), workspaceId, actor: { kind: "human", userId } },
          "goals.read",
          { id: goalId },
        );
        // openokr:allow-side-effect: the form a member just asked for, sent
        // back to the conversation they asked in. Nothing was written.
        const sent = await driver.sendCard(
          message.externalSenderId,
          checkInCard({
            goalId,
            goalTitle: goal.title,
            statuses: [...CHECK_IN_STATUSES],
          }),
          `Check in: ${goal.title}`,
        );
        return sent.delivered;
      } catch {
        // No card. The questions are asked one at a time instead, and the
        // refusal, if there is one, comes from the path that knows how to
        // refuse.
        return false;
      }
    },
  });
}
