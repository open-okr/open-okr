import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { actionNames } from "@openokr/core";
import { describe, expect, test } from "vitest";

/**
 * Every registered action either has a browser caller or a written reason
 * (P6-G27b, GAP-AUDIT §5).
 *
 * **The audit found actions nobody could reach and nobody had decided about.**
 * P6-G27a and P6-G27b gave a screen to the ones that wanted one. This is the
 * other half of the deliverable: the ones that stay unreachable say so, here,
 * with the reason beside them, so the next audit reads a decision instead of
 * counting the same gap again.
 *
 * **The list only shrinks.** An action added without a caller fails this test,
 * which forces the question at the moment somebody can still answer it rather
 * than at the next audit.
 */

const APP = fileURLToPath(new URL("../app", import.meta.url));
const LIB = fileURLToPath(new URL("../lib", import.meta.url));

/**
 * Why each action has no screen, in the words that make it a decision.
 *
 * Four reasons recur, and none of them is "not built yet":
 *
 * - **another surface owns it**: the command line, an importer, a channel
 *   webhook or the agent endpoint is the caller, and a button would be a
 *   second way to do one thing.
 * - **the pipeline calls it**: it is reached from another action or from a
 *   worker, never from a person.
 * - **it is an AI draft**: the copilot and the assists call these through the
 *   agent surface, and every one of them is hidden with the provider off.
 * - **it is a read a page does not need**: something else already answers the
 *   question the screen asks.
 */
const NO_BROWSER_PATH: Readonly<Record<string, string>> = {
  "workspace.overview":
    "a read the Work Map does not use: it composes its own reads for the map, the strip and the badges, and this one answers a different shape for the API",
  "workspace.provision":
    "the pipeline calls it, from registration and the wizard",
  "people.importMember": "another surface owns it: the importers",
  "subscriptions.importWatcher": "another surface owns it: the importers",
  "comments.importComment": "another surface owns it: the importers",
  "comments.replaceImportedBody": "another surface owns it: the importers",
  "goals.importCheckIn": "another surface owns it: the importers",
  "blobs.prepareImport": "another surface owns it: the importers",
  "imports.startRun": "the pipeline calls it, from an import run",
  "imports.finishRun": "the pipeline calls it, from an import run",
  "invitations.joinByTrustedDomain":
    "the pipeline calls it, from the join route once the domain matches",
  "channels.listIdentities": "another surface owns it: the channel webhooks",
  "channels.linkIdentity": "another surface owns it: the channel webhooks",
  "channels.send": "the pipeline calls it, from the outbox relay",
  "nudges.run": "the pipeline calls it, from the scheduler",
  "copilot.ask":
    "another surface owns it: the copilot panel posts to its own route",
  "copilot.recordAnswer": "the pipeline calls it, from the copilot route",
  "copilot.recordProposal": "the pipeline calls it, from the copilot route",
  "agents.create": "the pipeline calls it, from workspace provisioning",
  "agents.startRun":
    "another surface owns it: the agent endpoint and the scheduler",
  "agents.readRun": "another surface owns it: the agent endpoint",
  "ai.setPersonalCredential":
    "no screen yet, and it is P7's own row for personal keys",
  "ai.removePersonalCredential":
    "no screen yet, and it is P7's own row for personal keys",
  "ai.readOwnCredentialStatus":
    "no screen yet, and it is P7's own row for personal keys",
  "ai.updateCustomModel":
    "no screen yet, and it is P7's own row for the model catalogue",
  "workflow.setRevalidation":
    "it is an AI draft, offered through the phase assists",
  "workflow.setBaselineHealth":
    "it is an AI draft, offered through the phase assists",
  "workflow.setCapacityNotes":
    "it is an AI draft, offered through the phase assists",
  "workflow.calibrate": "it is an AI draft, offered through the phase assists",
  "kpis.recoveryDraft":
    "it is an AI draft, offered on the recovery board beside the corridor it is recovering from",
  "kpis.narrateTrend":
    "it is an AI draft, offered on the KPI detail beside the chart it narrates",
  "kpis.suggest":
    "it is an AI draft, offered while a KPI tree is being built rather than as a control of its own",
  "blockers.summarise":
    "it is an AI draft, offered on the blocker board and in the session's diagnose stage",
  "sessions.draftMinutes":
    "it is an AI draft, offered on the minutes screen once a session has closed",
  "sessions.proposeFromLearnings":
    "it is an AI draft, offered in the session's closing stage from what the retrospective said",
  "goals.draftRetrospective":
    "it is an AI draft, offered in the close form beside the account it is drafting",
  "goals.publishDraftedCheckIn":
    "the pipeline calls it, after a drafted check-in is accepted",
  "comments.previewNotify":
    "a read the composer does not use: it names who would be notified and the composer shows that from the thread it already has",
  "tasks.linkedWork":
    "a read no page needs: the goal page reads its initiatives directly",
  "goals.reviewDecision":
    "a read the goal page does not need: it shows the decision log from `decisions.forGoal`, which carries the same answer with its author and its session",
  "goals.removeDependency":
    "the alignment studio owns dependencies and removes them through its own canvas write",
  "sessions.create":
    "the sessions screen creates through `sessions.schedule`, which is the one a person uses",
  "sessions.votes":
    "a read the session screen does not need: the stage panels carry their own tallies",
};

function sources(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === ".next" || entry.name === "node_modules") {
        continue;
      }
      found.push(...sources(path));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      found.push(path);
    }
  }
  return found;
}

const blob = [...sources(APP), ...sources(LIB)]
  .map((path) => readFileSync(path, "utf8"))
  .join("\n");

const withoutCaller = actionNames().filter(
  (name) => !blob.includes(`"${name}"`),
);

describe("action coverage", () => {
  test("every action without a browser caller has a written reason", () => {
    const undecided = withoutCaller.filter(
      (name) => NO_BROWSER_PATH[name] === undefined,
    );
    // An action added without a caller fails here, which forces the question
    // at the moment somebody can still answer it.
    expect(undecided).toEqual([]);
  });

  test("no reason outlives the action it excused", () => {
    const named: readonly string[] = Object.keys(NO_BROWSER_PATH);
    const unreachable: readonly string[] = withoutCaller;
    const stale = named.filter((name) => !unreachable.includes(name));
    // Either the action gained a caller, in which case the line goes, or it
    // was renamed, in which case the line is pointing at nothing.
    expect(stale).toEqual([]);
  });

  test("the reasons are reasons, not shrugs", () => {
    const empty = Object.entries(NO_BROWSER_PATH)
      .filter(([, why]) => why.trim().length < 20)
      .map(([name]) => name);
    expect(empty).toEqual([]);
  });
});
