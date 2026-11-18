/**
 * The shared poor answers, with names and numbers replaced, for a person to
 * turn into evaluation fixtures by hand (plan 0.9.0 FB1,
 * docs/design/copilot-feedback.md FB-D5).
 *
 * **Never automatic.** Fixtures are committed to a public repository, so a
 * person reads each candidate, decides whether it is a real failure and writes
 * the fixture. This only prepares the reading: it writes nothing and sends
 * nothing, and replacing what it can find is a help to that person, not a
 * guarantee that nothing identifying is left.
 */
import { activeOnly, withWorkspace, workspaceMembers } from "@openokr/db";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { answerRatingsPage } from "../actions/ai-ratings.ts";
import type { OperationTx } from "../operations/operation.ts";

/** Who is who in one rating, so each name gets a role word. */
export interface FixtureNames {
  /** The member who rated and asked. */
  readonly asker: readonly string[];
  /** The asker's manager, when there is one. */
  readonly manager: readonly string[];
  /** Everybody else in the workspace. */
  readonly others: readonly string[];
}

const escapeRegex = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A name and its parts of three letters or more, longest first. */
function variants(names: readonly string[]): string[] {
  const all = new Set<string>();
  for (const name of names) {
    const full = name.trim();
    if (full === "") {
      continue;
    }
    all.add(full);
    for (const part of full.split(/\s+/)) {
      if (part.length >= 3) {
        all.add(part);
      }
    }
  }
  return [...all].sort((a, b) => b.length - a.length);
}

/**
 * Replaces what identifies a person or a figure with a placeholder.
 *
 * | Found | Becomes |
 * |---|---|
 * | The asker's name | `[the asker]` |
 * | Their manager's name | `[the asker's manager]` |
 * | Another member's name | `[a colleague]` |
 * | An email address | `[email]` |
 * | Text in double quotes, which is how the copilot names a title | `"[title]"` |
 * | A number, a date or a percentage | `[number]` |
 *
 * The `[n]` that cites a source is kept, because it says how the answer was
 * built and carries no figure of its own. Titles are replaced whole: the
 * kind of thing a title names is not stored on the answer, so the placeholder
 * does not claim to know it.
 */
export function redactForFixture(text: string, names: FixtureNames): string {
  let out = text;
  // Quoted titles first, so a name inside one goes with it.
  out = out.replace(/"[^"\n]{1,200}"/g, '"[title]"');
  out = out.replace(/\b[\w.+-]+@[\w-]+(\.[\w-]+)+\b/g, "[email]");
  const groups: readonly [readonly string[], string][] = [
    [names.asker, "[the asker]"],
    [names.manager, "[the asker's manager]"],
    [names.others, "[a colleague]"],
  ];
  // The asker is replaced before anybody else, so a shared first name is
  // read as the person who was asking.
  for (const [group, word] of groups) {
    for (const name of variants(group)) {
      out = out.replace(
        new RegExp(`(?<![\\w])${escapeRegex(name)}(?![\\w])`, "gi"),
        word,
      );
    }
  }
  // A citation marker stays; any other digit run is a figure.
  out = out.replace(/\[\d{1,3}\]|\d[\d.,:/-]*\d|\d/g, (found) =>
    found.startsWith("[") ? found : "[number]",
  );
  return out;
}

/** One poor answer a member shared, ready to be read. */
export interface FixtureCandidate {
  readonly model: string | null;
  readonly readCount: number;
  readonly note: string | null;
  readonly question: string | null;
  readonly answer: string;
}

/**
 * Every shared thumbs-down in a workspace, newest first, redacted.
 *
 * It reads through the same page the administrator's list reads, so a rating
 * that was not shared has no text to find here.
 */
export async function sharedPoorAnswers(
  pool: Pool,
  workspaceId: string,
): Promise<readonly FixtureCandidate[]> {
  return withWorkspace(drizzle(pool), workspaceId, async (rawTx) => {
    const tx = rawTx as unknown as OperationTx;
    const members = await tx
      .select({
        id: workspaceMembers.id,
        name: workspaceMembers.name,
        managerId: workspaceMembers.managerId,
      })
      .from(workspaceMembers)
      .where(
        activeOnly(
          workspaceMembers,
          eq(workspaceMembers.workspaceId, workspaceId),
        ),
      );
    const nameOf = new Map(members.map((member) => [member.id, member.name]));

    const found: FixtureCandidate[] = [];
    let cursor: { at: string; id: string } | undefined;
    for (;;) {
      const page = await answerRatingsPage(tx, workspaceId, {
        rating: "down",
        ...(cursor ? { cursor } : {}),
        limit: 100,
      });
      for (const row of page.rows) {
        if (!row.shared || row.answer === undefined) {
          continue;
        }
        const asker = members.find((member) => member.id === row.memberId);
        const managerName = asker?.managerId
          ? nameOf.get(asker.managerId)
          : undefined;
        const names: FixtureNames = {
          asker: [row.member],
          manager: managerName ? [managerName] : [],
          others: members
            .filter(
              (member) =>
                member.id !== row.memberId && member.id !== asker?.managerId,
            )
            .map((member) => member.name),
        };
        found.push({
          model: row.model,
          readCount: row.readCount,
          note: row.note ? redactForFixture(row.note, names) : null,
          question:
            row.question === null || row.question === undefined
              ? null
              : redactForFixture(row.question, names),
          answer: redactForFixture(row.answer, names),
        });
      }
      const last = page.rows.at(-1);
      if (!page.more || !last) {
        return found;
      }
      cursor = { at: last.at, id: last.id };
    }
  });
}
