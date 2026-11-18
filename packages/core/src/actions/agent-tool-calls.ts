/**
 * Reading the record of agent tool calls (docs/design/agent-tool-calls.md
 * D14, D15, plan 0.7.0 A2).
 *
 * A member sees their own agent's calls, beside the connection or the token on
 * their own page. An administrator sees totals for external agents with no
 * member named, and, since plan 0.9.0 L3, each read the copilot made with the
 * member it read for, the tool, the outcome and the time (copilot-live-data.md
 * acceptance 10): the copilot reads as a person, so who it read for is the
 * point of the list. Another member's agent connections are A4's screen.
 */
import {
  activeOnly,
  aiToolCalls,
  apiTokens,
  oauthGrants,
  withWorkspace,
  workspaceMembers,
} from "@openokr/db";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { OperationError } from "../operations/operation.ts";
import { actingMemberId } from "./api-tokens.ts";
import { defineReadAction } from "./define.ts";

const DAY = 86_400_000;

/** How many of the copilot's latest reads the administrator's list shows. */
const COPILOT_RECENT_READS = 20;

const callRow = z.object({
  tool: z.string().nullable(),
  outcome: z.string(),
  calledAt: z.string(),
});

export const listOwnToolCalls = defineReadAction({
  name: "connections.toolCalls",
  agentSurface: false,
  summary:
    "The last calls one of your own agents made through a connection or an agent token, and this week's counts.",
  input: z.object({
    kind: z.enum(["grant", "token"]),
    id: z.uuid(),
  }),
  output: z.object({
    calls: z.array(callRow),
    week: z.object({ calls: z.number().int(), refused: z.number().int() }),
  }),
  access: ACCESS_LEVELS.view,
  async handler(context, input) {
    const db = drizzle(context.pool);
    return withWorkspace(db, context.workspaceId, async (tx) => {
      const memberId = await actingMemberId(
        tx,
        context.workspaceId,
        context.actor.userId,
      );
      // Theirs, or not-found: a grant or a token that is somebody else's
      // answers exactly as one that does not exist (D14).
      const owned =
        input.kind === "grant"
          ? await tx
              .select({ id: oauthGrants.id })
              .from(oauthGrants)
              .where(
                activeOnly(
                  oauthGrants,
                  eq(oauthGrants.id, input.id),
                  eq(oauthGrants.memberId, memberId),
                ),
              )
              .limit(1)
          : await tx
              .select({ id: apiTokens.id })
              .from(apiTokens)
              .where(
                activeOnly(
                  apiTokens,
                  eq(apiTokens.id, input.id),
                  eq(apiTokens.memberId, memberId),
                ),
              )
              .limit(1);
      if (owned.length === 0) {
        throw new OperationError("not_found", "No such connection.");
      }
      const connection =
        input.kind === "grant"
          ? eq(aiToolCalls.grantId, input.id)
          : eq(aiToolCalls.tokenId, input.id);
      const calls = await tx
        .select({
          tool: aiToolCalls.tool,
          outcome: aiToolCalls.outcome,
          calledAt: aiToolCalls.calledAt,
        })
        .from(aiToolCalls)
        .where(and(eq(aiToolCalls.memberId, memberId), connection))
        .orderBy(desc(aiToolCalls.calledAt))
        .limit(50);
      const since = new Date(Date.now() - 7 * DAY);
      const [week] = await tx
        .select({
          calls: sql<number>`count(*)::int`,
          refused: sql<number>`count(*) filter (where ${aiToolCalls.outcome} <> 'ok')::int`,
        })
        .from(aiToolCalls)
        .where(
          and(
            eq(aiToolCalls.memberId, memberId),
            connection,
            gte(aiToolCalls.calledAt, since),
          ),
        );
      return {
        calls: calls.map((row) => ({
          tool: row.tool,
          outcome: row.outcome,
          calledAt: row.calledAt.toISOString(),
        })),
        week: { calls: week?.calls ?? 0, refused: week?.refused ?? 0 },
      };
    });
  },
});

export const readToolCallSummary = defineReadAction({
  name: "ai.readToolCallSummary",
  agentSurface: false,
  summary:
    "How much external agents were used in this workspace over 30 days, and how often refused, with no member named, and the copilot's reads over the same days with the member each was made for.",
  input: z.object({}),
  output: z.object({
    calls: z.number().int(),
    refused: z.number().int(),
    busiestTools: z.array(
      z.object({ tool: z.string(), calls: z.number().int() }),
    ),
    /** The copilot's reads, counted apart from external agents' calls. */
    copilot: z.object({
      calls: z.number().int(),
      refused: z.number().int(),
      /** The latest reads, newest first. */
      recent: z.array(
        z.object({
          member: z.string(),
          tool: z.string().nullable(),
          outcome: z.string(),
          calledAt: z.string(),
        }),
      ),
    }),
  }),
  access: ACCESS_LEVELS.full,
  async handler(context) {
    const db = drizzle(context.pool);
    const since = new Date(Date.now() - 30 * DAY);
    return withWorkspace(db, context.workspaceId, async (tx) => {
      const [totals] = await tx
        .select({
          calls: sql<number>`count(*)::int`,
          refused: sql<number>`count(*) filter (where ${aiToolCalls.outcome} <> 'ok')::int`,
        })
        .from(aiToolCalls)
        .where(
          and(
            eq(aiToolCalls.workspaceId, context.workspaceId),
            eq(aiToolCalls.source, "mcp"),
            gte(aiToolCalls.calledAt, since),
          ),
        );
      const busiest = await tx
        .select({
          tool: aiToolCalls.tool,
          calls: sql<number>`count(*)::int`,
        })
        .from(aiToolCalls)
        .where(
          and(
            eq(aiToolCalls.workspaceId, context.workspaceId),
            eq(aiToolCalls.source, "mcp"),
            gte(aiToolCalls.calledAt, since),
            sql`${aiToolCalls.tool} is not null`,
          ),
        )
        .groupBy(aiToolCalls.tool)
        .orderBy(desc(sql`count(*)`))
        .limit(5);
      const copilotOnly = and(
        eq(aiToolCalls.workspaceId, context.workspaceId),
        eq(aiToolCalls.source, "copilot"),
        gte(aiToolCalls.calledAt, since),
      );
      const [copilotTotals] = await tx
        .select({
          calls: sql<number>`count(*)::int`,
          refused: sql<number>`count(*) filter (where ${aiToolCalls.outcome} <> 'ok')::int`,
        })
        .from(aiToolCalls)
        .where(copilotOnly);
      const copilotRecent = await tx
        .select({
          member: workspaceMembers.name,
          tool: aiToolCalls.tool,
          outcome: aiToolCalls.outcome,
          calledAt: aiToolCalls.calledAt,
        })
        .from(aiToolCalls)
        .innerJoin(
          workspaceMembers,
          eq(workspaceMembers.id, aiToolCalls.memberId),
        )
        .where(copilotOnly)
        .orderBy(desc(aiToolCalls.calledAt), desc(aiToolCalls.id))
        .limit(COPILOT_RECENT_READS);
      return {
        calls: totals?.calls ?? 0,
        refused: totals?.refused ?? 0,
        busiestTools: busiest.map((row) => ({
          tool: row.tool as string,
          calls: row.calls,
        })),
        copilot: {
          calls: copilotTotals?.calls ?? 0,
          refused: copilotTotals?.refused ?? 0,
          recent: copilotRecent.map((row) => ({
            member: row.member,
            tool: row.tool,
            outcome: row.outcome,
            calledAt: row.calledAt.toISOString(),
          })),
        },
      };
    });
  },
});
