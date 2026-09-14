/**
 * What erasure reaches past the member row (P7-T08b).
 *
 * **Agung decided the rule on 11 September 2026: anonymise the content,
 * delete the identifiers.** What a member wrote stays, attributed to the
 * placeholder identity, so a quarter's record is still readable and the
 * audit chain still verifies. An erasure that broke the chain would have
 * destroyed the record proving it happened.
 *
 * What goes is everything that says *who they are* rather than *what they
 * did*: the account they are known by on Slack or Teams, the codes that link
 * one to the other, the tokens issued to them, and the words inside messages
 * addressed to them.
 *
 * Before this existed, `people.erase` anonymised `workspace_members` and
 * nothing else. The P7-T08a review found the external account id and handle
 * still in the channel tables, the message payloads still carrying body
 * text, and their tokens still live. The acceptance criterion says no
 * personal data of theirs remains in message logs or prompts, and it did.
 *
 * Every statement here runs on the transaction the calling Operation
 * opened, so the sweep, the member row, the activity, the audit row and the
 * outbox row commit together or not at all. A partial erasure is worse than
 * none: it reports success having left half the identifiers behind.
 */
import {
  aiMessages,
  aiThreads,
  apiTokens,
  channelIdentities,
  channelLinkCodes,
  channelMessages,
  includeDeleted,
  oauthAccessTokens,
  oauthGrants,
  oauthRefreshTokens,
  type WorkspaceTx,
} from "@openokr/db";
import { eq, inArray } from "drizzle-orm";

/**
 * How much this erasure removed, by table.
 *
 * Returned rather than logged, for two reasons. It goes on the audit row, so
 * a quarter later somebody can see what an erasure actually did instead of
 * only that one happened. And it goes in the export handed to the member,
 * because "we deleted your data" is a claim, and a count per table is the
 * nearest thing to evidence a person can be given.
 */
export interface ErasureSweep {
  readonly channelIdentities: number;
  readonly channelLinkCodes: number;
  /** Payloads blanked. The rows stay: see the note on `blankMessages`. */
  readonly channelMessages: number;
  readonly apiTokens: number;
  readonly oauthGrants: number;
  readonly oauthTokens: number;
  readonly copilotThreads: number;
  readonly copilotMessages: number;
}

const EMPTY_PAYLOAD = {} as const;

/**
 * Deletes every identifier and credential the member has, and blanks the
 * words inside messages addressed to them.
 *
 * `tx` is the calling Operation's own transaction. This is deliberately not
 * an action of its own: erasure is one decision and one audit row, and a
 * second entry point would be a way to do half of it.
 */
