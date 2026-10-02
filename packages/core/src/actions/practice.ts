/**
 * Practice settings actions (METHOD.md §12, P9-T01).
 *
 * Three actions, read by every member and changed by an admin:
 * - `practice.read`: the profile, the workspace's own changes, every setting
 *   resolved, and the registry and profiles the settings screen draws from.
 * - `practice.update`: change some settings. Sparse: a key set to null goes
 *   back to the profile's value, and a value equal to it is not stored.
 * - `practice.applyProfile`: choose a profile. The workspace's own changes are
 *   kept, and the result names the ones that now differ from the new profile,
 *   so a screen can offer to reset them.
 *
 * Choosing a profile also writes the §11 thresholds the profile sets (P9-T05),
 * by the rule `switchProfile` states: a threshold the workspace set itself is
 * kept, the same way its own practice changes are.
 */
import {
  activeOnly,
  rhythmSettings,
  withContext,
  workspaceMembers,
} from "@openokr/db";
import {
  PRACTICE,
  PRACTICE_KEYS,
  PROFILE_KEYS,
  PROFILES,
  resolvePractice,
  switchProfile,
  validatePracticeOverrides,
} from "@openokr/method";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { getAccessScoped } from "../access/reads.ts";
import { mergeOverrides, resolveRhythm } from "../cycles/rhythm.ts";
import { ensureRhythmSettingsInTx, readRhythmRow } from "../cycles/service.ts";
import { OperationError, type OperationTx } from "../operations/operation.ts";
import { practiceFromRow } from "../practice/settings.ts";
import { defineReadAction, defineWriteAction } from "./define.ts";

const profileKey = z.enum(PROFILE_KEYS);

const practiceState = z.object({
  profile: profileKey,
  /** Only what this workspace changed on top of its profile. */
  overrides: z.record(z.string(), z.string()),
  /** Every setting, resolved: defaults, then the profile, then the changes. */
  practice: z.record(z.string(), z.string()),
  /** The settings where the changes make it differ from its profile. */
  differsFromProfile: z.array(z.string()),
});

const settingDescriptor = z.object({
  key: z.string(),
  label: z.string(),
  item: z.string().nullable(),
  group: z.string(),
  section: z.string(),
  source: z.string(),
  options: z.array(z.string()),
  /** Each option as METHOD.md §12.1 words it. */
  optionLabels: z.record(z.string(), z.string()),
  default: z.string(),
});

const profileDescriptor = z.object({
  key: profileKey,
  label: z.string(),
  for: z.string(),
  practice: z.record(z.string(), z.string()),
  thresholds: z.record(z.string(), z.unknown()),
});

/** Resolves the acting member, or refuses the way every other read does. */
async function actingMember(
  tx: OperationTx,
  workspaceId: string,
  userId: string | undefined,
): Promise<string> {
  if (!userId) {
    throw new OperationError("not_found", "No such workspace.");
  }
  const [member] = await tx
    .select({ id: workspaceMembers.id })
    .from(workspaceMembers)
    .where(
      activeOnly(
        workspaceMembers,
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, userId),
        eq(workspaceMembers.status, "active"),
      ),
    )
    .limit(1);
  if (!member) {
    throw new OperationError("not_found", "No such workspace.");
  }
  return member.id;
}

