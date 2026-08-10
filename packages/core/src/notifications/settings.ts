/**
 * Per-member notification settings (TECHNICAL-PLAN §4.11, §4.14 "Member"
 * card, P2-T06).
 *
 * Defaults from TECHNICAL-PLAN §11's worked example: mentions immediate,
 * everything else batched in a thirty-minute window, the daily summary on
 * at 08:00 local. The row is created lazily on first read or write rather
 * than at member provisioning, the same "found or created" shape
 * `notification_batches` itself uses — a member who never touches their
 * settings still gets the documented default, because `getOrCreate` always
 * returns one.
 */
import {
  activeOnly,
  type NotificationRouting,
  notificationSettings,
  type WorkspaceTx,
} from "@openokr/db";
import { eq } from "drizzle-orm";

type AnyTx<TSchema extends Record<string, unknown> = Record<string, never>> =
  WorkspaceTx<TSchema>;

export const DEFAULT_BATCH_WINDOW_MINUTES = 30;
export const DEFAULT_DAILY_SUMMARY_TIME = "08:00";

export interface NotificationSettingsView {
  readonly memberId: string;
  readonly routing: NotificationRouting;
  readonly mentionImmediate: boolean;
  readonly batchWindowMinutes: number;
  readonly dailySummary: boolean;
  readonly dailySummaryTime: string;
  readonly quietHours: { readonly start: string; readonly end: string } | null;
}

export async function getOrCreateNotificationSettings<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  workspaceId: string,
  memberId: string,
): Promise<NotificationSettingsView> {
  const [existing] = await tx
    .select()
    .from(notificationSettings)
    .where(
      activeOnly(
        notificationSettings,
        eq(notificationSettings.workspaceId, workspaceId),
        eq(notificationSettings.memberId, memberId),
      ),
    )
    .limit(1);
  if (existing) {
    return existing;
  }

  // openokr:allow-mutation: this helper is called only from inside an
  // Operation's execute (notifications.getSettings, notifications
  // .updateSettings, and the recipient-resolution path below), on the
  // transaction that Operation opened.
  const [created] = await tx
    .insert(notificationSettings)
    .values({ workspaceId, memberId })
    .onConflictDoNothing()
    .returning();
  if (created) {
    return created;
  }

  // A concurrent call won the insert first; read back what it created.
  const [row] = await tx
    .select()
    .from(notificationSettings)
    .where(
      activeOnly(
        notificationSettings,
        eq(notificationSettings.workspaceId, workspaceId),
        eq(notificationSettings.memberId, memberId),
      ),
    )
    .limit(1);
  return row as NotificationSettingsView;
}

export interface UpdateNotificationSettingsInput {
  readonly workspaceId: string;
  readonly memberId: string;
  readonly routing?: NotificationRouting;
  readonly mentionImmediate?: boolean;
  readonly batchWindowMinutes?: number;
  readonly dailySummary?: boolean;
  readonly dailySummaryTime?: string;
  readonly quietHours?: { readonly start: string; readonly end: string } | null;
}

export async function updateNotificationSettings<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  input: UpdateNotificationSettingsInput,
): Promise<NotificationSettingsView> {
  await getOrCreateNotificationSettings(tx, input.workspaceId, input.memberId);

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.routing !== undefined) patch.routing = input.routing;
  if (input.mentionImmediate !== undefined)
    patch.mentionImmediate = input.mentionImmediate;
  if (input.batchWindowMinutes !== undefined)
    patch.batchWindowMinutes = input.batchWindowMinutes;
  if (input.dailySummary !== undefined) patch.dailySummary = input.dailySummary;
  if (input.dailySummaryTime !== undefined)
    patch.dailySummaryTime = input.dailySummaryTime;
  if (input.quietHours !== undefined) patch.quietHours = input.quietHours;

  // openokr:allow-mutation: same reason as getOrCreateNotificationSettings.
  const [updated] = await tx
    .update(notificationSettings)
    .set(patch)
    .where(
      activeOnly(
        notificationSettings,
        eq(notificationSettings.workspaceId, input.workspaceId),
        eq(notificationSettings.memberId, input.memberId),
      ),
    )
    .returning();
  return updated as NotificationSettingsView;
}
