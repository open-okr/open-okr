/**
 * The agent endpoint (AI-NATIVE-PLAN.md §8.3, P5-T09b).
 *
 * The resource the discovery documents have named since P5-T08b. Transport and
 * nothing else: every decision is in `packages/core`, every protocol detail is
 * in `packages/adapters`, and this file is the checks that have to happen before
 * either of them runs.
 *
 * **The order is not rearrangeable.** Origin, then token, then version, then the
 * rate limit, then the session, then the protocol. Validating the origin first
 * is what stops a page in a browser from being talked into opening a session
 * against a local agent's instance; resolving the token before touching the
 * protocol is what stops an unauthenticated caller from learning which tools
 * exist, one refusal at a time.
 *
 * **Two kinds of bearer, one principal.** A hosted agent holds an OAuth access
 * token from the consent screen. A local agent that cannot open a browser holds
 * an agent token its member minted on the tokens screen (completeness review
 * M-12). Both resolve to one member in one workspace with the same three scopes,
 * and a REST token is refused here exactly as an agent token is refused at the
 * REST surface.
 *
 * **The session is this product's record, not the transport's memory.** The
 * transport runs stateless, because a server built per request has no memory to
 * keep session state in, and a module map of transports stops working the moment
 * a second instance answers a request. So the identifier is generated here at
 * `initialize`, written against the grant, and checked against that same grant
 * on every later request. It authorises nothing: the token on each request is
 * resolved from scratch, so a grant revoked a second ago is refused a second
 * ago. **An agent token gets no session**, because a session is recorded
 * against a grant and a token has none. The protocol lets a server assign no
 * session identifier, and what a session would record, that the token is in
 * use, the tokens screen already shows as its last use.
 *
 * **An unauthorised answer carries the challenge.** RFC 9728 §5.1: the header
 * points at the resource metadata, so a client that arrived without a token
 * learns where to go rather than only that it was refused.
 *
 * **A limited answer is the protocol's own error.** A 429 with `Retry-After`,
 * and a JSON-RPC error in the body answering the request's own id, so a client
 * that reads either learns to wait rather than retry at once.
 */
import { McpAgentServer } from "@openokr/adapters";
import {
  type AgentRejection,
  API_RATE_LIMIT,
  API_RATE_WINDOW_SECONDS,
  agentRateKey,
  bearerFrom,
  challengeHeader,
  closeSessionFor,
  dispatchResource,
  dispatchTool,
  MCP_PROMPTS,
  MCP_RESOURCES,
  MCP_TOOLS,
  negotiateVersion,
  newSessionId,
  originAllowed,
  recordSessionFor,
  resolveAgentPrincipal,
  resourceIdentifier,
  SUPPORTED_PROTOCOL_VERSIONS,
  sessionFor,
  stampSessionUse,
} from "@openokr/core";
import type { NextRequest } from "next/server";
import { getCache } from "../../../lib/cache";
import { instanceIssuer } from "../../../lib/issuer";
import { getPool } from "../../../lib/pool";
import { retryAfter } from "../../../lib/retry-after";
import { getKeyRing } from "../../../lib/secrets";

export const dynamic = "force-dynamic";

/** What this build reports as the server's own version. */
const SERVER_VERSION = "1.0.0";

const SESSION_HEADER = "mcp-session-id";

const problem = (
  status: number,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

/** The method a JSON-RPC body names, or an empty string. */
function methodOf(body: unknown): string {
  if (typeof body !== "object" || body === null) {
    return "";
  }
  const method = (body as Record<string, unknown>).method;
  return typeof method === "string" ? method : "";
}

/**
 * The id a JSON-RPC request carries, or null.
 *
 * Null for a batch, a notification or no body at all, which is what JSON-RPC
 * 2.0 §5 says an error answers when it cannot name the request.
 */
function requestIdOf(body: unknown): string | number | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return null;
  }
  const id = (body as Record<string, unknown>).id;
  return typeof id === "string" || typeof id === "number" ? id : null;
}

/**
 * What to say about a bearer that did not resolve.
 *
 * One sentence for almost everything, because telling a stranger which of their
 * guesses came close is a map. The exception is a real REST token at the wrong
 * door: whoever holds it minted it, and saying which kind to mint instead saves
 * them an afternoon.
 */
function refusalFor(reason: AgentRejection): string {
  return reason === "wrong_audience"
    ? "That token is for the REST surface, not the agent endpoint. Mint an agent token under Account, then API tokens."
    : "That token is not one this instance will accept.";
}

/**
 * JSON-RPC's code for a server error the specification leaves to the server.
 *
 * The same code the transport itself answers with when it refuses a request, so
 * a client that handles one handles both.
 */
const JSON_RPC_SERVER_ERROR = -32000;

