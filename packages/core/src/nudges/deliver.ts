/**
 * Sending the nudges that are due (AI-NATIVE-PLAN.md §5.4, P5-T01b-b).
 *
 * The nudge run decides *whether* the product speaks. This decides *where* and
 * *when* it arrives. They are separate passes on purpose: a nudge deferred into
 * tomorrow morning is written by one run and delivered by the next, and a
 * single pass that did both would have nowhere to keep it in between.
 *
 * A nudge row is the queue. `sent_at is null` with no suppression reason and a
 * `scheduled_for` that has passed means "owed to somebody and not yet
 * delivered", which is exactly what this reads.
 *
 * **In-app is written whatever the channel decides.** §5.4's last line is that
 * a snooze never silences a review-inbox obligation; the same reasoning applies
 * to routing. The channel is where the product goes to find somebody, and the
 * product is where the obligation lives.
 */
import {
  activeOnly,
  notifications,
  nudgeRules,
  nudges,
  type WorkspaceTx,
} from "@openokr/db";
import { asc, eq, isNotNull, isNull, lte } from "drizzle-orm";
import { buildMessage } from "../channels/builder.ts";
import type { ChannelProviderKey } from "../channels/capabilities.ts";
import { queueChannelMessageInTx } from "../channels/log.ts";
import { connectedProviders, loadRoutingMembers } from "../channels/members.ts";
import { type PrimaryChannel, resolveDelivery } from "../channels/routing.ts";
import { whatsAppEnvelope } from "../channels/whatsapp-window.ts";
import { digestItemsFor } from "../notifications/digest.ts";
import { instanceNameOr } from "../secrets/instance-registry.ts";
import { primaryChannelSchema } from "../settings/registry.ts";
import { defaultMetrics, METRIC } from "../telemetry/recorder.ts";
import { blockerDraft, isBlockerRule } from "./blocker-card.ts";
import { nudgeDraft } from "./message.ts";

export interface DeliveryResult {
  /** Nudges stamped as sent on this pass. */
  readonly delivered: number;
  /** Of those, the ones that went to a provider rather than in-app only. */
  readonly toChannel: number;
  /**
   * Recipients a routed channel could not reach, their own or a rule's
   * (M-23). The reconnect notice is not raised from this: it is about the
   * member's own channel, and `unreachableRecipients` asks that alone.
   */
  readonly unreachable: readonly string[];
}

/** The trigger key §6.4 gives the morning summary. */
const DAILY_DIGEST_RULE = "digest.daily";

/**
 * The morning summary's own message: the member's own unread rows (P6-G01b).
 *
 * Null when there is nothing unread, and the caller falls back to the rule's
 * own plain message rather than mailing an empty list.
 *
 * The same builder the batch drain uses, so the two digests cannot describe one
 * event differently, and the access filter is applied once in one place.
 */
async function dailyDigestDraft(
  tx: WorkspaceTx,
  input: {
    readonly workspaceId: string;
    readonly memberId: string;
    readonly baseUrl: string;
    readonly now: Date;
    readonly instanceName?: string;
  },
): Promise<{ subject: string; text: string } | null> {
  const contents = await digestItemsFor(tx, {
    workspaceId: input.workspaceId,
    memberId: input.memberId,
    unreadOnly: true,
    baseUrl: input.baseUrl,
    now: input.now,
  });
  if (contents.items.length === 0) {
    return null;
  }
  const count = contents.items.length;
  const lines = [
    "Here is what happened since you last looked.",
    "",
    ...contents.items.map((item) => `- ${item.summary}\n  ${item.link}`),
    ...(contents.omitted > 0 ? ["", `and ${contents.omitted} more.`] : []),
    "",
    // The rule key, on this message as on every other proactive message the
    // product sends. It is what a reader follows back to METHOD.md.
    `Rule: ${DAILY_DIGEST_RULE}`,
  ];
  const name = instanceNameOr(input.instanceName);
  return {
    subject: count === 1 ? `${name}: 1 update` : `${name}: ${count} updates`,
    text: lines.join("\n"),
  };
}

