/**
 * Site messages (P8-T03c).
 *
 * Design: `docs/design/p8-t01b-operator-console.md` §4, corrected in two
 * places by migration 0088 and repeated here so a reader of this file meets
 * the correction rather than the original.
 *
 * **The window is required, not optional.** A message with no end is a banner
 * everybody learns to ignore, and the next one is ignored with it. The
 * database refuses a missing end date and so does the schema below, because
 * the first is what makes it true and the second is what makes the refusal
 * legible to the person typing.
 *
 * **The body is plain text.** A site message reaches every customer at once,
 * which is the worst place in the product to add a sanitising surface, and an
 * operator writing a maintenance notice needs a sentence rather than a
 * heading level.
 */
import {
  SITE_MESSAGE_LEVELS,
  siteMessageDismissals,
  siteMessages,
  withInstanceAdmin,
  withUser,
} from "@openokr/db";
import { and, asc, eq, gt, lte, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { z } from "zod";

/**
 * What an operator may write. Validated here rather than trusted from a form,
 * and the refusals reach the caller as a `ZodError`, which `api/errors.ts`
 * maps to 422 naming the field.
 */
const siteMessageInput = z
  .object({
    body: z
      .string()
      .trim()
      .min(1, "A site message needs something to say.")
      .max(1000),
    level: z.enum(SITE_MESSAGE_LEVELS).default("info"),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    /** Empty means everybody. Named workspaces mean only those. */
    targetWorkspaceIds: z.array(z.uuid()).default([]),
    dismissible: z.boolean().default(true),
  })
  .refine((value) => value.endsAt > value.startsAt, {
    message: "The message has to end after it starts.",
    path: ["endsAt"],
  });

type SiteMessageInput = z.input<typeof siteMessageInput>;

export interface LiveSiteMessage {
  readonly id: string;
  readonly body: string;
  readonly level: string;
  readonly endsAt: Date;
  readonly dismissible: boolean;
}

/** Writes one. The operator is recorded so a message has an author. */
export async function createSiteMessage(
  pool: Pool,
  operatorUserId: string,
  input: SiteMessageInput,
): Promise<{ readonly id: string }> {
  const parsed = siteMessageInput.parse(input);
  const db = drizzle(pool);

  // openokr:allow-mutation: a site message belongs to the instance and to no
  // workspace, so there is no tenant context to open an Operation in and no
  // workspace activity feed it could appear on. The operator console's own
  // audit trail records that it was written. The marker sits above the
  // statement rather than above the insert, because that is where the rule
  // looks.
  const [row] = await withInstanceAdmin(db, (tx) =>
    tx
      .insert(siteMessages)
      .values({
        body: parsed.body,
        level: parsed.level,
        startsAt: parsed.startsAt,
        endsAt: parsed.endsAt,
        targetWorkspaceIds:
          parsed.targetWorkspaceIds.length > 0
            ? parsed.targetWorkspaceIds
            : null,
        dismissible: parsed.dismissible,
        createdByUserId: operatorUserId,
      })
      .returning({ id: siteMessages.id }),
  );

  if (!row) {
    throw new Error("The site message was not written.");
  }
  return row;
}

/** Removes one. An expired message stops showing on its own; this is for a
 * message that should never have been sent. */
export async function deleteSiteMessage(
  pool: Pool,
  messageId: string,
): Promise<void> {
  const db = drizzle(pool);
  // openokr:allow-mutation: instance scope, no workspace, no Operation.
  await withInstanceAdmin(db, (tx) =>
    tx.delete(siteMessages).where(eq(siteMessages.id, messageId)),
  );
}

/** Every message, live or not, for the operator console to manage. */
export async function listSiteMessages(pool: Pool) {
  const db = drizzle(pool);
  return withInstanceAdmin(db, (tx) =>
    tx.select().from(siteMessages).orderBy(asc(siteMessages.startsAt)),
  );
}

/**
 * What this person should see in this workspace, right now.
 *
 * Three filters, and each one is a different question:
 *
 *   - the window, because a message outside it is not news yet or any more;
 *   - the target, because a message for three workspaces is not for the rest;
 *   - the dismissal, because a person who has read it has read it.
 *
 * The target is filtered in the query rather than by a policy, because the
 * policy cannot see which workspace the reader is looking at. The dismissal
 * is filtered against this person's own rows, which the `app.user_id` policy
 * is what actually scopes.
 */
export async function liveSiteMessagesFor(
  pool: Pool,
  userId: string,
  workspaceId: string,
  now: Date = new Date(),
): Promise<readonly LiveSiteMessage[]> {
  const db = drizzle(pool);
  return withUser(db, userId, (tx) =>
    tx
      .select({
        id: siteMessages.id,
        body: siteMessages.body,
        level: siteMessages.level,
        endsAt: siteMessages.endsAt,
        dismissible: siteMessages.dismissible,
      })
      .from(siteMessages)
      .where(
        and(
          lte(siteMessages.startsAt, now),
          gt(siteMessages.endsAt, now),
          sql`(${siteMessages.targetWorkspaceIds} is null or ${workspaceId}::uuid = any(${siteMessages.targetWorkspaceIds}))`,
          sql`not exists (select 1 from ${siteMessageDismissals} d where d.message_id = ${siteMessages.id} and d.user_id = ${userId})`,
        ),
      )
      .orderBy(asc(siteMessages.startsAt)),
  );
}

/** This person has read it. Their own row, and nobody else's. */
export async function dismissSiteMessage(
  pool: Pool,
  userId: string,
  messageId: string,
): Promise<void> {
  const db = drizzle(pool);
  // openokr:allow-mutation: a dismissal is one person's own record of having
  // read something. No workspace, no audit event, nothing to authorise beyond
  // the policy that already scopes it to them.
  await withUser(db, userId, (tx) =>
    tx
      .insert(siteMessageDismissals)
      .values({ messageId, userId })
      .onConflictDoNothing(),
  );
}