async function answer(request: NextRequest): Promise<Response> {
  const issuer = instanceIssuer();

  // 1. Origin. A request with none is a program rather than a page, which is
  // the ordinary case for an agent; one that names somewhere else is a browser
  // that was talked into pointing here.
  if (!originAllowed(request.headers.get("origin"), issuer)) {
    return problem(403, {
      error: "forbidden",
      error_description: "That origin may not open a session here.",
    });
  }

  // 2. The token, resolved from scratch on every request.
  const raw = bearerFrom(request.headers.get("authorization"));
  if (!raw) {
    return problem(
      401,
      {
        error: "unauthorized",
        error_description: "This endpoint needs an access token.",
      },
      { "www-authenticate": challengeHeader(issuer) },
    );
  }

  const pool = getPool();
  const resolved = await resolveAgentPrincipal(pool, {
    raw,
    resource: resourceIdentifier(issuer),
    now: new Date(),
  });
  if (resolved.kind !== "ok") {
    return problem(
      401,
      {
        error: "invalid_token",
        error_description: refusalFor(resolved.reason),
      },
      {
        "www-authenticate": challengeHeader(issuer, { error: "invalid_token" }),
      },
    );
  }

  // 3. The protocol version. Refusing with the list this server speaks is what
  // lets a client fall back rather than guess.
  const version = negotiateVersion(request.headers.get("mcp-protocol-version"));
  if (!version) {
    return problem(400, {
      error: "unsupported_protocol_version",
      error_description: `This server speaks ${SUPPORTED_PROTOCOL_VERSIONS.join(", ")}.`,
    });
  }

  // The body is read here and handed on as a fresh request: deciding whether
  // this is an `initialize` needs to see it, and a stream reads once.
  let body: unknown = null;
  let rawBody = "";
  if (request.method === "POST") {
    rawBody = await request.text();
    try {
      body = rawBody === "" ? null : JSON.parse(rawBody);
    } catch {
      return problem(400, {
        error: "invalid_request",
        error_description: "That body could not be read as JSON.",
      });
    }
  }

  // 4. The rate limit, per grant or per agent token, with the REST surface's
  // own allowance. After the body, so the refusal can answer the request's own
  // id; reading a body is cheap next to running a tool.
  const limited = await getCache().rateLimit(
    agentRateKey(resolved),
    API_RATE_LIMIT,
    API_RATE_WINDOW_SECONDS,
  );
  if (!limited.allowed) {
    const wait = retryAfter(limited.resetSeconds);
    return problem(
      429,
      {
        jsonrpc: "2.0",
        error: {
          code: JSON_RPC_SERVER_ERROR,
          message: `That is more than ${API_RATE_LIMIT} requests a minute on this connection. Try again in ${wait} seconds.`,
          data: { retryAfterSeconds: Number(wait) },
        },
        id: requestIdOf(body),
      },
      { "retry-after": wait },
    );
  }

  // 5. The session, which is ours rather than the transport's.
  const presented = request.headers.get(SESSION_HEADER);
  if (presented) {
    // A session belonging to another grant, or one already closed, is not a
    // session at all, and an agent token holds none. A bad request rather
    // than a 401, because the token was fine and the session was not.
    const found =
      resolved.via === "grant" ? await sessionFor(pool, presented) : null;
    if (
      resolved.via !== "grant" ||
      !found ||
      found.closedAt !== null ||
      found.grantId !== resolved.grantId
    ) {
      return problem(400, {
        error: "invalid_session",
        error_description: "That session is not one this connection holds.",
      });
    }
    if (request.method === "DELETE") {
      await closeSessionFor(pool, {
        workspaceId: resolved.workspaceId,
        sessionId: presented,
        now: new Date(),
      });
      return new Response(null, { status: 204 });
    }
    await stampSessionUse(pool, {
      workspaceId: resolved.workspaceId,
      sessionId: presented,
      now: new Date(),
    });
  }

  const principal = {
    workspaceId: resolved.workspaceId,
    userId: resolved.userId,
    scopes: resolved.scopes,
    // Only the transport knows which instance it is serving, and a citation
    // worth quoting is one a person can open (P5-T09c).
    instanceUrl: issuer,
  };
  const ring = getKeyRing();

  const server = new McpAgentServer({
    name: "OpenOKR",
    version: SERVER_VERSION,
    tools: MCP_TOOLS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: tool.annotations,
    })),
    resources: MCP_RESOURCES.map((resource) => ({
      uriTemplate: resource.uriTemplate,
      name: resource.name,
      description: resource.description,
      mimeType: resource.mimeType,
    })),
    prompts: MCP_PROMPTS.map((prompt) => ({
      name: prompt.name,
      description: prompt.description,
      arguments: prompt.arguments,
    })),
    dispatch: (name, input) => dispatchTool(pool, principal, name, input, ring),
    readResource: (uri) =>
      dispatchResource(pool, principal, uri, MCP_RESOURCES, ring),
  });

  const answered = await server.handle(
    new Request(request.url, {
      method: request.method,
      headers: request.headers,
      ...(request.method === "POST" ? { body: rawBody } : {}),
    }),
  );

  // An `initialize` that worked opens a session, and its identifier goes back
  // in the header a client sends on everything after it. A grant's only: an
  // agent token's connection runs without one.
  if (
    resolved.via === "grant" &&
    methodOf(body) === "initialize" &&
    answered.status < 400
  ) {
    const sessionId = newSessionId();
    await recordSessionFor(pool, {
      workspaceId: resolved.workspaceId,
      grantId: resolved.grantId,
      sessionId,
      protocolVersion: version,
      now: new Date(),
    });
    const headers = new Headers(answered.headers);
    headers.set(SESSION_HEADER, sessionId);
    return new Response(answered.body, { status: answered.status, headers });
  }

  return answered;
}

export const POST = answer;
export const GET = answer;
export const DELETE = answer;
