/**
 * What WhatsApp may carry right now (P5-T04b-b).
 *
 * **Meta's rule, not ours.** A business may send free-form text to somebody for
 * twenty-four hours after that person last wrote to it. Outside that window
 * only a template Meta has approved goes through, and a free-form send is
 * refused by the API rather than delivered late. So the window is read before
 * every WhatsApp message, from the moment the member last wrote in.
 *
 * **The window is the only reason a mapping is looked up.** Inside it the
 * ordinary body is sent and no template is involved at all, which keeps the
 * usual path free of a query for something it will not use.
 */
import { activeOnly, channelIdentities, type WorkspaceTx } from "@openokr/db";
import { eq } from "drizzle-orm";
import {
  type BindingFacts,
  loadBindingFacts,
  resolveBindings,
} from "./template-bindings.ts";
import { mappingFor } from "./template-mappings.ts";

/** Meta's session window, in milliseconds. */
export const CONVERSATION_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface WhatsAppEnvelope {
  readonly insideConversationWindow: boolean;
  readonly templateKey?: string;
  readonly templateParameters?: readonly string[];
}

/**
 * Whether this member wrote in recently enough for free-form text.
 *
 * Never written in means never inside: a member who has only ever received
 * messages has not opened a session, whatever the identity row says about when
 * it was created.
 */
export async function insideConversationWindow(
  tx: WorkspaceTx,
  input: {
    readonly workspaceId: string;
    readonly memberId: string;
    readonly now: Date;
  },
): Promise<boolean> {
  const [row] = await tx
    .select({ lastInboundAt: channelIdentities.lastInboundAt })
    .from(channelIdentities)
    .where(
      activeOnly(
        channelIdentities,
        eq(channelIdentities.workspaceId, input.workspaceId),
        eq(channelIdentities.memberId, input.memberId),
        eq(channelIdentities.provider, "whatsapp"),
      ),
    )
    .limit(1);

  const last = row?.lastInboundAt;
  if (!last) {
    return false;
  }
  return input.now.getTime() - last.getTime() < CONVERSATION_WINDOW_MS;
}

/**
 * Everything the builder needs to reach one member on WhatsApp.
 *
 * Inside the window: the window flag and nothing else, because the body goes as
 * it is. Outside it: the rule's approved template and one value per placeholder,
 * or no template at all when nothing is mapped, which the builder turns into a
 * refusal that says so rather than a send Meta would bounce.
 */
export async function whatsAppEnvelope(
  tx: WorkspaceTx,
  input: {
    readonly workspaceId: string;
    readonly memberId: string;
    readonly ruleKey: string;
    readonly subjectType: string;
    readonly subjectId: string;
    readonly now: Date;
  },
): Promise<WhatsAppEnvelope> {
  const inside = await insideConversationWindow(tx, input);
  if (inside) {
    return { insideConversationWindow: true };
  }

  const mapping = await mappingFor(tx, {
    workspaceId: input.workspaceId,
    ruleKey: input.ruleKey,
  });
  if (!mapping) {
    return { insideConversationWindow: false };
  }

  const facts: BindingFacts = await loadBindingFacts(tx, {
    workspaceId: input.workspaceId,
    memberId: input.memberId,
    ruleKey: input.ruleKey,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
  });

  return {
    insideConversationWindow: false,
    templateKey: mapping.templateName,
    templateParameters: resolveBindings(mapping.bindings, facts),
  };
}
