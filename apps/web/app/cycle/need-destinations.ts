import type { NeedKey, PhaseNeed } from "@openokr/method";

/**
 * Where each "Still needed here" item is filled in (plan 0.8.0 F1).
 *
 * A record over every key, so a key the method package adds without a place
 * here is a type error rather than an item that leads nowhere. `level` is what
 * the destination card is drawn with on the cycle page: `full` for the cards
 * only an owner sees or can change, `edit` for the rest.
 */
const DESTINATIONS: Record<
  NeedKey,
  { readonly anchor: string; readonly level: "edit" | "full" }
> = {
  "frame.missing": { anchor: "need-frame", level: "full" },
  "frame.mission": { anchor: "need-frame", level: "full" },
  "frame.strategy": { anchor: "need-frame", level: "full" },
  "frame.strategyCount": { anchor: "need-frame", level: "full" },
  "company.objective": { anchor: "need-annual-objectives", level: "full" },
  "role.sponsor": { anchor: "need-roles", level: "full" },
  "role.facilitator": { anchor: "need-roles", level: "full" },
  "pack.item": { anchor: "need-input-pack", level: "edit" },
  "pack.distribute": { anchor: "pack-distribute", level: "edit" },
  "sessions.dates": { anchor: "need-roles", level: "full" },
  "pack.lead": { anchor: "need-roles", level: "full" },
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
  publish: { anchor: "need-gates", level: "full" },
  "cadence.booking": { anchor: "need-cadence", level: "edit" },
  "cadence.decision": { anchor: "need-cadence", level: "edit" },
  scores: { anchor: "need-review", level: "full" },
  retrospective: { anchor: "need-review", level: "full" },
};

export type NeedDestination =
  | {
      readonly kind: "anchor";
      readonly anchor: string;
      readonly level: "edit" | "full";
    }
  | {
      readonly kind: "page";
      readonly href: string;
      readonly level: "edit" | "full";
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
