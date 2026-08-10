/**
 * Per-kind feed renderers (TECHNICAL-PLAN §4.11, screen S-31, P2-T07).
 *
 * One function per registered kind, turning its payload into the sentence a
 * feed row reads. Plain strings rather than the rich-text renderer: a feed
 * line is generated from data the product already trusts (a name it stored
 * itself), never from a member's own written content, so there is nothing
 * here for the sanitising allow-list to do.
 */
import type { ActivityKind } from "./catalogue.ts";

export type ActivityRenderer = (payload: Record<string, unknown>) => string;

const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

export const ACTIVITY_RENDERERS: Record<ActivityKind, ActivityRenderer> = {
  "workspace.provisioned": (p) => `Workspace "${asString(p.name)}" created`,
  "workspace.renamed": (p) =>
    `Workspace renamed from "${asString(p.from)}" to "${asString(p.to)}"`,
  "member.profile_updated": (p) =>
    `${asString(p.name, "A member")} updated their profile`,
  "member.updated": (p) => `${asString(p.name, "A member")} was updated`,
  "member.suspended": (p) => `${asString(p.name, "A member")} was suspended`,
  "member.restored": (p) => `${asString(p.name, "A member")} was restored`,
  "member.converted_to_guest": (p) =>
    `${asString(p.name, "A member")} was converted to a guest`,
  "member.erased": (p) => `${asString(p.name, "A member")}'s data was erased`,
  "invitation.link_created": () => "An invitation link was created",
  "invitation.link_revoked": () => "An invitation link was revoked",
  "invitation.accepted": () => "An invitation was accepted",
  "invitation.joined_by_trusted_domain": () =>
    "Someone joined through a trusted email domain",
  "blob.prepared": () => "A file upload was started",
  "blob.claimed": () => "A file was uploaded",
  "notification.read": () => "A notification was read",
  "notification.snoozed": () => "A notification was snoozed",
  "notification_settings.updated": () => "Notification settings were updated",
  "subscription.added": () => "Someone subscribed",
  "subscription.canceled": () => "Someone unsubscribed",
  "workspace.general_settings_updated": (p) =>
    `Workspace settings were updated (${
      Array.isArray(p.keys) ? p.keys.join(", ") : "general"
    })`,
  "workspace.branding_updated": () => "Workspace branding was updated",
  "workspace.settings_reset": (p) =>
    `Workspace settings were reset to their defaults (${
      Array.isArray(p.keys) ? p.keys.join(", ") : "general"
    })`,
};

/** Renders any registered kind; a kind without one is a build-time bug, not a runtime one, since the catalogue is exhaustive. */
export function renderActivity(
  kind: string,
  payload: Record<string, unknown>,
): string {
  const renderer = (
    ACTIVITY_RENDERERS as Record<string, ActivityRenderer | undefined>
  )[kind];
  return renderer ? renderer(payload) : kind;
}
