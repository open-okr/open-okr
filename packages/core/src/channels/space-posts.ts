/**
 * Where a space posts (AI-NATIVE-PLAN §5.2, completeness review M-23).
 *
 * §5.2 gives Slack "per-space channel posts" and Teams "channel posts". A
 * space names its channel on each in its own settings, and this answers which
 * of them can be posted to right now. Kept apart from the action that posts, so
 * the digest read can say whether the button will do anything without
 * importing the write.
 */
import { activeOnly, spaces, type WorkspaceTx } from "@openokr/db";
import { eq } from "drizzle-orm";
import { resolveSpaceSettingsFrom } from "../settings/registry.ts";
import { connectedProviders } from "./members.ts";

/** The providers a space can post to. §5.2 names channel posts for these two. */
export const SPACE_POST_PROVIDERS = ["slack", "teams"] as const;
export type SpacePostProvider = (typeof SPACE_POST_PROVIDERS)[number];

/** One post's idempotency key: one digest, one provider, one message. */
export const digestPostKey = (
  digestId: string,
  provider: SpacePostProvider,
): string => `digest.post:${digestId}:${provider}`;

/**
 * The channels a space posts to, on the providers the workspace has connected.
 *
 * A linked channel on a provider that is disconnected, or in `error`, is left
 * out rather than queued: the relay would fail it, and a failure there says
 * nothing the connection card does not already say.
 *
 * The caller authorises the space first. This reads its settings and nothing
 * else about it.
 */
export async function spacePostTargets(
  tx: WorkspaceTx,
  input: { readonly workspaceId: string; readonly spaceId: string },
): Promise<
  readonly { readonly provider: SpacePostProvider; readonly target: string }[]
> {
  const [space] = await tx
    .select({ settings: spaces.settings })
    // openokr:allow-raw-read: every caller has already authorised the space
    // this names, through the session it belongs to; this reads its settings.
    .from(spaces)
    .where(
      activeOnly(
        spaces,
        eq(spaces.workspaceId, input.workspaceId),
        eq(spaces.id, input.spaceId),
      ),
    )
    .limit(1);
  if (!space) {
    return [];
  }
  const settings = resolveSpaceSettingsFrom(
    space.settings as Record<string, unknown>,
  );
  const connected = await connectedProviders(tx, input.workspaceId);
  const linked: Record<SpacePostProvider, string | null> = {
    slack: settings.slackChannel,
    teams: settings.teamsChannel,
  };
  return SPACE_POST_PROVIDERS.flatMap((provider) => {
    const target = linked[provider];
    return target && connected.includes(provider) ? [{ provider, target }] : [];
  });
}
