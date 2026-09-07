/**
 * The two tools that make a research connector work (AI-NATIVE-PLAN.md §8.3,
 * P5-T09c).
 *
 * **Neither is an action, and that is the point.** Every other tool is one row
 * of the registry projected. These two are shapes a research client expects to
 * find and the registry has no single action for: one search across everything
 * rather than fifteen list calls, and one address resolver rather than a client
 * that has to know which action served which page. Design
 * p5-t00-agent-surface-design.md §5.3 names them as the exception.
 *
 * **Neither is a second read path.** `search` is the one index read every
 * surface asks: the search page, the command palette and this tool all answer
 * from `searchWorkspace`, filtered in SQL by the access context on each row.
 * `fetch` runs the read action that would have served the page, so `can()`
 * decides exactly as it does for a click; for the content types with no page of
 * their own it asks `mayRead`, the same function the copilot's citations ask.
 * Nothing here resolves access on its own.
 *
 * **The full-text path, deliberately.** No embedding function is passed, so
 * ranking is Postgres full text and the tool answers with the AI provider off,
 * which is what "deterministic first" means for a read. A provider would widen
 * the ranking and would not widen what anybody is permitted to see.
 *
 * At P5-T09c this stood on P4-T13's retrieval over `embeddings`, because the
 * search index was written by nothing. P5-T13 filled it, so the promise made on
 * that row is kept here: the tool and the palette answer from one function.
 *
 * **A refusal about an address says the same thing whatever the reason.** A goal
 * in somebody else's workspace and a goal that never existed answer with one
 * sentence, because the difference between them is itself a fact about a
 * workspace the caller cannot see.
 */
import { withWorkspace } from "@openokr/db";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { z } from "zod";
import { askingMemberId } from "../../actions/copilot.ts";
import { type ActionName, callAction } from "../../actions/registry.ts";
import { citationLabel } from "../../copilot/citations.ts";
import { mayRead } from "../../embeddings/governing.ts";
import {
  embeddableTextInTx,
  isEmbeddableType,
} from "../../embeddings/subjects.ts";
import { OperationError } from "../../operations/errors.ts";
import type { OperationTx } from "../../operations/operation.ts";
import { searchWorkspace } from "../../search/service.ts";
import type { KeyRing } from "../../secrets/key-ring.ts";
import { withoutTrailingSlashes } from "../../urls.ts";

/** Who is asking, and which instance they reached. */
export interface ResearchCaller {
  readonly workspaceId: string;
  readonly userId: string;
  /**
   * The instance's own base URL, when the transport knows it.
   *
   * The transport does and the dispatch does not: a citation is only worth
   * quoting if it is somewhere a person can open, and a bare path is not. Absent
   * is still correct, and the address falls back to the `openokr://` form that
   * `fetch` resolves.
   */
  readonly instanceUrl?: string;
  readonly ring?: KeyRing;
}

const SEARCH_INPUT = z.object({
  query: z.string().trim().min(1).max(500),
  /**
   * Narrows the answer to these content types. Free text rather than an enum:
   * the embeddable set grows with the product, and a tool schema that listed
   * today's ten would be a fourth place to keep them in step.
   */
  entityTypes: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  limit: z.number().int().min(1).max(25).optional(),
});

const FETCH_INPUT = z.object({
  url: z.string().trim().min(1).max(2048),
});

/** How much of a passage a search result carries back. */
const EXCERPT_LENGTH = 600;

/** What `search` answers with when the caller names no limit. */
const DEFAULT_SEARCH_LIMIT = 10;

/**
 * One tool the catalogue builds, described here rather than there.
 *
 * The catalogue owns the conversion from a Zod schema to a tool; this owns what
 * the two tools are. Keeping the specification here is what lets the handlers
 * and the schema they validate against sit in one file, so a field cannot be
 * added to one and missed by the other.
 */
export interface ResearchToolSpec {
  readonly name: string;
  readonly description: string;
  readonly input: z.ZodType;
  readonly scope: string;
}

export const RESEARCH_TOOL_SPECS: readonly ResearchToolSpec[] = [
  {
    name: "search",
    description:
      "Searches everything in this workspace the caller may read. Each result carries an address that fetch resolves.",
    input: SEARCH_INPUT,
    scope: "read",
  },
  {
    name: "fetch",
    description:
      "Reads one OpenOKR address as structured content with a citation. Takes a browser path, an absolute instance URL, or an openokr:// address.",
    input: FETCH_INPUT,
    scope: "read",
  },
];

const RESEARCH_TOOL_NAMES = new Set(RESEARCH_TOOL_SPECS.map((one) => one.name));

export function isResearchTool(name: string): boolean {
  return RESEARCH_TOOL_NAMES.has(name);
}

/**
 * The content types with a page of their own, and the action that serves it.
 *
 * The same declaration `MCP_RESOURCES` makes for its templates: the address's
 * word and the action's field are named separately, so a template reads as an
 * address rather than as a column name.
 */