export const readPractice = defineReadAction({
  name: "practice.read",
  summary:
    "The METHOD.md §12 practice this workspace runs: its profile, its own changes and every setting resolved.",
  input: z.object({}),
  output: practiceState.extend({
    registry: z.array(settingDescriptor),
    profiles: z.array(profileDescriptor),
  }),
  access: ACCESS_LEVELS.view,
  async handler(context) {
    const db = drizzle(context.pool);
    const userId = context.actor.userId;
    if (!userId) {
      throw new OperationError("not_found", "No such workspace.");
    }
    return withContext(
      db,
      { workspaceId: context.workspaceId, userId },
      async (tx) => {
        const memberId = await actingMember(
          tx as OperationTx,
          context.workspaceId,
          userId,
        );
        // View, as `rhythm.read` is: every member may read the rules their
        // own OKRs are written under. Changing them is `full`.
        await getAccessScoped(tx as OperationTx, {
          workspaceId: context.workspaceId,
          memberId,
          resourceType: "workspace",
          resourceId: context.workspaceId,
          requires: ACCESS_LEVELS.view,
        });

        const state = practiceFromRow(
          await readRhythmRow(tx as OperationTx, context.workspaceId),
        );
        return {
          ...state,
          overrides: state.overrides as Record<string, string>,
          practice: state.practice as Record<string, string>,
          differsFromProfile: [...state.differsFromProfile],
          registry: PRACTICE_KEYS.map((key) => {
            const entry = PRACTICE[key];
            return {
              key,
              label: entry.label,
              item: "item" in entry ? (entry.item ?? null) : null,
              group: entry.group,
              section: entry.section,
              source: entry.source,
              options: [...entry.options],
              optionLabels: { ...entry.optionLabels } as Record<string, string>,
              default: entry.default,
            };
          }),
          profiles: PROFILE_KEYS.map((key) => ({
            key,
            label: PROFILES[key].label,
            for: PROFILES[key].for,
            practice: PROFILES[key].practice as Record<string, string>,
            thresholds: PROFILES[key].thresholds as Record<string, unknown>,
          })),
        };
      },
    );
  },
});

export const updatePractice = defineWriteAction({
  name: "practice.update",
  summary:
    "Changes some of this workspace's practice settings. A setting set to null goes back to its profile's value.",
  input: z.object({
    /** Sparse. Every key must be a §12 setting; null resets that one. */
    overrides: z
      .record(z.string(), z.string().nullable())
      .refine((value) => Object.keys(value).length > 0, {
        message: "nothing to update",
      }),
  }),
  output: practiceState,
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId }) {
      const values: Record<string, string> = {};
      const resets: string[] = [];
      for (const [key, value] of Object.entries(input.overrides)) {
        if (value === null) {
          resets.push(key);
          continue;
        }
        values[key] = value;
      }
      const { overrides: valid, problems } = validatePracticeOverrides({
        ...values,
        // A reset still has to name a real setting: removing a setting that
        // does not exist is the same mistake as choosing one. Checked by
        // validating the default, which always parses.
        ...Object.fromEntries(
          resets.map((key) => [
            key,
            key in PRACTICE
              ? PRACTICE[key as keyof typeof PRACTICE].default
              : null,
          ]),
        ),
      });
      if (problems.length > 0) {
        throw new OperationError(
          "forbidden",
          problems.map((problem) => problem.message).join(" "),
        );
      }

      await ensureRhythmSettingsInTx(tx, workspaceId);
      const stored = practiceFromRow(await readRhythmRow(tx, workspaceId));
      const profileValues = resolvePractice(stored.profile) as Record<
        string,
        string
      >;

      const next: Record<string, string> = {
        ...(stored.overrides as Record<string, string>),
      };
      for (const key of resets) {
        delete next[key];
      }
      for (const [key, value] of Object.entries(valid)) {
        // A change that equals the profile's own value is not a change, and
        // storing it would freeze it: it would keep winning after the profile
        // or the default itself moved. So it is dropped, which is also how a
        // screen that submits every field saves only what somebody changed.
        if (profileValues[key] === value) {
          delete next[key];
          continue;
        }
        next[key] = value as string;
      }

      // openokr:allow-mutation: the operation's own execute, on the
      // transaction runOperation opened. The change, the activity and the
      // audit row commit together.
      const [updated] = await tx
        .update(rhythmSettings)
        .set({ practice: next, updatedAt: new Date() })
        .where(eq(rhythmSettings.workspaceId, workspaceId))
        .returning({
          profile: rhythmSettings.profile,
          practice: rhythmSettings.practice,
        });
      if (!updated) {
        throw new Error("The rhythm settings row could not be updated.");
      }

      const state = practiceFromRow(updated);
      const keys = [...Object.keys(values), ...resets];
      return {
        result: {
          ...state,
          overrides: state.overrides as Record<string, string>,
          practice: state.practice as Record<string, string>,
          differsFromProfile: [...state.differsFromProfile],
        },
        activity: {
          kind: "practice.updated",
          subjectType: "workspace",
          subjectId: workspaceId,
          payload: { keys },
        },
        audit: {
          action: "practice.update",
          targetType: "workspace",
          targetId: workspaceId,
          payload: {
            set: valid,
            reset: resets,
            practice: next,
          },
        },
      };
    },
  }),
});

