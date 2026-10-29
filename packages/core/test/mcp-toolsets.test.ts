import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import {
  dispatchTool,
  MCP_PROMPTS,
  MCP_TOOLS,
  offeredTools,
  parseToolsets,
  TOOLSET_NAMES,
  TOOLSETS,
  type ToolsetName,
  toolsetOf,
} from "../src/index.ts";

/**
 * A catalogue an agent can hold (docs/design/mcp-toolsets.md, MCP UAT BUG-004).
 *
 * The agent endpoint offered all 415 tools to every connection. These hold the
 * design's acceptance criteria: the default is the 61 `core` tools, a token is
 * shown only what its scopes can call, the importer's and the scheduler's
 * actions are not tools, and the list and the call agree.
 */

const FULL = ["read", "write", "destructive"];
const NOT_FOR_AGENTS = [
  "people.importMember",
  "subscriptions.importWatcher",
  "goals.importCheckIn",
  "comments.importComment",
  "comments.replaceImportedBody",
  "blobs.prepareImport",
  "imports.startRun",
  "imports.finishRun",
  "notifications.drainBatches",
  "blobs.reapOrphans",
  "channels.sweepMessageLog",
  "copilot.recordAnswer",
  "copilot.completeRun",
  "copilot.recordProposal",
  "workspace.provision",
  "ai.recordCredentialCheck",
  "tokens.create",
  "tokens.revoke",
  "tokens.approveDevice",
  "tokens.pendingDevice",
  // AI assists. The agent path carries no drafter, because the MCP server
  // makes no outbound AI calls (agent-surface.md §5.1), so each of these
  // answers null to every agent (mcp-audit-2026-10-29, finding 16).
  "goals.draftObjective",
  "goals.rewriteKeyResult",
  "goals.decomposeKeyResult",
  "goals.suggestMeasure",
  "goals.suggestParent",
  "goals.draftRetrospective",
  "goals.parseFilter",
  "kpis.suggest",
  "kpis.narrateTrend",
  "comments.summarise",
  "blockers.summarise",
  "sessions.clusterRetro",
  "sessions.draftMinutes",
  "sessions.narrateDiagnostic",
  "sessions.narrateDigest",
  "imports.proposeMapping",
  "copilot.availability",
];

const chosen = (raw: string | null): ReadonlySet<ToolsetName> => {
  const choice = parseToolsets(raw);
  if (choice.kind !== "ok") {
    throw new Error(choice.message);
  }
  return choice.toolsets;
};

/** No database is touched before a toolset refusal, so none is given. */
const NO_POOL = {} as Pool;

