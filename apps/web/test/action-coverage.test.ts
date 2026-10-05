import { existsSync, readdirSync, readFileSync } from "node:fs";
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
 *
 * **And every reason is checked, not read** (completeness review M-30). The
 * list used to be free text, and a free-text reason is only as true as whoever
 * wrote it: `sessions.create` was excused by an action that did not exist,
 * six assists by screens that never called them, trusted-domain joining by a
 * join route that never joined anybody (M-34), dependency removal by a canvas
 * write nobody wrote (M-35), and personal AI keys by a P7 row that does not
 * build them (M-36). Each kind of reason below makes a claim this file can
 * test, so the next false one fails the build instead of passing review.
 */

const APP = fileURLToPath(new URL("../app", import.meta.url));
const LIB = fileURLToPath(new URL("../lib", import.meta.url));
const ROOT = fileURLToPath(new URL("../../..", import.meta.url));

/**
 * The five kinds of reason, each with what it has to prove.
 *
 * - **`caller`**: code outside the browser calls it, and names it: an
 *   importer, a worker, the pipeline, an operator console that goes through a
 *   typed helper. The file must exist and must name the action.
 * - **`answeredBy`**: a read or a write a person never needs, because another
 *   action they do press answers the same question or makes the same change.
 *   That action must exist and must have a browser caller.
 * - **`apiOnly`**: offered on the REST surface, the command line and the agent
 *   endpoint, deliberately, with no screen. It must be in the committed
 *   OpenAPI document, which is those surfaces' own contract.
 * - **`notBuilt`**: a screen that should exist and does not. It must name the
 *   finding in `docs/COMPLETENESS-REVIEW.md` that owns building it, so a gap
 *   is a tracked gap and never a quiet one.
 * - **`plannedAs`**: the same thing for a screen the plan already owns rather
 *   than a review finding. It must name a task in
 *   `docs/development-plan/IMPLEMENTATION-PLAN.md`, which is the other place a
 *   gap is tracked. Added at P8-G13a, whose five role actions land one task
 *   before their screen: the gate's premise is that a gap is never quiet, and
 *   a planned task is as public as a finding.
 */
type Reason =
  | { readonly caller: string; readonly why: string }
  | { readonly answeredBy: string; readonly why: string }
  | { readonly apiOnly: true; readonly why: string }
  | { readonly notBuilt: string; readonly why: string }
  | { readonly plannedAs: string; readonly why: string };