/**
 * Every recipient whose primary channel cannot be reached right now.
 *
 * Read before anything is delivered, because it is what the reconnect notice
 * is raised from and that notice has to be written by the same run that decides
 * to route around the broken channel. A member on email or in-app is never
 * unreachable: neither needs a connection or an identity.
 */
export async function unreachableRecipients(
  tx: WorkspaceTx,
  input: {
    readonly workspaceId: string;
    readonly memberIds: readonly string[];
    readonly now: Date;
  },
): Promise<readonly string[]> {
  const members = await loadRoutingMembers(tx, input);
  const connected = await connectedProviders(tx, input.workspaceId);

  const unreachable: string[] = [];
  for (const member of members.values()) {
    const delivery = resolveDelivery({
      member,
      urgent: false,
      connectedProviders: connected,
      now: input.now,
    });
    if (delivery.fallbackReason) {
      unreachable.push(member.memberId);
    }
  }
  return unreachable;
}

export async function deliverDueNudges(
  tx: WorkspaceTx,
  input: {
    readonly workspaceId: string;
    readonly now: Date;
    /** Bounded so one pass cannot hold a transaction open over a backlog. */
    readonly limit?: number;
    /**
     * The instance's own address, for links inside a message (P5-T03b).
     *
     * Optional, because every caller before the escalation card had nothing to
     * link to and a required argument would have been a required argument for
     * nothing. Absent means the card is sent without its board link, not that
     * it is not sent.
     */
    readonly baseUrl?: string;
    /**
     * What the instance calls itself, for the subject and the button of what
     * it sends (completeness review M-33). The host resolves it when it runs,
     * so a rename reaches the next nudge. Absent says "OpenOKR".
     */
    readonly instanceName?: string;
  },
): Promise<DeliveryResult> {
  const named = input.instanceName ? { instanceName: input.instanceName } : {};
  const due = await tx
    .select({
      id: nudges.id,
      ruleKey: nudges.ruleKey,
      recipientMemberId: nudges.recipientMemberId,
      escalationStep: nudges.escalationStep,
      // Read so a blocker rule can say which blocker (P5-T03b). Every other
      // rule ignores both.
      subjectType: nudges.subjectType,
      subjectId: nudges.subjectId,
    })
    .from(nudges)
    .where(
      activeOnly(
        nudges,
        eq(nudges.workspaceId, input.workspaceId),
        isNull(nudges.sentAt),
        isNull(nudges.suppressedReason),
        lte(nudges.scheduledFor, input.now),
      ),
    )
    .orderBy(asc(nudges.scheduledFor))
    .limit(input.limit ?? 200);

  if (due.length === 0) {
    return { delivered: 0, toChannel: 0, unreachable: [] };
  }

  const memberIds = [...new Set(due.map((row) => row.recipientMemberId))];
  const members = await loadRoutingMembers(tx, {
    workspaceId: input.workspaceId,
    memberIds,
    now: input.now,
  });
  const connected = await connectedProviders(tx, input.workspaceId);

  // Every rule this workspace has re-routed (P6-G21). One read for the whole
  // batch rather than one per nudge, and an absent key is the member's own
  // channel, which is what no row means everywhere else in this table.
  const overrideRows = await tx
    .select({
      ruleKey: nudgeRules.ruleKey,
      channelOverride: nudgeRules.channelOverride,
    })
    .from(nudgeRules)
    .where(
      activeOnly(
        nudgeRules,
        eq(nudgeRules.workspaceId, input.workspaceId),
        isNotNull(nudgeRules.channelOverride),
      ),
    );
  // The column is free text in the table and the routing decision takes the
  // same union a member's own channel does. Narrowed here, once, rather than
  // at the call site: a value outside the set is a row written before the
  // action that validates it existed, and the member's own channel is the
  // right answer for one of those.
  const overrides = new Map<string, PrimaryChannel>();
  for (const row of overrideRows) {
    const parsed = primaryChannelSchema.safeParse(row.channelOverride);
    if (parsed.success) {
      overrides.set(row.ruleKey, parsed.data);
    }
  }

  let toChannel = 0;
  const unreachable = new Set<string>();

  const metrics = defaultMetrics();
  for (const row of due) {
    const member = members.get(row.recipientMemberId);
    if (!member) {
      // The member was removed between the run that wrote this and now. Not
      // delivered and not left due forever: stamped so the queue drains.
      // openokr:allow-mutation: the calling Operation's own transaction.
      await tx
        .update(nudges)
        .set({ suppressedReason: "disabled", updatedAt: input.now })
        .where(activeOnly(nudges, eq(nudges.id, row.id)));
      metrics.count(METRIC.nudgesTotal, {
        rule: row.ruleKey,
        outcome: "disabled",
      });
      continue;
    }

    const delivery = resolveDelivery({
      member,
      // An escalation past the owner is what earns a quiet hour, and the
      // ladder position is what says so. Step 3 is where §6.3 widens.
      urgent: row.escalationStep >= 3,
      connectedProviders: connected,
      channelOverride: overrides.get(row.ruleKey) ?? null,
      now: input.now,
    });

    if (delivery.sendAt.getTime() > input.now.getTime()) {
      // Still inside the member's night. Pushed to the window's edge and left
      // in the queue rather than sent or dropped.
      // openokr:allow-mutation: the calling Operation's own transaction.
      await tx
        .update(nudges)
        .set({ scheduledFor: delivery.sendAt, updatedAt: input.now })
        .where(activeOnly(nudges, eq(nudges.id, row.id)));
      // **`deferred`, not `suppressed`.** AI-NATIVE-PLAN §5.4 is explicit
      // that quiet hours queue to the next open window, and a counter that
      // called this a suppression would put a delivery that is going to
      // happen in the same bucket as one that never will. That distinction
      // was already got wrong once in the code this measures (P5-T01b-b).
      metrics.count(METRIC.nudgesTotal, {
        rule: row.ruleKey,
        outcome: "deferred",
      });
      continue;
    }

    if (delivery.fallbackReason) {
      unreachable.add(member.memberId);
      // A fixed word and the channel it landed on. The reason itself is a
      // sentence naming a provider, and since a rule's own channel can fail
      // alongside the member's (M-23) it is two sentences; it belongs on the
      // nudge row below, not in a label kept for the life of the process.
      metrics.count(METRIC.nudgesTotal, {
        rule: row.ruleKey,
        outcome: "fallback",
        channel: delivery.channel,
      });
    }

    // The inbox row first, because it is the obligation and it is written
    // whatever the channel decides.
    // openokr:allow-mutation: the calling Operation's own transaction.
    await tx.insert(notifications).values({
      workspaceId: input.workspaceId,
      recipientMemberId: row.recipientMemberId,
      nudgeId: row.id,
      // Copied from the nudge so the inbox row can be grouped and linked
      // without joining back to it (migration 0074, P6-G07a). The nudge's
      // subject types are a narrower list than the activity's, and every one
      // of them is a subject the access getter can resolve.
      subjectType: row.subjectType,
      subjectId: row.subjectId,
      // One reason across every cadence. The inbox is a list of obligations,
      // not a taxonomy of clocks; the rule key on the nudge row says which
      // trigger fired.
      reason: "check_in",
      channel: delivery.channel,
      sentAt: input.now,
    });

    if (delivery.channel !== "in_app") {
      const provider = delivery.channel as ChannelProviderKey;
      // A blocker rule carries the blocker's own words, its age and the two
      // actions worth offering; everything else carries the generic line.
      // Falls back when the blocker has gone or was resolved between the nudge
      // being scheduled and this pass running, which is an ordinary race.
      // The rule's own name, what it is about, where to open it and, for a
      // check-in, the check-in itself (completeness review H-12). A blocker
      // and the morning summary carry more, and fall back to this when the
      // blocker has gone or the summary is empty.
      const plain = () =>
        nudgeDraft(tx, {
          workspaceId: input.workspaceId,
          ruleKey: row.ruleKey,
          subjectType: row.subjectType,
          subjectId: row.subjectId,
          provider,
          ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
          ...named,
        });
      const draft =
        isBlockerRule(row.ruleKey) && row.subjectType === "blocker"
          ? ((await blockerDraft(tx, {
              workspaceId: input.workspaceId,
              blockerId: row.subjectId,
              ruleKey: row.ruleKey,
              now: input.now,
              ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
              ...named,
            })) ?? (await plain()))
          : // **The daily summary carries what it is summarising** (P6-G01b):
            // it is a list of things rather than a sentence about one.
            row.ruleKey === DAILY_DIGEST_RULE && input.baseUrl
            ? ((await dailyDigestDraft(tx, {
                workspaceId: input.workspaceId,
                memberId: row.recipientMemberId,
                baseUrl: input.baseUrl,
                now: input.now,
                ...named,
              })) ?? (await plain()))
            : await plain();
      // WhatsApp is the one provider with a clock on it (P5-T04b-b). Outside
      // Meta's twenty-four hour window the body will not go at all, so the
      // rule's approved template and its filled-in variables are looked up and
      // the builder sends that instead. Every other provider skips the query.
      const envelope =
        provider === "whatsapp"
          ? await whatsAppEnvelope(tx, {
              workspaceId: input.workspaceId,
              memberId: row.recipientMemberId,
              ruleKey: row.ruleKey,
              subjectType: row.subjectType,
              subjectId: row.subjectId,
              now: input.now,
            })
          : null;
      const message = buildMessage(
        envelope?.templateKey
          ? {
              ...draft,
              templateKey: envelope.templateKey,
              ...(envelope.templateParameters
                ? { templateParameters: envelope.templateParameters }
                : {}),
            }
          : draft,
        provider,
        envelope
          ? { insideConversationWindow: envelope.insideConversationWindow }
          : {},
      );
      if (message.text === "" && !message.templateKey) {
        // Outside WhatsApp's window with no template mapped for this rule.
        // Meta would refuse the send, so nothing is queued: the inbox row
        // above is already written and the obligation stands. Counted as
        // unreachable, which is what raises the reconnect notice and is the
        // honest word for a member the product currently cannot reach.
        unreachable.add(member.memberId);
      } else {
        await queueChannelMessageInTx(tx, {
          workspaceId: input.workspaceId,
          memberId: row.recipientMemberId,
          channel: provider,
          message,
          // The nudge's own id. One nudge is one message however many times a
          // delivery pass runs over it.
          idempotencyKey: `nudge:${row.id}`,
          ...(delivery.fallbackReason
            ? { fallbackReason: delivery.fallbackReason }
            : {}),
        });
        toChannel++;
      }
    }

    // openokr:allow-mutation: the calling Operation's own transaction.
    await tx
      .update(nudges)
      .set({
        sentAt: input.now,
        channel: delivery.channel,
        // Why it is not where it was routed, on the row that records the
        // product speaking (M-23). The message log has it too, but a nudge
        // that fell back to in-app has no message to carry it.
        fallbackReason: delivery.fallbackReason ?? null,
        updatedAt: input.now,
      })
      .where(activeOnly(nudges, eq(nudges.id, row.id)));
    // The channel is a label because there are six of them and the set is
    // fixed. The recipient is not, and never will be.
    metrics.count(METRIC.nudgesTotal, {
      rule: row.ruleKey,
      outcome: "sent",
      channel: delivery.channel,
    });
  }

  const delivered = await tx
    .select({ id: nudges.id })
    .from(nudges)
    .where(
      activeOnly(
        nudges,
        eq(nudges.workspaceId, input.workspaceId),
        eq(nudges.sentAt, input.now),
      ),
    );

  return {
    delivered: delivered.length,
    toChannel,
    unreachable: [...unreachable],
  };
}
