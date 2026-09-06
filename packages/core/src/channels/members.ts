/**
 * What routing needs to know about a workspace and its members (P5-T01b-b).
 *
 * Kept apart from `routing.ts` so that the decision stays a pure function over
 * loaded data. Everything here is a read; nothing here decides anything.
 */
import {
  activeOnly,
  channelConnections,
  channelIdentities,
  type WorkspaceTx,
  workspaceMembers,
} from "@openokr/db";
import { eq, inArray, isNotNull } from "drizzle-orm";
import type { ChannelProviderKey } from "./capabilities.ts";
import type { PrimaryChannel, RoutingMember } from "./routing.ts";

/** The member's own clock, for the quiet-hours window. */
export function localTimeIn(
  now: Date,
  timeZone: string,
): { hour: number; minute: number } {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(now);
    const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
    const minute = Number(
      parts.find((part) => part.type === "minute")?.value ?? 0,
    );
    return { hour: hour === 24 ? 0 : hour, minute };
  } catch {
    // An unknown timezone is a bad row, not a reason to stop delivering. UTC
    // is the same fallback the suppression context already takes.
    return { hour: now.getUTCHours(), minute: now.getUTCMinutes() };
  }
}

/**
 * Providers this workspace can actually reach.
 *
 * `connected` only. A connection in `error` is one the last send failed on,
 * and continuing to route to it would produce the same failure and a second
 * reconnect notice. `disabled` is an administrator's own decision.
 */
export async function connectedProviders(
  tx: WorkspaceTx,
  workspaceId: string,
): Promise<readonly ChannelProviderKey[]> {
  const rows = await tx
    .select({ provider: channelConnections.provider })
    .from(channelConnections)
    .where(
      activeOnly(
        channelConnections,
        eq(channelConnections.workspaceId, workspaceId),
        eq(channelConnections.state, "connected"),
      ),
    );
  return rows.map((row) => row.provider);
}

/**
 * Routing facts for a set of members, keyed by member id.
 *
 * One query for the members and one for their identities, rather than two per
 * member: a daily sweep routes every recipient in the workspace and this is
 * the read it does most often.
 */
export async function loadRoutingMembers(
  tx: WorkspaceTx,
  input: {
    readonly workspaceId: string;
    readonly memberIds: readonly string[];
    readonly now: Date;
  },
): Promise<ReadonlyMap<string, RoutingMember>> {
  if (input.memberIds.length === 0) {
    return new Map();
  }

  const members = await tx
    .select({
      id: workspaceMembers.id,
      primaryChannel: workspaceMembers.primaryChannel,
      timeZone: workspaceMembers.timezone,
      quietHours: workspaceMembers.quietHours,
    })
    .from(workspaceMembers)
    .where(
      activeOnly(
        workspaceMembers,
        eq(workspaceMembers.workspaceId, input.workspaceId),
        inArray(workspaceMembers.id, [...input.memberIds]),
      ),
    );

  const identities = await tx
    .select({
      memberId: channelIdentities.memberId,
      provider: channelIdentities.provider,
    })
    .from(channelIdentities)
    .where(
      activeOnly(
        channelIdentities,
        eq(channelIdentities.workspaceId, input.workspaceId),
        inArray(channelIdentities.memberId, [...input.memberIds]),
        // Verified only. An unverified identity is somebody's claim, and
        // sending to a claim is how one person's nudge reaches another person.
        isNotNull(channelIdentities.verifiedAt),
      ),
    );

  const byMember = new Map<string, ChannelProviderKey[]>();
  for (const row of identities) {
    const list = byMember.get(row.memberId) ?? [];
    list.push(row.provider);
    byMember.set(row.memberId, list);
  }

  return new Map(
    members.map((member) => [
      member.id,
      {
        memberId: member.id,
        primaryChannel: (member.primaryChannel ?? "email") as PrimaryChannel,
        localTime: localTimeIn(input.now, member.timeZone ?? "UTC"),
        quietHours: member.quietHours ?? null,
        verifiedProviders: byMember.get(member.id) ?? [],
      },
    ]),
  );
}
