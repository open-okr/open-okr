import type { NeedKey, PhaseNeed } from "@openokr/method";

/**
 * Where each "Still needed here" item is filled in (plan 0.8.0 F1).
 *
 * A record over every key, so a key the method package adds without a place
 * here is a type error rather than an item that leads nowhere. `level` is what
 * the destination card is drawn with on the cycle page: `setup` for the cards
 * only somebody who can set up the cycle, an Owner or an Admin, sees or can
 * change (plan 0.8.0 R1), `edit` for the rest.
 */
const DESTINATIONS: Record<
  NeedKey,
  { readonly anchor: string; readonly level: "edit" | "setup" }
> = {
  "frame.missing": { anchor: "need-frame", level: "setup" },
  "frame.mission": { anchor: "need-frame", level: "setup" },
  "frame.strategy": { anchor: "need-frame", level: "setup" },
  "frame.strategyCount": { anchor: "need-frame", level: "setup" },
  "company.objective": { anchor: "need-annual-objectives", level: "setup" },
  // Each to its own picker: the card's first field is the Sponsor picker,
  // so "No facilitator named" focused the wrong one (UAT 0.8.0, F-06).
  "role.sponsor": { anchor: "need-role-sponsor", level: "setup" },
  "role.facilitator": { anchor: "need-role-facilitator", level: "setup" },
  "pack.item": { anchor: "need-input-pack", level: "edit" },
  "pack.distribute": { anchor: "pack-distribute", level: "edit" },
  "sessions.dates": { anchor: "need-roles", level: "setup" },
  "pack.lead": { anchor: "need-roles", level: "setup" },
  "prior.scores": { anchor: "need-diagnose", level: "edit" },
  "prior.unscored": { anchor: "need-diagnose", level: "edit" },
  "baseline.health": { anchor: "need-baseline", level: "edit" },
  "issues.count": { anchor: "need-diagnose", level: "edit" },
  "priorities.count": { anchor: "need-direction", level: "edit" },
  "priorities.success": { anchor: "need-direction", level: "edit" },
  "frame.notDoing": { anchor: "need-direction", level: "edit" },
  "frame.agreement": { anchor: "need-direction", level: "edit" },
  "revalidation.missing": { anchor: "need-revalidation", level: "edit" },
  "revalidation.note": { anchor: "need-revalidation", level: "edit" },
  "revalidation.outcome": { anchor: "need-revalidation", level: "edit" },
  "focus.keyResults": { anchor: "need-revalidation", level: "edit" },
  "focus.areas": { anchor: "need-revalidation", level: "edit" },
  "drafting.quality": { anchor: "need-drafting", level: "edit" },
  "drafting.none": { anchor: "need-drafting", level: "edit" },
  "goal.quality": { anchor: "need-drafting", level: "edit" },
  gate: { anchor: "need-gates", level: "edit" },
  publish: { anchor: "need-gates", level: "setup" },
  "cadence.booking": { anchor: "need-cadence", level: "edit" },
  "cadence.decision": { anchor: "need-cadence", level: "edit" },
  scores: { anchor: "need-review", level: "setup" },
  retrospective: { anchor: "need-review", level: "setup" },
};

export type NeedDestination =
  | {
      readonly kind: "anchor";
      readonly anchor: string;
      readonly level: "edit" | "setup";
    }
  | {
      readonly kind: "page";
      readonly href: string;
      readonly level: "edit" | "setup";
    };

/** Where this item is filled in: a card on the cycle page, or another page. */
export function needDestination(need: PhaseNeed): NeedDestination {
  const place = DESTINATIONS[need.key];
  // The row of the item itself, rather than the whole pack.
  if (need.key === "pack.item" && need.ref) {
    return {
      kind: "anchor",
      anchor: `pack-item-${need.ref}`,
      level: place.level,
    };
  }
  // A draft that fails a rule is fixed on its own page.
  if (need.key === "goal.quality" && need.ref) {
    return { kind: "page", href: `/goals/${need.ref}`, level: place.level };
  }
  return { kind: "anchor", anchor: place.anchor, level: place.level };
}