const PAGE_ADDRESSES = [
  { entityType: "goal", path: "goals", action: "goals.read", field: "id" },
  { entityType: "kpi", path: "kpis", action: "kpis.detail", field: "kpiId" },
  { entityType: "space", path: "spaces", action: "spaces.read", field: "id" },
  {
    entityType: "session",
    path: "session",
    action: "sessions.read",
    field: "id",
  },
] as const;

type PageAddress = (typeof PAGE_ADDRESSES)[number];

const pageFor = (entityType: string): PageAddress | null =>
  PAGE_ADDRESSES.find((one) => one.entityType === entityType) ?? null;

const pageForPath = (segment: string): PageAddress | null =>
  PAGE_ADDRESSES.find((one) => one.path === segment) ?? null;

/** `key_result` as an address reads `key-result`. Nothing more than that. */
const slugFor = (entityType: string) => entityType.replaceAll("_", "-");
const typeForSlug = (slug: string) => slug.replaceAll("-", "_");

/** A word for a type, for the one sentence a refusal is allowed to say. */
const wordFor = (entityType: string) => entityType.replaceAll("_", " ");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ResolvedAddress {
  readonly entityType: string;
  readonly entityId: string;
}

/**
 * The entity one address names, or null.
 *
 * Three forms, because three are what people and agents actually hold: the path
 * somebody copies out of the browser, the absolute URL they paste from a
 * message, and the `openokr://` address the resource list handed the agent.
 *
 * An identifier that is not a UUID is not an address. Refusing here rather than
 * letting the action's schema refuse it is what keeps a malformed address and a
 * missing entity answering alike.
 */
export function parseAddress(raw: string): ResolvedAddress | null {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return null;
  }

  if (trimmed.toLowerCase().startsWith("openokr://")) {
    const rest = trimmed.slice("openokr://".length);
    const [slug, id] = splitAddress(rest);
    if (!slug || !id || !UUID.test(id)) {
      return null;
    }
    return { entityType: typeForSlug(slug.toLowerCase()), entityId: id };
  }

  const path = pathOf(trimmed);
  if (path === null) {
    return null;
  }
  const [segment, id] = splitAddress(path);
  if (!segment || !id || !UUID.test(id)) {
    return null;
  }
  const page = pageForPath(segment.toLowerCase());
  return page ? { entityType: page.entityType, entityId: id } : null;
}

/** The first two segments of an address, with its query and fragment dropped. */
function splitAddress(value: string): [string | null, string | null] {
  const withoutQuery = value.split("?")[0]?.split("#")[0] ?? "";
  const parts = withoutQuery.split("/").filter((part) => part !== "");
  return [parts[0] ?? null, parts[1] ?? null];
}

/**
 * The path part of a browser address, absolute or not, or null.
 *
 * Built with `URL` rather than a regular expression, and with a base so a bare
 * path parses through the same code as an absolute one. A scheme this product
 * does not serve is not an address.
 *
 * The host is read and discarded. One instance is reached by several names (a
 * hostname, an address on a private network, a tunnel a developer opened), and
 * refusing an address because its host is spelled differently would refuse
 * links people actually hold. Nothing hangs on it: the workspace on the grant
 * decides what the identifier resolves to, so an address copied from somebody
 * else's instance answers not-found here.
 */
function pathOf(value: string): string | null {
  try {
    const parsed = new URL(value, "https://address.invalid");
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return null;
    }
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return null;
  }
}

/**
 * The address an agent is handed back for one entity.
 *
 * A browser URL for anything with a page, because that is what a person opens.
 * The `openokr://` form for the rest, because a check-in has no page and an
 * address that pointed at its goal would cite the wrong thing.
 */
export function canonicalAddress(
  entityType: string,
  entityId: string,
  instanceUrl?: string,
): string {
  const page = pageFor(entityType);
  if (!page) {
    return `openokr://${slugFor(entityType)}/${entityId}`;
  }
  const path = `/${page.path}/${entityId}`;
  return instanceUrl ? `${withoutTrailingSlashes(instanceUrl)}${path}` : path;
}

export interface SearchResult {
  readonly id: string;
  readonly entityType: string;
  readonly title: string;
  readonly url: string;
  readonly excerpt: string;
  readonly score: number;
}

export interface FetchResult {
  readonly id: string;
  readonly entityType: string;
  readonly title: string;
  readonly url: string;
  /** The entity's own plain text, where it has any. */
  readonly text: string | null;
  /** The read action's own answer, or null when the type has no page. */
  readonly structured: unknown;
}

/**
 * Everything the caller may read that matches, most relevant first.
 *
 * The filtering is `EmbeddingService.retrieve`'s, unchanged: candidates are
 * filtered in SQL by the access context on each row. A member who loses access
 * to a space stops seeing its content on the next query, with no reindex.
 */
