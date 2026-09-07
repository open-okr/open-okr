/**
 * A sentence turned into a list filter (AI-NATIVE-PLAN.md §2.4, P4-T15d).
 *
 * **The grammar is the whole product here.** The explorer filters on four things,
 * and a filter is only ever one of them: a cycle the member can see, a level, a
 * health band, and whether the goals are theirs. A sentence that asks for
 * something outside that is **refused with the reason**, never approximated. An
 * assist that quietly narrowed "goals blocked on legal" to "off-track goals"
 * would hand somebody a list they believe is one thing and is another, which is
 * worse than a refusal by a wide margin.
 *
 * **The model never returns an identifier.** It picks a cycle by number from a
 * numbered list of the cycles this member can read, exactly as the citations and
 * the parent suggestion do, and every other field is checked against its own
 * enum. So a filter that comes back can only describe goals this member is
 * already allowed to list.
 *
 * The manual filters are untouched: the explorer's own links work with the
 * provider off, and this returns null in that case.
 */
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { ASSIST_FEATURE_KEYS } from "../ai/assist-keys.ts";
import { checkFeatureAvailability } from "../ai/budgets.ts";
import { listCycles } from "./cycles.ts";
import { defineReadAction } from "./define.ts";

/** §3.2's health bands, and the levels, as the grammar knows them. */
const HEALTH = [
  "pending",
  "on_track",
  "caution",
  "off_track",
  "outdated",
  "achieved",
  "missed",
] as const;

const LEVELS = ["company", "department", "team", "individual"] as const;

/** How many cycles the model is offered. */
const CYCLE_LIMIT = 12;

const filterOutput = z.object({
  /** Null when the sentence said nothing about a cycle. */
  cycleId: z.uuid().nullable(),
  level: z.enum(LEVELS).nullable(),
  health: z.enum(HEALTH).nullable(),
  mine: z.boolean(),
  includeClosed: z.boolean(),
  /** What the assist understood, for the reader to check at a glance. */
  summary: z.string(),
});

/**
 * Turns a sentence into a filter, or explains why it cannot.
 *
 * Two shapes of answer and they are deliberately different. `null` means there
 * was no provider, or the switch is off, or the model fell over: the surface
 * shows nothing. A `refused` answer means the sentence was understood well
 * enough to know it cannot be expressed, and the reader is told which part.
 */
export const parseListFilter = defineReadAction({
  name: "goals.parseFilter",
  summary:
    "Turns a sentence into a validated goals filter, or refuses it with the reason.",
  input: z.object({
    sentence: z.string().trim().min(1).max(300),
  }),
  output: z
    .union([
      z.object({ kind: z.literal("filter"), filter: filterOutput }),
      z.object({ kind: z.literal("refused"), reason: z.string() }),
    ])
    .nullable(),
  access: ACCESS_LEVELS.view,
  async handler(context, input) {
    const drafter = context.drafter;
    if (!drafter?.parseListFilter) {
      return null;
    }
    const availability = await checkFeatureAvailability(context.pool, {
      workspaceId: context.workspaceId,
      featureKey: ASSIST_FEATURE_KEYS.parseFilter,
      defaultTier: "fast",
    });
    if (!availability.available) {
      return null;
    }

    // The cycles this member can read, numbered. The model picks one by number
    // and never sees an identifier.
    const cycles = (await listCycles.handler(context, {})).slice(
      0,
      CYCLE_LIMIT,
    );

    let parsed: Awaited<
      ReturnType<NonNullable<typeof drafter.parseListFilter>>
    >;
    try {
      parsed = await drafter.parseListFilter({
        sentence: input.sentence,
        cycles: cycles.map((cycle) => cycle.name),
        levels: [...LEVELS],
        healthBands: [...HEALTH],
      });
    } catch {
      return null;
    }
    if (!parsed) {
      return null;
    }
    if (parsed.kind === "refused") {
      return {
        kind: "refused" as const,
        reason:
          parsed.reason.trim() === ""
            ? "That is not something this list can filter on."
            : parsed.reason.trim(),
      };
    }

    // **Every field checked against the grammar, not trusted.** A model that
    // answers with a level the product does not have, or a cycle number past the
    // end of the list, has produced something unexpressible, which is the same
    // answer as asking for something unexpressible in the first place.
    const cycleNumber = parsed.cycleNumber;
    let cycleId: string | null = null;
    if (cycleNumber !== null) {
      if (
        !Number.isInteger(cycleNumber) ||
        cycleNumber < 1 ||
        cycleNumber > cycles.length
      ) {
        return {
          kind: "refused" as const,
          reason: "That is not a cycle you can see.",
        };
      }
      cycleId = cycles[cycleNumber - 1]?.id ?? null;
    }

    if (parsed.level !== null && !LEVELS.includes(parsed.level as never)) {
      return {
        kind: "refused" as const,
        reason: `This list has no "${parsed.level}" level.`,
      };
    }
    if (parsed.health !== null && !HEALTH.includes(parsed.health as never)) {
      return {
        kind: "refused" as const,
        reason: `This list has no "${parsed.health}" health band.`,
      };
    }

    const filter = {
      cycleId,
      level: (parsed.level as (typeof LEVELS)[number] | null) ?? null,
      health: (parsed.health as (typeof HEALTH)[number] | null) ?? null,
      mine: parsed.mine === true,
      includeClosed: parsed.includeClosed === true,
      summary: describe({
        cycleName:
          cycleId === null
            ? null
            : (cycles[(cycleNumber ?? 1) - 1]?.name ?? null),
        level: parsed.level,
        health: parsed.health,
        mine: parsed.mine === true,
        includeClosed: parsed.includeClosed === true,
      }),
    };

    // A sentence that produced no filter at all was not understood, whatever the
    // model said. Refusing beats handing back the unfiltered list as though it
    // were an answer.
    if (
      filter.cycleId === null &&
      filter.level === null &&
      filter.health === null &&
      !filter.mine &&
      !filter.includeClosed
    ) {
      return {
        kind: "refused" as const,
        reason:
          "Nothing in that names a cycle, a level, a health band, or whose goals they are.",
      };
    }

    return { kind: "filter" as const, filter };
  },
});

/** The filter in the product's own words, so a reader can check it at a glance. */
function describe(parts: {
  readonly cycleName: string | null;
  readonly level: string | null;
  readonly health: string | null;
  readonly mine: boolean;
  readonly includeClosed: boolean;
}): string {
  const said: string[] = [];
  if (parts.mine) {
    said.push("yours");
  }
  if (parts.health) {
    said.push(parts.health.replace("_", " "));
  }
  if (parts.level) {
    said.push(`${parts.level} level`);
  }
  if (parts.cycleName) {
    said.push(`in ${parts.cycleName}`);
  }
  if (parts.includeClosed) {
    said.push("including closed ones");
  }
  return said.length === 0 ? "everything" : said.join(", ");
}
