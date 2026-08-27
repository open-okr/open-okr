/**
 * Slack's inbound door (AI-NATIVE-PLAN.md §6, P5-T02a, P5-T02b).
 *
 * One endpoint for all three shapes Slack sends: an event callback, a slash
 * command, and an interaction. The order of §6's checks and every step that is
 * not Slack's own live in `lib/channel-inbound.ts`, shared with Telegram since
 * P5-T05: writing that order twice would mean two places a security step could
 * be reordered, and two more providers are coming.
 *
 * What is here is what is genuinely Slack's:
 *
 * * the workspace resolved from the team id on the payload
 * * the credential shaped as a bot token plus a signing secret
 * * the URL-verification handshake, which arrives before any workspace exists
 * * a submitted form, which is not a message and must be read before one
 * * the modal, opened when the payload carries a trigger
 */
import {
  checkInView,
  parseViewSubmission,
  SlackChannel,
  slackDeliveryId,
} from "@openokr/adapters";
import {
  CHECK_IN_COMMAND,
  callAction,
  parseCommand,
  parseSlackSecret,
  submitCheckIn,
  workspaceForProviderTeam,
} from "@openokr/core";
import { CHECK_IN_STATUSES } from "@openokr/db";
import type { NextRequest } from "next/server";
import {
  CONVERSATION_MINUTES,
  runInbound,
  silence,
} from "../../../../lib/channel-inbound";
import { getPool } from "../../../../lib/pool";

export const dynamic = "force-dynamic";

/** Slack's team id, from whichever of the three shapes this is. */
function teamIdFrom(rawBody: string): string | null {
  if (rawBody.startsWith("{")) {
    try {
      const parsed = JSON.parse(rawBody) as Record<string, unknown>;
      if (typeof parsed.team_id === "string") {
        return parsed.team_id;
      }
      const team = parsed.team as Record<string, unknown> | undefined;
      return team && typeof team.id === "string" ? team.id : null;
    } catch {
      return null;
    }
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
      return team && typeof team.id === "string" ? team.id : null;
    } catch {
      return null;
    }
  }
  return null;
}

export async function POST(request: NextRequest): Promise<Response> {
  return runInbound(request, {
    provider: "slack",
    async resolveWorkspace({ rawBody }) {
      const teamId = teamIdFrom(rawBody);
      return teamId
        ? workspaceForProviderTeam(getPool(), { provider: "slack", teamId })
        : null;
    },
    buildDriver(secret) {
      const parsed = parseSlackSecret(secret);
      return parsed
        ? new SlackChannel({
            botToken: parsed.botToken,
            signingSecret: parsed.signingSecret,
            // Resolved from the message on this path, never from a member.
            slackUserFor: () => null,
          })
        : null;
    },
    deliveryId: ({ rawBody, headers }) => slackDeliveryId({ headers, rawBody }),

    async beforeMessage({ rawBody, workspaceId, secret, now }) {
      // Slack's own endpoint verification, honoured only once the signature has
      // proved it came from Slack.
      if (rawBody.startsWith("{")) {
        try {
          const parsed = JSON.parse(rawBody) as Record<string, unknown>;
          if (parsed.type === "url_verification") {
            return Response.json({ challenge: parsed.challenge });
          }
        } catch {
          return silence();
        }
      }

      // A submitted form, which is not a message: nobody typed it and it
      // carries one answer per field. Read before the message path, because
      // `parseInbound` flattens an interaction to its type and
      // "view_submission" is not a command anybody would want run.
      const submission = parseViewSubmission(rawBody);
      if (!submission) {
        return null;
      }

      const parsedSecret = parseSlackSecret(secret);
      const member = await memberFor(workspaceId, submission.externalSenderId);
      if (!parsedSecret || !member) {
        return silence();
      }

      const published = await submitCheckIn(
        {
          pool: getPool(),
          workspaceId,
          provider: "slack",
          memberId: member.memberId,
          userId: member.userId,
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

      const driver = new SlackChannel({
        botToken: parsedSecret.botToken,
        signingSecret: parsedSecret.signingSecret,
        slackUserFor: () => submission.externalSenderId,
      });
      // openokr:allow-side-effect: the reply to a form somebody just
      // submitted, on an inbound path rather than a write path.
      await driver.send(
        {
          memberId: member.memberId,
          externalId: submission.externalSenderId,
        },
        {
          text:
            published.kind === "none"
              ? "I could not read that form."
              : published.text,
        },
      );
      return silence();
    },

    async instead({ rawBody, workspaceId, secret, userId, text }) {
      const parsedSecret = parseSlackSecret(secret);
      if (!parsedSecret) {
        return false;
      }

      const driver = new SlackChannel({
        botToken: parsedSecret.botToken,
        signingSecret: parsedSecret.signingSecret,
        slackUserFor: () => null,
      });

      // The trigger a form needs. Its absence is what routes a member to the
      // conversational path rather than to an error: a trigger expires in about
      // three seconds and Slack having a bad second is not a reason a member
      // cannot check in.
      const message = await driver.parseInbound(rawBody);
      const triggerId = message?.triggerId;
      const parsed = parseCommand(text);
      if (
        !triggerId ||
        parsed.kind !== "command" ||
        parsed.command.verb !== CHECK_IN_COMMAND
      ) {
        return false;
      }

      const goalId = parsed.args.goal ?? "";
      if (!goalId) {
        return false;
      }

      try {
        const goal = await callAction(
          {
            pool: getPool(),
            workspaceId,
            actor: { kind: "human", userId },
          },
          "goals.read",
          { id: goalId },
        );
        await driver.openView(
          triggerId,
          checkInView({
            goalId,
            goalTitle: goal.title,
            statuses: [...CHECK_IN_STATUSES],
          }),
        );
        return true;
      } catch {
        // No form. The questions are asked one at a time instead, and the
        // refusal, if there is one, comes from the path that knows how to
        // refuse.
        return false;
      }
    },
  });
}

/**
 * The member behind a Slack account, for a form submission.
 *
 * A submission is not a message, so it never went through `handleInbound`'s
 * identity resolution. Read here rather than trusted from the payload: Slack
 * says who submitted, and the product says whether that account is anybody.
 */
async function memberFor(
  workspaceId: string,
  externalSenderId: string,
): Promise<{ memberId: string; userId: string } | null> {
  const result = await getPool().query<{
    member_id: string;
    user_id: string | null;
  }>(
    `select i.member_id, m.user_id
       from channel_identities i
       join workspace_members m on m.id = i.member_id
      where i.workspace_id = $1
        and i.provider = 'slack'
        and i.external_id = $2
        and i.verified_at is not null
        and i.deleted_at is null
        and m.status = 'active'
        and m.deleted_at is null
      limit 1`,
    [workspaceId, externalSenderId],
  );
  const row = result.rows[0];
  return row?.user_id ? { memberId: row.member_id, userId: row.user_id } : null;
}
