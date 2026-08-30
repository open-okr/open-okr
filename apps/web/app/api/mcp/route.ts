/**
 * The agent endpoint (AI-NATIVE-PLAN.md §8.3, P5-T09b).
 *
 * The resource the discovery documents have named since P5-T08b. Transport and
 * nothing else: every decision is in `packages/core`, every protocol detail is
 * in `packages/adapters`, and this file is the checks that have to happen before
 * either of them runs.
 *
 * **The order is not rearrangeable.** Origin, then token, then version, then the
 * session, then the protocol. Validating the origin first is what stops a page
 * in a browser from being talked into opening a session against a local agent's
 * instance; resolving the token before touching the protocol is what stops an
 * unauthenticated caller from learning which tools exist, one refusal at a time.
 *
 * **The session is this product's record, not the transport's memory.** The
 * transport runs stateless, because a server built per request has no memory to
 * keep session state in, and a module map of transports stops working the moment
 * a second instance answers a request. So the identifier is generated here at
 * `initialize`, written against the grant, and checked against that same grant
 * on every later request. It authorises nothing: the token on each request is
 * resolved from scratch, so a grant revoked a second ago is refused a second
 * ago.
 *
 * **An unauthorised answer carries the challenge.** RFC 9728 §5.1: the header
 * points at the resource metadata, so a client that arrived without a token
 * learns where to go rather than only that it was refused.
 */
import { McpAgentServer } from "@openokr/adapters";
import {
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
  resolveAccessToken,
  resourceIdentifier,
  SUPPORTED_PROTOCOL_VERSIONS,
  sessionFor,
  stampSessionUse,
} from "@openokr/core";
import type { NextRequest } from "next/server";
import { instanceIssuer } from "../../../lib/issuer";
import { getPool } from "../../../lib/pool";
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
  const resolved = await resolveAccessToken(pool, {
    raw,
    resource: resourceIdentifier(issuer),
    now: new Date(),
  });
  if (resolved.kind !== "ok") {
    return problem(
      401,
      {
        error: "invalid_token",
        error_description: "That token is not one this instance will accept.",
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

  // 4. The session, which is ours rather than the transport's.
  const presented = request.headers.get(SESSION_HEADER);
  if (presented) {
    const found = await sessionFor(pool, presented);
    // A session belonging to another grant, or one already closed, is not a
    // session at all. A bad request rather than a 401, because the token was
    // fine and the session was not.
    if (
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
  // in the header a client sends on everything after it.
  if (methodOf(body) === "initialize" && answered.status < 400) {
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