export async function runSearch(
  pool: Pool,
  caller: ResearchCaller,
  input: unknown,
): Promise<{ readonly results: readonly SearchResult[] }> {
  const parsed = SEARCH_INPUT.parse(input);
  const memberId = await callerMemberId(pool, caller);

  const hits = await searchWorkspace(pool, {
    workspaceId: caller.workspaceId,
    memberId,
    text: parsed.query,
    ...(parsed.entityTypes ? { entityTypes: parsed.entityTypes } : {}),
    limit: parsed.limit ?? DEFAULT_SEARCH_LIMIT,
  });

  return {
    results: hits.map((hit) => ({
      id: hit.entityId,
      entityType: hit.entityType,
      title: hit.title,
      url: canonicalAddress(hit.entityType, hit.entityId, caller.instanceUrl),
      // The index's own snippet, with the emphasis markers stripped: an agent
      // wants the words, and `<b>` around them is a decision for a screen.
      excerpt: excerpt(hit.snippet.replaceAll(/<\/?b>/g, "")),
      score: hit.rank,
    })),
  };
}

/**
 * One address as content, or the one sentence every refusal about an address
 * gives.
 */
export async function runFetch(
  pool: Pool,
  caller: ResearchCaller,
  input: unknown,
): Promise<FetchResult> {
  const parsed = FETCH_INPUT.parse(input);
  const address = parseAddress(parsed.url);
  if (!address) {
    // The caller's own words back, because the address they sent is the one
    // thing a refusal can safely name.
    throw new OperationError(
      "not_found",
      `There is nothing at "${parsed.url}".`,
    );
  }

  const page = pageFor(address.entityType);
  const url = canonicalAddress(
    address.entityType,
    address.entityId,
    caller.instanceUrl,
  );

  if (page) {
    // The action that would have served the page, so `can()` decides and a
    // refusal is the browser's own sentence.
    const structured = await callAction(
      {
        pool,
        workspaceId: caller.workspaceId,
        actor: { kind: "human", userId: caller.userId },
        channel: "mcp",
        ...(caller.ring ? { ring: caller.ring } : {}),
      },
      page.action as ActionName,
      { [page.field]: address.entityId } as never,
    );
    const text = isEmbeddableType(address.entityType)
      ? await readableText(pool, caller, address)
      : null;
    return {
      id: address.entityId,
      entityType: address.entityType,
      title: titleOf(structured) ?? (text ? citationLabel(text) : ""),
      url,
      text,
      structured,
    };
  }

  if (!isEmbeddableType(address.entityType)) {
    throw new OperationError(
      "not_found",
      `There is nothing at "${parsed.url}".`,
    );
  }

  const text = await readableText(pool, caller, address);
  if (text === null) {
    throw notFound(address.entityType);
  }
  return {
    id: address.entityId,
    entityType: address.entityType,
    title: citationLabel(text),
    url,
    text,
    structured: null,
  };
}

/** Runs whichever of the two the name means. */
export async function runResearchTool(
  pool: Pool,
  caller: ResearchCaller,
  name: string,
  input: unknown,
): Promise<unknown> {
  if (name === "search") {
    return runSearch(pool, caller, input);
  }
  if (name === "fetch") {
    return runFetch(pool, caller, input);
  }
  throw new OperationError("not_found", `There is no tool called "${name}".`);
}

/**
 * The entity's text when this member may read it, and null when they may not.
 *
 * `mayRead` then the same reader the worker embedded with, so a fetched passage
 * and an indexed one cannot come to disagree about what an entity says.
 */
async function readableText(
  pool: Pool,
  caller: ResearchCaller,
  address: ResolvedAddress,
): Promise<string | null> {
  if (!isEmbeddableType(address.entityType)) {
    return null;
  }
  const entityType = address.entityType;
  const memberId = await callerMemberId(pool, caller);
  return withWorkspace(drizzle(pool), caller.workspaceId, async (rawTx) => {
    const tx = rawTx as unknown as OperationTx;
    const readable = await mayRead(tx, {
      workspaceId: caller.workspaceId,
      memberId,
      entityType,
      entityId: address.entityId,
    });
    if (!readable) {
      return null;
    }
    return embeddableTextInTx(
      tx,
      caller.workspaceId,
      entityType,
      address.entityId,
    );
  });
}

/** The acting member, resolved the one way every other caller resolves it. */
function callerMemberId(pool: Pool, caller: ResearchCaller): Promise<string> {
  return askingMemberId({
    pool,
    workspaceId: caller.workspaceId,
    actor: { kind: "human", userId: caller.userId },
    ...(caller.ring ? { ring: caller.ring } : {}),
  });
}

/** The access getter's own wording, so both refusals read alike. */
const notFound = (entityType: string) =>
  new OperationError(
    "not_found",
    `No such ${wordFor(entityType)}, or you do not have access to it.`,
  );

/** A read action's own title, when its answer has one at the top level. */
function titleOf(value: unknown): string | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  for (const key of ["title", "name"]) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim() !== "") {
      return candidate.trim();
    }
  }
  return null;
}

function excerpt(content: string): string {
  const trimmed = content.trim();
  return trimmed.length <= EXCERPT_LENGTH
    ? trimmed
    : `${trimmed.slice(0, EXCERPT_LENGTH - 1).trimEnd()}…`;
}
