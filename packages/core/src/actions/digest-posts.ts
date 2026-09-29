/**
 * Posting the week's digest to the space's own channel (UIUX-PLAN S-22 step 4,
 * AI-NATIVE-PLAN §5.2, completeness review M-23).
 *
 * §5.2 gives Slack "per-space channel posts" and Teams "channel posts", S-22's
 * digest step offers to "post it to the space's channel", and TECHNICAL-PLAN's
 * `digests` row is "generated, editable, then published to channels" with a
 * `published_at` and a `channels` list for exactly that. None of it was built:
 * every channel message went to one member, and a space had nowhere to say
 * which channel its team reads.
 *
 * **A person posts it, so this is not a proactive message.** The coordinator
 * presses the button once the session has closed and the note is written,
 * which is the moment the digest stops changing. No rule fires, so no nudge row
 * is written, and quiet hours do not hold it: they belong to a member, and a
 * channel has none, and the person pressing is there to see it go. Whether the
 * product should also post to a space on its own, for §6.4's `session.open`,
 * `session.due_soon` and `digest.weekly`, is a question for a person: a nudge
 * row needs one member to address, and a space is not one.
 *
 * **Once per digest per channel.** The message row's idempotency key is the
 * digest and the provider, so pressing twice, or two coordinators pressing at
 * once, posts one message; the second press is told it had already gone.
 *
 * **Through the outbox, like every other send.** The rows are written in this
 * Operation's transaction and the relay delivers them to `sendToChannel`, so a
 * post that fails is a row that says why, and the digest is marked published in
 * the same commit as the rows that publish it.
 */
import {
  activeOnly,
  channelMessages,
  digests,
  includeDeleted,
  spaces,
} from "@openokr/db";
import { weeklyDigestLines } from "@openokr/method";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { buildMessage } from "../channels/builder.ts";
import { queueChannelMessageInTx } from "../channels/log.ts";
import {
  digestPostKey,
  SPACE_POST_PROVIDERS,
  type SpacePostProvider,
  spacePostTargets,
} from "../channels/space-posts.ts";
import { OperationError } from "../operations/operation.ts";
import { instanceNameOr } from "../secrets/instance-registry.ts";
import { withoutTrailingSlashes } from "../urls.ts";
import { defineWriteAction } from "./define.ts";
import { digestInputFor } from "./rhythm-assists.ts";
import { requireSessionAccess } from "./sessions.ts";

const providerSchema = z.enum(SPACE_POST_PROVIDERS);

export const postDigest = defineWriteAction({
  name: "sessions.postDigest",
  summary:
    "Posts a closed weekly session's digest to the Slack or Teams channel its space is linked to, once per channel.",
  input: z.object({ sessionId: z.uuid() }),
  output: z.object({
    /** Queued now, and delivered by the relay. */
    posted: z.array(providerSchema),
    /** Posted by an earlier press, so nothing new was queued for these. */
    alreadyPosted: z.array(providerSchema),
  }),
  // The note beside it is `edit`, and so is this: the people who run the
  // space's session are the people who decide it is ready to be read.
  access: ACCESS_LEVELS.edit,
  operation: (context, input) => ({
    async execute({ tx, workspaceId, actor }) {
      const memberId = actor.memberId;
      if (!memberId) {
        throw new OperationError("not_found", "No such workspace.");
      }
      const session = await requireSessionAccess(
        tx,
        workspaceId,
        memberId,
        input.sessionId,
        ACCESS_LEVELS.edit,
      );
      if (session.kind !== "weekly" || !session.spaceId) {
        throw new OperationError(
          "not_found",
          "Only a weekly session in a space has a digest to post.",
        );
      }
      // After the close, never before: the digest row is written by the
      // close, and the figures move until then.
      if (session.state !== "closed" || !session.digestId) {
        throw new OperationError(
          "not_found",
          "The digest can be posted once the session has closed.",
        );
      }
      const digestId = session.digestId;

      const targets = await spacePostTargets(tx, {
        workspaceId,
        spaceId: session.spaceId,
      });
      if (targets.length === 0) {
        throw new OperationError(
          "not_found",
          "This space has no Slack or Teams channel linked on a connected provider. A space manager links one in the space settings.",
        );
      }

      const assembled = await digestInputFor(tx, workspaceId, input.sessionId);
      if (!assembled) {
        throw new OperationError(
          "not_found",
          "No digest exists for this session yet.",
        );
      }
      const [space] = await tx
        .select({ name: spaces.name })
        // openokr:allow-raw-read: `requireSessionAccess` above authorised this
        // space through its session; this reads its name for the heading.
        .from(spaces)
        .where(activeOnly(spaces, eq(spaces.id, session.spaceId)))
        .limit(1);
      // The space's own name, where the screen says "This space": a channel
      // is read by people who were not in the room.
      const lines = weeklyDigestLines({
        ...assembled,
        spaceName: space?.name ?? assembled.spaceName,
      });
      const name = instanceNameOr(context.instanceName);
      const draft = {
        text: lines.join("\n"),
        subject: `${name}: ${lines[0] ?? "Weekly digest"}`,
        ...(context.baseUrl
          ? {
              buttons: [
                {
                  label: `Open in ${name}`,
                  url: `${withoutTrailingSlashes(context.baseUrl)}/session/${input.sessionId}`,
                },
              ],
            }
          : {}),
      };

      // Posted before, by this digest's own key. Read including deleted rows,
      // because the unique index is not partial and a deleted row still holds
      // the key.
      const keys = targets.map((one) => digestPostKey(digestId, one.provider));
      const earlier = await tx
        .select({ key: channelMessages.idempotencyKey })
        .from(channelMessages)
        .where(
          includeDeleted(
            channelMessages,
            and(
              eq(channelMessages.workspaceId, workspaceId),
              inArray(channelMessages.idempotencyKey, keys),
            ),
          ),
        );
      const done = new Set(earlier.map((row) => row.key));

      const posted: SpacePostProvider[] = [];
      const alreadyPosted: SpacePostProvider[] = [];
      for (const { provider, target } of targets) {
        const key = digestPostKey(digestId, provider);
        if (done.has(key)) {
          alreadyPosted.push(provider);
          continue;
        }
        const queued = await queueChannelMessageInTx(tx, {
          workspaceId,
          memberId: null,
          channel: provider,
          message: buildMessage(draft, provider),
          idempotencyKey: key,
          target,
        });
        (queued.queued ? posted : alreadyPosted).push(provider);
      }

      const [digest] = await tx
        .select({
          channels: digests.channels,
          publishedAt: digests.publishedAt,
        })
        .from(digests)
        .where(activeOnly(digests, eq(digests.id, digestId)))
        .limit(1);
      const now = new Date();
      const channels = [
        ...new Set([...(digest?.channels ?? []), ...posted, ...alreadyPosted]),
      ];
      // openokr:allow-mutation: this Operation's own transaction, so the
      // digest is marked published in the commit that queues its posts.
      await tx
        .update(digests)
        .set({
          channels,
          publishedAt: digest?.publishedAt ?? now,
          updatedAt: now,
        })
        .where(activeOnly(digests, eq(digests.id, digestId)));

      return {
        result: { posted, alreadyPosted },
        activity: {
          kind: "session.digestPosted",
          subjectType: "space",
          subjectId: session.spaceId,
          payload: { channels: posted },
        },
        audit: {
          action: "sessions.postDigest",
          targetType: "digest",
          targetId: digestId,
          // The providers, never the channel ids or the words: an audit row
          // says that something was posted and where to, by provider.
          payload: { posted, alreadyPosted },
        },
      };
    },
  }),
});
