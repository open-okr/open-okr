/**
 * The review assists (AI-NATIVE-PLAN.md §2.3, P4-T15c).
 *
 * Five, over deterministic paths that all already exist: the retro board, the
 * minutes, §8.6's diagnostic, a goal's check-in history, and the learnings a room
 * marked to carry forward. Every one of them **adds to** its deterministic answer
 * and never replaces it.
 *
 * The diagnostic is the one to read closely, because it is the row's acceptance
 * criterion. §8.6's verdict and its prescription come from `packages/method` and
 * are the same sentence whether or not a provider exists. The narrative sits
 * *beside* them: `review_diagnostics.ai_narrative` is a separate column from
 * `narrative`, and this writes only that one. A workspace with no provider reads
 * exactly what it read before, and one with a provider reads the same verdict
 * with a paragraph under it.
 *
 * **Every clustering and every proposal is bounded to one review.** A theme that
 * merged notes from two retros would describe a conversation nobody had, so the
 * notes handed to the model come from one session's board and the response is
 * positional over that list.
 */
import {
  activeOnly,
  checkIns,
  learnings,
  okrSessions,
  retroNotes,
  withContext,
  workspaceMembers,
} from "@openokr/db";
import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { REVIEW_ASSIST_KEYS } from "../ai/assist-keys.ts";
import { checkFeatureAvailability } from "../ai/budgets.ts";
import { OperationError, type OperationTx } from "../operations/operation.ts";
import { excerptRichText } from "../rich-text/excerpt.ts";
import { type ActionCallContext, defineReadAction } from "./define.ts";
import { readGoal } from "./goals.ts";
import { readDiagnostic, readMinutes } from "./sessions.ts";

/** How many notes, learnings or check-ins an assist is shown. */
const ITEM_LIMIT = 60;

const allowed = async (
  context: ActionCallContext,
  featureKey: string,
): Promise<boolean> =>
  (
    await checkFeatureAvailability(context.pool, {
      workspaceId: context.workspaceId,
      featureKey,
      defaultTier: "balanced",
    })
  ).available;

/** The acting member, or not-found. */
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

/** Runs a read inside one transaction, with the member resolved first. */
async function inSession<T>(
  context: ActionCallContext,
  run: (tx: OperationTx, memberId: string) => Promise<T>,
): Promise<T> {
  const userId = context.actor.userId;
  return withContext(
    drizzle(context.pool),
    { workspaceId: context.workspaceId, userId: userId ?? "" },
    async (rawTx) => {
      const tx = rawTx as unknown as OperationTx;
      const memberId = await actingMember(tx, context.workspaceId, userId);
      return run(tx, memberId);
    },
  );
}

/**
 * Groups a review's retro notes into themes, before the dots are spent.
 *
 * **Positional, and bounded to one session.** The model is given this board's
 * notes numbered and answers with numbers, so a theme cannot contain a note from
 * another retro and an index out of range is dropped. Nothing is written: the
 * themes are a lens over the board a facilitator can ignore.
 */