describe("placement", () => {
  it("puts every tool in exactly one toolset", () => {
    const misplaced = MCP_TOOLS.map((tool) => tool.name).filter(
      (name) =>
        TOOLSET_NAMES.filter((toolset) => TOOLSETS[toolset].has(name))
          .length !== 1,
    );
    expect(misplaced).toEqual([]);
  });

  it("keeps every toolset under the 128 tools some clients cap at", () => {
    // mcp-toolsets.md §0; admin alone was 137 (mcp-audit-2026-10-29, 7).
    for (const toolset of TOOLSET_NAMES) {
      const offered = offeredTools(MCP_TOOLS, FULL, new Set([toolset]));
      expect(offered.length, toolset).toBeLessThanOrEqual(128);
    }
  });

  it("puts the live room's own moves in room, apart from facilitation", () => {
    // Votes, reveals, the mic and anonymous answers only make sense for the
    // people in the room (METHOD.md §7.2, §8.3, §8.5).
    for (const name of [
      "sessions.castVote",
      "sessions.revealVotes",
      "sessions.passMic",
      "sessions.giveKudos",
      "sessions.submitProcessHealth",
    ]) {
      expect(TOOLSETS.room.has(name), name).toBe(true);
    }
    for (const name of ["sessions.scoreKeyResult", "sessions.setNextAction"]) {
      expect(TOOLSETS.facilitation.has(name), name).toBe(true);
    }
  });

  it("puts providers and connections in integrations, apart from admin", () => {
    for (const name of [
      "ai.setWorkspaceCredential",
      "channels.connect",
      "sso.updateConnection",
      "imports.runTable",
    ]) {
      expect(TOOLSETS.integrations.has(name), name).toBe(true);
    }
  });

  it("lets the default connection publish and approve a drafted objective", () => {
    // METHOD.md §2.9: the owner publishes their own draft and the reviewer
    // approves it, beside goals.create and review.inbox in core.
    expect(TOOLSETS.core.has("goals.publishDraft")).toBe(true);
    expect(TOOLSETS.core.has("goals.approveDraft")).toBe(true);
  });

  it("names no tool that does not exist", () => {
    const known = new Set(MCP_TOOLS.map((tool) => tool.name));
    const stale = TOOLSET_NAMES.flatMap((toolset) => [
      ...TOOLSETS[toolset],
    ]).filter((name) => !known.has(name));
    expect(stale).toEqual([]);
  });

  it("puts every tool a prompt cites in core", () => {
    const names = new Set(MCP_TOOLS.map((tool) => tool.name));
    const cited = MCP_PROMPTS.flatMap(
      (prompt) =>
        prompt
          .render({})
          .match(/\b[a-z]+\.[a-z][A-Za-z]+\b/g)
          ?.filter((name) => names.has(name)) ?? [],
    );
    expect(cited.length).toBeGreaterThan(0);
    expect(cited.filter((name) => toolsetOf(name) !== "core")).toEqual([]);
  });
});

describe("what a connection is offered", () => {
  it("is the core toolset when it names none", () => {
    const offered = offeredTools(MCP_TOOLS, FULL, chosen(null)).map(
      (tool) => tool.name,
    );
    expect(offered).toHaveLength(61);
    expect(offered).toEqual(expect.arrayContaining(["search", "fetch"]));
  });

  it("is never a write or a destructive tool for a read-only token", () => {
    const offered = offeredTools(MCP_TOOLS, ["read"], chosen("all"));
    expect(offered.length).toBeGreaterThan(0);
    expect(offered.filter((tool) => tool.scope !== "read")).toEqual([]);
  });

  it("is every agent tool for all", () => {
    expect(offeredTools(MCP_TOOLS, FULL, chosen("all"))).toHaveLength(
      MCP_TOOLS.length,
    );
  });

  it("never includes an action that is not for agents", () => {
    const names = new Set(MCP_TOOLS.map((tool) => tool.name));
    expect(NOT_FOR_AGENTS.filter((name) => names.has(name))).toEqual([]);
  });
});

describe("choosing toolsets", () => {
  it("refuses an unknown name and lists the choices", () => {
    const choice = parseToolsets("core,nonsense");
    expect(choice.kind).toBe("unknown");
    expect(choice.kind === "unknown" && choice.message).toBe(
      "There is no toolset called nonsense. Choose from core, work, facilitation, room, admin, integrations, all.",
    );
  });

  it("reads all as every toolset", () => {
    expect([...chosen("all")].sort()).toEqual([...TOOLSET_NAMES].sort());
  });
});

describe("a call outside the chosen toolsets", () => {
  it("is refused with the toolset that holds the tool", async () => {
    const result = await dispatchTool(
      NO_POOL,
      {
        workspaceId: "w",
        userId: "u",
        scopes: FULL,
        toolsets: chosen(null),
      },
      "sessions.advanceStage",
      { id: "00000000-0000-0000-0000-000000000000" },
    );
    expect(result).toEqual({
      isError: true,
      text: "sessions.advanceStage is in the facilitation toolset, which this connection did not choose. Add ?toolsets=core,facilitation to the server address.",
    });
  });

  it("is not a tool at all when the action is not for agents", async () => {
    const result = await dispatchTool(
      NO_POOL,
      { workspaceId: "w", userId: "u", scopes: FULL, toolsets: chosen("all") },
      "comments.importComment",
      {},
    );
    expect(result.isError).toBe(true);
    expect(result.text).toBe(
      'There is no tool called "comments.importComment".',
    );
  });
});
