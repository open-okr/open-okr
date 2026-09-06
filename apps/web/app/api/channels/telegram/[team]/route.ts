/**
 * Telegram's inbound door (AI-NATIVE-PLAN.md §6, P5-T05).
 *
 * **The workspace is in the URL, because Telegram never says which bot an
 * update came from.** Slack puts a team id on every payload; a Telegram update
 * carries the chat and the sender and nothing about the bot that received it.
 * So each workspace registers its webhook at its own path, and the segment is
 * the bot id stored on its `channel_installations` row. The shared secret then
 * proves the caller knows what only Telegram was told, which is the strongest
 * claim this provider makes available.
 *
 * Everything else is `lib/channel-inbound.ts`: §6's order, the duplicate check,
 * identity resolution, the rate limit and the reply. Telegram has no modal, so
 * a check-in here is the conversational path, which is the same code a member
 * on Slack reaches when their trigger has expired.
 */
import { TelegramChannel, telegramDeliveryId } from "@openokr/adapters";
import { parseTelegramSecret, workspaceForProviderTeam } from "@openokr/core";
import type { NextRequest } from "next/server";
import { runInbound } from "../../../../../lib/channel-inbound";
import { getPool } from "../../../../../lib/pool";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ team: string }> },
): Promise<Response> {
  const { team } = await context.params;

  return runInbound(request, {
    provider: "telegram",
    // The path segment, not anything on the body: an update says nothing about
    // which bot received it.
    resolveWorkspace: () =>
      workspaceForProviderTeam(getPool(), {
        provider: "telegram",
        teamId: team,
      }),
    buildDriver(secret) {
      const parsed = parseTelegramSecret(secret);
      return parsed
        ? new TelegramChannel({
            botToken: parsed.botToken,
            webhookSecret: parsed.webhookSecret,
            // Resolved from the update on this path, never from a member.
            chatIdFor: () => null,
          })
        : null;
    },
    deliveryId: ({ rawBody }) => telegramDeliveryId(rawBody),
  });
}