export const clusterRetroNotes = defineReadAction({
  name: "sessions.clusterRetro",
  summary:
    "Groups one review's retro notes into themes, before the dot vote, without writing anything.",
  input: z.object({ sessionId: z.uuid() }),
  output: z
    .object({
      themes: z.array(
        z.object({
          title: z.string(),
          /** The notes in it, by their own ids. */
          noteIds: z.array(z.uuid()),
        }),
      ),
      /** Notes no theme claimed, which is a real answer rather than a failure. */
      unclustered: z.array(z.uuid()),
    })
    .nullable(),
  access: ACCESS_LEVELS.view,
  async handler(context, input) {
    const drafter = context.drafter;
    if (!drafter?.clusterNotes) {
      return null;
    }
    if (!(await allowed(context, REVIEW_ASSIST_KEYS.clusterRetro))) {
      return null;
    }

    const notes = await inSession(context, async (tx) => {
      // The session has to exist and be this workspace's before its notes are
      // read, so a session id from elsewhere finds nothing.
      const [session] = await tx
        .select({ id: okrSessions.id })
        .from(okrSessions)
        .where(
          activeOnly(
            okrSessions,
            eq(okrSessions.workspaceId, context.workspaceId),
            eq(okrSessions.id, input.sessionId),
          ),
        )
        .limit(1);
      if (!session) {
        throw new OperationError("not_found", "No such session.");
      }
      return tx
        .select({
          id: retroNotes.id,
          text: retroNotes.text,
          columnKey: retroNotes.columnKey,
        })
        .from(retroNotes)
        .where(
          activeOnly(
            retroNotes,
            eq(retroNotes.workspaceId, context.workspaceId),
            eq(retroNotes.sessionId, input.sessionId),
          ),
        )
        .orderBy(asc(retroNotes.createdAt))
        .limit(ITEM_LIMIT);
    });

    if (notes.length < 3) {
      // Two notes are not themes. Clustering them would be theatre.
      return null;
    }

    let clustered: Awaited<
      ReturnType<NonNullable<typeof drafter.clusterNotes>>
    >;
    try {
      clustered = await drafter.clusterNotes({
        notes: notes.map((note) => ({
          text: note.text,
          column: note.columnKey,
        })),
      });
    } catch {
      return null;
    }
    if (!clustered || clustered.themes.length === 0) {
      return null;
    }

    const claimed = new Set<string>();
    const themes = clustered.themes
      .map((theme) => ({
        title: theme.title.trim(),
        noteIds: [...new Set(theme.noteNumbers)]
          .filter(
            (number) =>
              Number.isInteger(number) && number >= 1 && number <= notes.length,
          )
          .map((number) => notes[number - 1]?.id)
          .filter((id): id is string => id !== undefined),
      }))
      .filter((theme) => theme.title !== "" && theme.noteIds.length > 0);
    for (const theme of themes) {
      for (const id of theme.noteIds) {
        claimed.add(id);
      }
    }

    return {
      themes,
      unclustered: notes
        .map((note) => note.id)
        .filter((id) => !claimed.has(id)),
    };
  },
});

/**
 * Narrates §8.6's diagnostic, beside the verdict rather than instead of it.
 *
 * The acceptance criterion this row turns on. `sessions.diagnostic` is read
 * first, and the verdict, the diagnosis and the prescription in the response are
 * that read's, untouched. The narrative is the only thing the model contributes,
 * and it is dropped entirely when the model produces nothing usable.
 */
export const narrateDiagnostic = defineReadAction({
  name: "sessions.narrateDiagnostic",
  summary:
    "Narrates §8.6's diagnostic with this cycle's specifics, beside the verdict and never instead of it.",
  input: z.object({ sessionId: z.uuid() }),
  output: z
    .object({
      /** §8.6's own, from `packages/method`, unchanged. */
      verdict: z.string().nullable(),
      diagnosis: z.string().nullable(),
      prescription: z.string().nullable(),
      /** The model's paragraph, or null. Additive, always. */
      narrative: z.string().nullable(),
    })
    .nullable(),
  access: ACCESS_LEVELS.view,
  async handler(context, input) {
    // Read first and unconditionally, so the deterministic answer is what this
    // returns even when everything below declines.
    const diagnostic = await readDiagnostic.handler(context, input);
    if (!diagnostic.readable || diagnostic.verdict === null) {
      return null;
    }

    const deterministic = {
      verdict: diagnostic.verdict,
      diagnosis: diagnostic.diagnosis,
      prescription: diagnostic.prescription,
    };

    const drafter = context.drafter;
    if (!drafter?.narrateDiagnostic) {
      return { ...deterministic, narrative: null };
    }
    if (!(await allowed(context, REVIEW_ASSIST_KEYS.narrateDiagnostic))) {
      return { ...deterministic, narrative: null };
    }

    let narrative: string | null = null;
    try {
      narrative = await drafter.narrateDiagnostic({
        verdict: diagnostic.verdict,
        diagnosis: diagnostic.diagnosis ?? "",
        prescription: diagnostic.prescription ?? "",
        cycleScore: diagnostic.cycleScore ?? 0,
        rhythmScore: diagnostic.rhythmScore ?? 0,
      });
    } catch {
      return { ...deterministic, narrative: null };
    }

    return {
      ...deterministic,
      narrative:
        narrative === null || narrative.trim() === "" ? null : narrative.trim(),
    };
  },
});