export async function sweepPersonalData(
  tx: WorkspaceTx,
  input: { readonly workspaceId: string; readonly memberId: string },
): Promise<ErasureSweep> {
  // **Every statement below scopes with `includeDeleted`, and it is spelled
  // out at each one rather than wrapped in a helper.** The soft-delete lint
  // is lexical on purpose: it wants the choice visible in the diff at every
  // write, and a helper that hid it would defeat a check that is right.
  //
  // The choice itself is not a formality. Soft delete is the repository-wide
  // default scope, so an unqualified statement would skip every row somebody
  // had already removed. A soft-deleted channel identity still holds the
  // external account id and the handle: the row is hidden from the product
  // and the identifier is still in the database. An erasure respecting the
  // default scope would report success having left behind exactly the rows
  // nobody was looking at.

  // **The external account, which is the whole point.** `external_id` is
  // their Slack member id or their Telegram chat id, and `external_handle`
  // is the name their colleagues see. Both identify the person outside this
  // product, so both are exactly what erasure is asked to remove. Deleted
  // rather than blanked: an identity row with no identity in it is a row
  // that means nothing and that a later link could collide with.
  // openokr:allow-mutation: the calling Operation's own transaction.
  const identities = await tx
    .delete(channelIdentities)
    .where(
      includeDeleted(
        channelIdentities,
        eq(channelIdentities.workspaceId, input.workspaceId),
        eq(channelIdentities.memberId, input.memberId),
      ),
    )
    .returning({ id: channelIdentities.id });

  // The codes that were about to create one.
  // openokr:allow-mutation: the calling Operation's own transaction.
  const linkCodes = await tx
    .delete(channelLinkCodes)
    .where(
      includeDeleted(
        channelLinkCodes,
        eq(channelLinkCodes.workspaceId, input.workspaceId),
        eq(channelLinkCodes.memberId, input.memberId),
      ),
    )
    .returning({ id: channelLinkCodes.id });

  // **Blanked, not deleted, and this is Agung's decision rather than a
  // compromise.** The row is the delivery record the audit trail refers to:
  // it says a message was sent, over which provider, when, and whether it
  // arrived. Deleting it would leave an audit row pointing at nothing.
  // The payload is the part that carries words, so the payload is the part
  // that goes.
  // openokr:allow-mutation: the calling Operation's own transaction.
  const messages = await tx
    .update(channelMessages)
    .set({ payload: EMPTY_PAYLOAD, updatedAt: new Date() })
    .where(
      includeDeleted(
        channelMessages,
        eq(channelMessages.workspaceId, input.workspaceId),
        eq(channelMessages.memberId, input.memberId),
      ),
    )
    .returning({ id: channelMessages.id });

  // **Credentials, and they go first in spirit if not in order.** A token
  // that outlives an erasure is an account somebody can still act as.
  // openokr:allow-mutation: the calling Operation's own transaction.
  const tokens = await tx
    .delete(apiTokens)
    .where(
      includeDeleted(
        apiTokens,
        eq(apiTokens.workspaceId, input.workspaceId),
        eq(apiTokens.memberId, input.memberId),
      ),
    )
    .returning({ id: apiTokens.id });

  // The grants, and the access and refresh tokens hanging off them. Read
  // first so the children can be removed by grant id: the tokens carry no
  // member column of their own, which is the kind of thing a sweep written
  // table-by-table from a schema listing would miss.
  const grants = await tx
    .select({ id: oauthGrants.id })
    .from(oauthGrants)
    .where(
      includeDeleted(
        oauthGrants,
        eq(oauthGrants.workspaceId, input.workspaceId),
        eq(oauthGrants.memberId, input.memberId),
      ),
    );
  const grantIds = grants.map((grant) => grant.id);

  let oauthTokenCount = 0;
  if (grantIds.length > 0) {
    // openokr:allow-mutation: the calling Operation's own transaction.
    const access = await tx
      .delete(oauthAccessTokens)
      .where(
        // Scoped by parent rather than by member: these carry no member
        // column of their own, which is the kind of thing a sweep written
        // table-by-table from a schema listing would miss.
        includeDeleted(
          oauthAccessTokens,
          inArray(oauthAccessTokens.grantId, grantIds),
        ),
      )
      .returning({ id: oauthAccessTokens.id });
    // openokr:allow-mutation: the calling Operation's own transaction.
    const refresh = await tx
      .delete(oauthRefreshTokens)
      .where(
        // Scoped by parent rather than by member: these carry no member
        // column of their own, which is the kind of thing a sweep written
        // table-by-table from a schema listing would miss.
        includeDeleted(
          oauthRefreshTokens,
          inArray(oauthRefreshTokens.grantId, grantIds),
        ),
      )
      .returning({ id: oauthRefreshTokens.id });
    oauthTokenCount = access.length + refresh.length;
    // openokr:allow-mutation: the calling Operation's own transaction.
    await tx
      .delete(oauthGrants)
      .where(
        includeDeleted(
          oauthGrants,
          eq(oauthGrants.workspaceId, input.workspaceId),
          eq(oauthGrants.memberId, input.memberId),
        ),
      );
  }

  // **Copilot threads are deleted rather than anonymised, and the rule
  // decides it.** A check-in is the member's content *and* the workspace's
  // record, so anonymising keeps something somebody else needs. A copilot
  // thread has exactly one reader, the member who typed it, so there is no
  // shared record to preserve and every word in it is theirs. Anonymising
  // would keep their questions under a placeholder name, which serves
  // nobody and is the opposite of what erasure was asked for.
  const threads = await tx
    .select({ id: aiThreads.id })
    .from(aiThreads)
    .where(
      includeDeleted(
        aiThreads,
        eq(aiThreads.workspaceId, input.workspaceId),
        eq(aiThreads.memberId, input.memberId),
      ),
    );
  const threadIds = threads.map((thread) => thread.id);

  let messageCount = 0;
  if (threadIds.length > 0) {
    // openokr:allow-mutation: the calling Operation's own transaction.
    const removed = await tx
      .delete(aiMessages)
      .where(
        // Scoped by parent rather than by member: these carry no member
        // column of their own, which is the kind of thing a sweep written
        // table-by-table from a schema listing would miss.
        includeDeleted(aiMessages, inArray(aiMessages.threadId, threadIds)),
      )
      .returning({ id: aiMessages.id });
    messageCount = removed.length;
    // openokr:allow-mutation: the calling Operation's own transaction.
    await tx
      .delete(aiThreads)
      .where(
        includeDeleted(
          aiThreads,
          eq(aiThreads.workspaceId, input.workspaceId),
          eq(aiThreads.memberId, input.memberId),
        ),
      );
  }

  return {
    channelIdentities: identities.length,
    channelLinkCodes: linkCodes.length,
    channelMessages: messages.length,
    apiTokens: tokens.length,
    oauthGrants: grantIds.length,
    oauthTokens: oauthTokenCount,
    copilotThreads: threadIds.length,
    copilotMessages: messageCount,
  };
}