export const applyPracticeProfile = defineWriteAction({
  name: "practice.applyProfile",
  summary:
    "Chooses one of the five METHOD.md §12.2 profiles, with the §11 thresholds it sets. This workspace's own changes are kept.",
  input: z.object({ profile: profileKey }),
  output: practiceState.extend({
    /** The §11 thresholds the switch wrote. */
    thresholdsChanged: z.array(z.string()),
    /** Thresholds the new profile sets that this workspace had set itself. */
    thresholdsKept: z.array(z.string()),
  }),
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId }) {
      await ensureRhythmSettingsInTx(tx, workspaceId);
      const row = await readRhythmRow(tx, workspaceId);
      const before = practiceFromRow(row);
      const change = switchProfile(
        {
          profile: before.profile,
          overrides: before.overrides,
          thresholds: resolveRhythm(row).thresholds as Record<string, unknown>,
        },
        input.profile,
      );

      // Three thresholds have their own column, and the rest live in the
      // sparse override map (cycles/rhythm.ts). A value back at the canon is
      // stored as nothing in the map, and as the canon's value in a column,
      // which cannot be empty.
      const columns: Partial<
        Pick<
          typeof rhythmSettings.$inferInsert,
          "defaultCheckInFrequency" | "checkInAnchorDay" | "coachStrictness"
        >
      > = {};
      const patch: Record<string, unknown> = {};
      for (const threshold of change.thresholds) {
        if (threshold.key === "cadence.checkInFrequency") {
          columns.defaultCheckInFrequency =
            threshold.to as typeof columns.defaultCheckInFrequency;
        } else if (threshold.key === "cadence.anchorDay") {
          columns.checkInAnchorDay = threshold.to as number;
        } else if (threshold.key === "quality.coachStrictness") {
          columns.coachStrictness =
            threshold.to as typeof columns.coachStrictness;
        } else {
          patch[threshold.key] = threshold.toCanon ? null : threshold.to;
        }
      }

      // openokr:allow-mutation: same transaction, same reason as
      // practice.update above.
      const [updated] = await tx
        .update(rhythmSettings)
        .set({
          profile: input.profile,
          overrides: mergeOverrides(row?.overrides ?? {}, patch),
          ...columns,
          updatedAt: new Date(),
        })
        .where(eq(rhythmSettings.workspaceId, workspaceId))
        .returning({
          profile: rhythmSettings.profile,
          practice: rhythmSettings.practice,
        });
      if (!updated) {
        throw new Error("The rhythm settings row could not be updated.");
      }

      const state = practiceFromRow(updated);
      const thresholdsChanged = change.thresholds.map(
        (threshold) => threshold.key as string,
      );
      return {
        result: {
          ...state,
          overrides: state.overrides as Record<string, string>,
          practice: state.practice as Record<string, string>,
          differsFromProfile: [...state.differsFromProfile],
          thresholdsChanged,
          thresholdsKept: [...change.keptThresholds],
        },
        activity: {
          kind: "practice.profile_applied",
          subjectType: "workspace",
          subjectId: workspaceId,
          payload: { from: before.profile, to: input.profile },
        },
        audit: {
          action: "practice.apply_profile",
          targetType: "workspace",
          targetId: workspaceId,
          payload: {
            from: before.profile,
            to: input.profile,
            // The workspace's own changes survive the switch, so the audit
            // says which of them now override the profile just chosen.
            keptChanges: [...state.differsFromProfile],
            thresholds: change.thresholds.map((threshold) => ({
              key: threshold.key,
              from: threshold.from,
              to: threshold.to,
            })),
            keptThresholds: [...change.keptThresholds],
          },
        },
      };
    },
  }),
});