/** Drafts the review minutes from the record the session already holds. */
export const draftMinutes = defineReadAction({
  name: "sessions.draftMinutes",
  summary:
    "Drafts the review minutes as prose over the record the session already holds.",
  input: z.object({ sessionId: z.uuid() }),
  output: z.object({ narrative: z.string() }).nullable(),
  access: ACCESS_LEVELS.view,
  async handler(context, input) {
    const drafter = context.drafter;
    if (!drafter?.draftMinutes) {
      return null;
    }
    if (!(await allowed(context, REVIEW_ASSIST_KEYS.draftMinutes))) {
      return null;
    }

    // The minutes read is the record. Nothing here re-derives it, so the draft
    // cannot describe a review the minutes do not.
    const minutes = await readMinutes.handler(context, input);

    let narrative: string | null = null;
    try {
      narrative = await drafter.draftMinutes({
        sections: minutesSections(minutes),
      });
    } catch {
      return null;
    }
    return narrative === null || narrative.trim() === ""
      ? null
      : { narrative: narrative.trim() };
  },
});

/**
 * The minutes as labelled text, which is all a model needs of them.
 *
 * Built by walking the read's own shape rather than by naming its fields, so a
 * section added to the minutes reaches the draft without a change here. Values
 * that are objects are dropped: an identifier or a nested row is not something to
 * put in front of a model.
 */
function minutesSections(
  minutes: Record<string, unknown>,
): readonly { readonly label: string; readonly body: string }[] {
  const sections: { label: string; body: string }[] = [];
  for (const [label, value] of Object.entries(minutes)) {
    if (typeof value === "string" && value.trim() !== "") {
      sections.push({ label, body: value });
      continue;
    }
    if (Array.isArray(value)) {
      const lines = value
        .map((entry) =>
          typeof entry === "string"
            ? entry
            : entry !== null && typeof entry === "object"
              ? Object.entries(entry as Record<string, unknown>)
                  .filter(
                    ([key, inner]) =>
                      typeof inner === "string" &&
                      inner.trim() !== "" &&
                      !key.toLowerCase().endsWith("id"),
                  )
                  .map(([, inner]) => String(inner))
                  .join(" — ")
              : "",
        )
        .filter((line) => line.trim() !== "");
      if (lines.length > 0) {
        sections.push({ label, body: lines.join("\n") });
      }
    }
  }
  return sections;
}

