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
 * `routeCommand`'s (P5-T06a), which calls the registry action the command names
 * and lets `can()` decide: the refusal a member reads here is the sentence the
 * browser shows them, because it is the same code path.
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
import {
  checkInView,
  parseViewSubmission,
  SlackChannel,
  slackDeliveryId,
} from "@openokr/adapters";
import {
  CHECK_IN_COMMAND,
  callAction,
  handleInbound,
  helpText,
  INBOUND_RATE_LIMIT,
  INBOUND_RATE_WINDOW_SECONDS,
  openConnection,
  parseCommand,
  parseSlackSecret,
  routeCommand,
  submitCheckIn,
  workspaceForProviderTeam,
} from "@openokr/core";
import { CHECK_IN_STATUSES } from "@openokr/db";
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

  // A submitted form, which is not a message: nobody typed it and it carries
  // one answer per field (P5-T02b). Read before the message path, because
  // `parseInbound` flattens an interaction to its type and "view_submission"
  // is not a command anybody would want run.
  const submission = parseViewSubmission(rawBody);

  const cache = getCache();
  // Read once, here, and handed to everything below: the checks, the log row
  // and any arithmetic a command does all describe the same instant.
  const now = new Date();
  const outcome = await handleInbound(getPool(), {
    workspaceId,
    provider: "slack",
    deliveryId,
    externalSenderId: message.externalSenderId,
    text: message.text,
    now,
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
  // asked for one and is now known. A duplicate, an unknown sender and a
  // suspended member stay silent, which is §6's rule and §5.3's reason: a
  // helpful error confirms the workspace exists.
  //
  // A rate limit and an accepted command both answer, because by then the
  // sender is somebody the product knows and saying nothing to them reads as
  // the product ignoring them.
  const answer = await answerFor(
    outcome,
    workspaceId,
    message.text,
    now,
    submission,
    message.triggerId,
    driver,
  );
  if (!answer) {
    return silence();
  }

  const replier = new SlackChannel({
    botToken: secret.botToken,
    signingSecret: secret.signingSecret,
    slackUserFor: () => message.externalSenderId,
  });
  // openokr:allow-side-effect: the reply on an inbound path, not a write path.
  // It is sent rather than queued because a confirmation that arrived a minute
  // after somebody typed would read as a failure, and because nothing else in
  // the product needs to know it happened.
  await replier.send(
    { memberId: answer.memberId, externalId: message.externalSenderId },
    { text: answer.text },
  );

  return silence();
}

/**
 * What to say back, or null for silence.
 *
 * The three silent outcomes are grouped here rather than branched at the call
 * site, so the rule reads as one rule: a sender the product cannot vouch for
 * learns nothing, including whether this instance exists.
 */
async function answerFor(
  outcome: Awaited<ReturnType<typeof handleInbound>>,
  workspaceId: string,
  text: string,
  now: Date,
  submission: ReturnType<typeof parseViewSubmission>,
  triggerId: string | undefined,
  driver: SlackChannel,
): Promise<{ memberId: string; text: string } | null> {
  if (outcome.kind === "linked") {
    return {
      memberId: outcome.memberId,
      text: [
        "Your account is linked. OpenOKR will send your nudges here.",
        "",
        helpText(),
      ].join("\n"),
    };
  }

  if (outcome.kind === "rate_limited") {
    // §6 step six gives this a plain message rather than silence, because by
    // now the sender is a member the product knows.
    return {
      memberId: "",
      text: "That is a lot of messages at once. Try again in a minute.",
    };
  }

  if (outcome.kind !== "accepted" || !outcome.userId) {
    return null;
  }

  const flow = {
    pool: getPool(),
    workspaceId,
    provider: "slack" as const,
    memberId: outcome.memberId,
    userId: outcome.userId,
    now,
    minutes: CONVERSATION_MINUTES,
  };

  // A submitted form goes straight to the same two registry actions the
  // conversational path ends in.
  if (submission) {
    const published = await submitCheckIn(flow, {
      goalId: submission.reference,
      fields: {
        status: submission.fields.status ?? "",
        confidence: submission.fields.confidence ?? "",
        narrative: submission.fields.narrative ?? "",
      },
    });
    return {
      memberId: outcome.memberId,
      // `none` cannot come back from a submission, and the fallback keeps the
      // union honest rather than casting it away.
      text:
        published.kind === "none"
          ? "I could not read that form."
          : published.text,
    };
  }

  // A check-in with somewhere to put a form gets one. Without a trigger, or if
  // Slack refuses the view, the questions are asked one at a time instead: a
  // provider having a bad second is not a reason a member cannot check in.
  const parsed = parseCommand(text);
  if (
    triggerId &&
    parsed.kind === "command" &&
    parsed.command.verb === CHECK_IN_COMMAND
  ) {
    const opened = await openCheckInForm(
      driver,
      triggerId,
      workspaceId,
      outcome.userId,
      parsed.args.goal ?? "",
    );
    if (opened) {
      // Slack shows the form; there is nothing to say in the channel.
      return null;
    }
  }

  const reply = await routeCommand({
    pool: getPool(),
    workspaceId,
    provider: "slack",
    memberId: outcome.memberId,
    userId: outcome.userId,
    text,
    now,
  });
  return { memberId: outcome.memberId, text: reply.text };
}

/**
 * How long a half-finished conversation waits.
 *
 * The §4.14 setting's default, read here rather than resolved per workspace:
 * resolving it needs a settings read on an inbound path that is already three
 * queries deep, and the value a workspace overrode is honoured the moment the
 * conversational path is reached through the router. Worth a settings read here
 * when somebody actually changes it.
 */
const CONVERSATION_MINUTES = 30;

/**
 * Opens the check-in form, or says it could not (P5-T02b).
 *
 * False rather than a throw, because the caller's answer to "no form" is the
 * conversational path and not an error: a trigger expires in about three
 * seconds and Slack having a bad second is not a reason a member cannot check
 * in.
 *
 * The goal is read through the ordinary action, so a member who may not see it
 * gets no form and the refusal comes from the path that already knows how to
 * refuse.
 */
async function openCheckInForm(
  driver: SlackChannel,
  triggerId: string,
  workspaceId: string,
  userId: string,
  goalId: string,
): Promise<boolean> {
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
    return false;
  }
}