const NO_BROWSER_PATH: Readonly<Record<string, Reason>> = {
  "workspace.provision": {
    caller: "packages/core/src/workspaces/provisioning.ts",
    why: "the pipeline calls it, from registration and the setup wizard",
  },
  "people.importMember": {
    caller: "packages/importer/src/flowyteam/mappers/organisation.ts",
    why: "the FlowyTeam importer brings people across through it",
  },
  "subscriptions.importWatcher": {
    caller: "packages/importer/src/flowyteam/mappers/collaboration.ts",
    why: "the FlowyTeam importer brings task watchers across through it",
  },
  "comments.importComment": {
    caller: "packages/importer/src/flowyteam/mappers/collaboration.ts",
    why: "the FlowyTeam importer brings task comments across through it",
  },
  "comments.replaceImportedBody": {
    caller: "packages/importer/src/flowyteam/mappers/files.ts",
    why: "the FlowyTeam importer rewrites an imported comment once its inline images are stored",
  },
  "goals.importCheckIn": {
    caller: "packages/importer/src/flowyteam/mappers/check-ins.ts",
    why: "the FlowyTeam importer brings check-in history across through it",
  },
  "blobs.prepareImport": {
    caller: "packages/importer/src/flowyteam/mappers/files.ts",
    why: "the FlowyTeam importer reserves a file's key through it before copying the bytes",
  },
  // M-24. The attach button presses both, through `storeUpload` in core,
  // which runs prepare, re-encode, put and claim in their order so the order
  // is one function rather than one caller's habit.
  "blobs.prepareUpload": {
    caller: "packages/core/src/blobs/upload.ts",
    why: "the attach button presses it through `storeUpload` in core, which reserves the key before the re-encoded bytes are written",
  },
  "blobs.claimUpload": {
    caller: "packages/core/src/blobs/upload.ts",
    why: "the attach button presses it through `storeUpload` in core, which claims what was written and holds it for a scan when there is a scanner",
  },
  "imports.startRun": {
    caller: "packages/core/src/imports/run.ts",
    why: "the pipeline calls it, when an import run begins, from the wizard and the command line alike",
  },
  "imports.finishRun": {
    caller: "packages/core/src/imports/run.ts",
    why: "the pipeline calls it, when an import run ends",
  },
  "copilot.recordAnswer": {
    caller: "packages/core/src/copilot/answer.ts",
    why: "the pipeline calls it, once the copilot's answer is complete",
  },
  "copilot.completeRun": {
    caller: "packages/core/src/copilot/background.ts",
    why: "the background run calls it from the outbox handler, with no browser in the picture at all, which is the point of P4-T14b-b",
  },
  "copilot.recordProposal": {
    caller: "packages/core/src/copilot/proposals.ts",
    why: "the pipeline calls it, when the copilot proposes a change the person then confirms",
  },
  // M-05. A person records the result by closing the cycle, which runs the
  // same function inside `cycles.close`.
  "cycles.snapshot": {
    caller: "packages/core/src/demo/builder.ts",
    why: "the demo builder records a closed cycle's result through it; a person records it by closing the cycle with `cycles.close`",
  },
  // The operator console presses it through the typed
  // `setLifecycleAsOperator` rather than by naming the action, so the scan of
  // the browser code walks past a caller that is real.
  "workspace.setLifecycle": {
    caller: "packages/core/src/operator/lifecycle.ts",
    why: "the operator console suspends, closes and reopens a workspace through the typed `setLifecycleAsOperator`, which runs this",
  },

  "goals.reviewDecision": {
    answeredBy: "decisions.forGoal",
    why: "the goal page shows the decision log from `decisions.forGoal`, which carries the same answer with its author and its session",
  },
  "ai.updateCustomModel": {
    answeredBy: "ai.addCustomModel",
    why: "the model catalogue changes a model by removing it and adding it again with `ai.addCustomModel`, so there is no edit form",
  },

  "workspace.overview": {
    apiOnly: true,
    why: "the Work Map composes its own reads for the map, the strip and the badges, and this answers a different shape for an API client",
  },
  "channels.listIdentities": {
    apiOnly: true,
    why: "a chat account is linked by its webhook when the member sends their code, which writes the same rows; this lists them for a script",
  },
  "channels.linkIdentity": {
    apiOnly: true,
    why: "a chat account is linked by its webhook when the member sends their code; this is the same link for an administrator's script",
  },
  "channels.send": {
    apiOnly: true,
    why: "the outbox relay delivers through the channel port directly; this is the door an agent or a script sends through",
  },
  "nudges.run": {
    apiOnly: true,
    why: "the scheduler runs the same code every hour; this is the door an administrator calls by hand when the scheduler is off",
  },
  "agents.create": {
    apiOnly: true,
    why: "a custom agent is created over REST or the command line; a screen for it waits on how a custom agent plans its own runs, which M-11 left for a person to decide",
  },
  "agents.startRun": {
    apiOnly: true,
    why: "the REST surface, the command line and the agent endpoint submit a task list; the outbox relay carries the run from there and the agents screen shows it (M-11)",
  },
  "agents.readRun": {
    apiOnly: true,
    why: "the agent endpoint reads a run it started; a person reads the same run on the agents screen through `agents.listRuns`",
  },
  "comments.previewNotify": {
    apiOnly: true,
    why: "the composer shows who a comment reaches from the thread it already has; this answers the same for an API client",
  },
  "tasks.linkedWork": {
    apiOnly: true,
    why: "the board's rail and the Coach's sweep read linked work through the same count in core; this answers it for an API client",
  },
  "sessions.votes": {
    apiOnly: true,
    why: "the session screen's stage panels carry their own tallies; this answers the raw votes for an API client",
  },
  "cycles.feedForward": {
    apiOnly: true,
    why: "a person feeds the next cycle by closing this one with `cycles.close`; this is an idempotent re-run for the command line",
  },
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

const registered: ReadonlySet<string> = new Set(actionNames());
const hasBrowserCaller = (name: string) => blob.includes(`"${name}"`);
const withoutCaller = actionNames().filter((name) => !hasBrowserCaller(name));

const offeredOnTheApi = new Set(
  Object.values(
    (
      JSON.parse(readFileSync(join(ROOT, "contract/openapi.json"), "utf8")) as {
        paths: Record<string, Record<string, { operationId?: string }>>;
      }
    ).paths,
  ).flatMap((path) =>
    Object.values(path).flatMap((operation) =>
      operation.operationId ? [operation.operationId] : [],
    ),
  ),
);

const review = readFileSync(join(ROOT, "docs/COMPLETENESS-REVIEW.md"), "utf8");
const plan = readFileSync(
  join(ROOT, "docs/development-plan/IMPLEMENTATION-PLAN.md"),
  "utf8",
);

const entries = Object.entries(NO_BROWSER_PATH);

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
    const empty = entries
      .filter(([, reason]) => reason.why.trim().length < 20)
      .map(([name]) => name);
    expect(empty).toEqual([]);
  });

  test("a claimed caller exists and names the action", () => {
    const false_ = entries.flatMap(([name, reason]) => {
      if (!("caller" in reason)) {
        return [];
      }
      const path = join(ROOT, reason.caller);
      if (!existsSync(path)) {
        return [`${name}: ${reason.caller} does not exist`];
      }
      return readFileSync(path, "utf8").includes(`"${name}"`)
        ? []
        : [`${name}: ${reason.caller} never names it`];
    });
    expect(false_).toEqual([]);
  });

  test("a read answered elsewhere is answered by something a person presses", () => {
    const false_ = entries.flatMap(([name, reason]) => {
      if (!("answeredBy" in reason)) {
        return [];
      }
      if (!registered.has(reason.answeredBy)) {
        return [`${name}: ${reason.answeredBy} is not an action`];
      }
      return hasBrowserCaller(reason.answeredBy)
        ? []
        : [`${name}: ${reason.answeredBy} has no browser caller either`];
    });
    expect(false_).toEqual([]);
  });

  test("an API-only action is on the API", () => {
    const false_ = entries
      .filter(
        ([name, reason]) => "apiOnly" in reason && !offeredOnTheApi.has(name),
      )
      .map(([name]) => name);
    expect(false_).toEqual([]);
  });

  test("a screen not built yet is a finding somebody owns", () => {
    const untracked = entries.flatMap(([name, reason]) => {
      if (!("notBuilt" in reason)) {
        return [];
      }
      return /^[HML]-\d{2}$/.test(reason.notBuilt) &&
        review.includes(`| ${reason.notBuilt} |`)
        ? []
        : [`${name}: ${reason.notBuilt} is not a finding in the review`];
    });
    expect(untracked).toEqual([]);
  });

  test("a screen the plan owns names a task that exists", () => {
    const untracked = entries.flatMap(([name, reason]) => {
      if (!("plannedAs" in reason)) {
        return [];
      }
      return /^P\d-[TG]\d{2}[a-z]?$/.test(reason.plannedAs) &&
        plan.includes(`### ${reason.plannedAs}:`)
        ? []
        : [`${name}: ${reason.plannedAs} is not a task in the plan`];
    });
    expect(untracked).toEqual([]);
  });

  test("every action a reason names exists", () => {
    // How `sessions.create` was excused by `sessions.schedule`, which was never
    // an action: a reason that cites the registry has to cite it truly.
    const invented = entries.flatMap(([name, reason]) =>
      [...reason.why.matchAll(/`([a-z][A-Za-z]*\.[a-z][A-Za-z]*)`/g)]
        .map((match) => match[1] ?? "")
        .filter((cited) => !registered.has(cited))
        .map((cited) => `${name}: cites ${cited}`),
    );
    expect(invented).toEqual([]);
  });
});