/** Drafts a goal's retrospective from its own check-in history. */
export const draftRetrospective = defineReadAction({
  name: "goals.draftRetrospective",
  summary:
    "Drafts a goal's closing retrospective from its published check-ins, as plain text a person edits.",
  input: z.object({ goalId: z.uuid() }),
  output: z.object({ narrative: z.string() }).nullable(),
  access: ACCESS_LEVELS.edit,
  async handler(context, input) {
    const drafter = context.drafter;
    if (!drafter?.draftRetrospective) {
      return null;
    }
    if (!(await allowed(context, REVIEW_ASSIST_KEYS.draftRetrospective))) {
      return null;
    }

    // Through the getter, so a goal this member cannot read answers not-found
    // before a model is told anything about it.
    const goal = await readGoal.handler(context, { id: input.goalId });

    const history = await inSession(context, async (tx) =>
      tx
        .select({
          status: checkIns.status,
          confidence: checkIns.confidence,
          narrative: checkIns.narrative,
          publishedAt: checkIns.publishedAt,
        })
        .from(checkIns)
        .where(
          // `subject_type` and `subject_id`, not `goal_id`: a check-in names
          // what it is about generically, and today the only subject is a goal.
          activeOnly(
            checkIns,
            eq(checkIns.workspaceId, context.workspaceId),
            eq(checkIns.subjectType, "goal"),
            eq(checkIns.subjectId, input.goalId),
            // Published only. A draft check-in is somebody's unfinished
            // sentence, and the same rule the embedder follows (P4-T13a).
            eq(checkIns.state, "published"),
          ),
        )
        .orderBy(asc(checkIns.publishedAt))
        .limit(ITEM_LIMIT),
    );
    if (history.length === 0) {
      // Nothing happened on the record, so there is nothing to write it up from.
      return null;
    }

    let narrative: string | null = null;
    try {
      narrative = await drafter.draftRetrospective({
        goalTitle: goal.title,
        checkIns: history.map((entry) => ({
          period:
            entry.publishedAt === null
              ? "unknown"
              : entry.publishedAt.toISOString().slice(0, 10),
          // A published check-in without a status is one somebody published
          // before choosing one, which the form allows. Named rather than
          // dropped: it is still a week that happened.
          status: entry.status ?? "not stated",
          confidence:
            entry.confidence === null ? null : Number(entry.confidence),
          narrative:
            entry.narrative === null
              ? ""
              : excerptRichText(entry.narrative as never, 600),
        })),
      });
    } catch {
      return null;
    }
    return narrative === null || narrative.trim() === ""
      ? null
      : { narrative: narrative.trim() };
  },
});

/**
 * Proposes next-cycle objectives from the learnings a room marked to carry.
 *
 * **Every proposal cites the learning it came from**, by index into the list the
 * model was shown, and one that cites nothing is dropped. §8.9 hands learnings
 * forward so the next cycle answers them; a proposal with no learning behind it
 * is just an objective somebody could have typed, and this is not the place for
 * that.
 */
export const proposeFromLearnings = defineReadAction({
  name: "sessions.proposeFromLearnings",
  summary:
    "Proposes next-cycle objectives from the learnings marked to carry forward, each citing its learning.",
  input: z.object({ sessionId: z.uuid() }),
  output: z
    .array(
      z.object({
        title: z.string(),
        /** The learning it came from, by its own id. Never absent. */
        learningId: z.uuid(),
        learningText: z.string(),
        why: z.string(),
      }),
    )
    .nullable(),
  access: ACCESS_LEVELS.view,
  async handler(context, input) {
    const drafter = context.drafter;
    if (!drafter?.proposeObjectives) {
      return null;
    }
    if (!(await allowed(context, REVIEW_ASSIST_KEYS.proposeObjectives))) {
      return null;
    }

    const carried = await inSession(context, async (tx) =>
      tx
        .select({ id: learnings.id, text: learnings.text })
        .from(learnings)
        .where(
          activeOnly(
            learnings,
            eq(learnings.workspaceId, context.workspaceId),
            eq(learnings.sessionId, input.sessionId),
            eq(learnings.carryForward, true),
          ),
        )
        .orderBy(asc(learnings.createdAt))
        .limit(ITEM_LIMIT),
    );
    if (carried.length === 0) {
      return null;
    }

    let proposed: Awaited<
      ReturnType<NonNullable<typeof drafter.proposeObjectives>>
    >;
    try {
      proposed = await drafter.proposeObjectives({
        learnings: carried.map((learning) => learning.text),
      });
    } catch {
      return null;
    }
    if (!proposed || proposed.length === 0) {
      return null;
    }

    const resolved = proposed
      .map((objective) => {
        const index = objective.learningNumber;
        if (
          !Number.isInteger(index) ||
          index < 1 ||
          index > carried.length ||
          objective.title.trim() === ""
        ) {
          return null;
        }
        const learning = carried[index - 1];
        return learning
          ? {
              title: objective.title.trim(),
              learningId: learning.id,
              learningText: learning.text,
              why: objective.why.trim(),
            }
          : null;
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

    return resolved.length === 0 ? null : resolved;
  },
});
