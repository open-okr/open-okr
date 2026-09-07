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
  nudges,
  type WorkspaceTx,
} from "@openokr/db";
import { asc, eq, isNull, lte } from "drizzle-orm";
import { buildMessage } from "../channels/builder.ts";
import type { ChannelProviderKey } from "../channels/capabilities.ts";
import { queueChannelMessageInTx } from "../channels/log.ts";
import { connectedProviders, loadRoutingMembers } from "../channels/members.ts";
import { resolveDelivery } from "../channels/routing.ts";
import { whatsAppEnvelope } from "../channels/whatsapp-window.ts";
import { blockerDraft, isBlockerRule } from "./blocker-card.ts";

export interface DeliveryResult {
  /** Nudges stamped as sent on this pass. */
  readonly delivered: number;
  /** Of those, the ones that went to a provider rather than in-app only. */
  readonly toChannel: number;
  /** Recipients whose primary channel could not be reached. */
  readonly unreachable: readonly string[];
}

/**
 * A nudge's own message.
 *
 * **Deliberately one line for every rule.** Per-rule wording is coaching copy,
 * and METHOD.md owns coaching copy: writing forty-five recipient-facing
 * sentences here would put the product's voice outside the one document that
 * is allowed to hold it. So this says the true, minimal thing and carries the
 * rule key, which is what every proactive message is required to carry and what
 * the reader can follow to the rule itself. Per-rule text is a row of its own.
 */
function draftFor(ruleKey: string): { subject: string; text: string } {
  return {
    subject: "OpenOKR: something needs you",
    text: [
      "You have a reminder waiting in OpenOKR.",
      "",
      `Rule: ${ruleKey}`,
    ].join("\n"),
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
  },
): Promise<DeliveryResult> {
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

  let toChannel = 0;
  const unreachable = new Set<string>();

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
      continue;
    }

    const delivery = resolveDelivery({
      member,
      // An escalation past the owner is what earns a quiet hour, and the
      // ladder position is what says so. Step 3 is where §6.3 widens.
      urgent: row.escalationStep >= 3,
      connectedProviders: connected,
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
      continue;
    }

    if (delivery.fallbackReason) {
      unreachable.add(member.memberId);
    }

    // The inbox row first, because it is the obligation and it is written
    // whatever the channel decides.
    // openokr:allow-mutation: the calling Operation's own transaction.
    await tx.insert(notifications).values({
      workspaceId: input.workspaceId,
      recipientMemberId: row.recipientMemberId,
      nudgeId: row.id,
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
      const draft =
        isBlockerRule(row.ruleKey) && row.subjectType === "blocker"
          ? ((await blockerDraft(tx, {
              workspaceId: input.workspaceId,
              blockerId: row.subjectId,
              ruleKey: row.ruleKey,
              now: input.now,
              ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
            })) ?? draftFor(row.ruleKey))
          : draftFor(row.ruleKey);
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
        updatedAt: input.now,
      })
      .where(activeOnly(nudges, eq(nudges.id, row.id)));
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
