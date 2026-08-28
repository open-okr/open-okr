/**
 * The versioned REST surface (TECHNICAL-PLAN §14, P5-T07a).
 *
 * One handler for every action in the registry. The route table, the method, the
 * scope and the parameter list are all projected in `packages/core/src/api`, so
 * this file holds the transport and nothing else: read the token, resolve the
 * principal, check the scope, hand the input to the action, shape the answer.
 *
 * **The order matters and it is not rearrangeable.** Authenticate, then route,
 * then check the method, then the scope, then the input. Routing before
 * authenticating would let anybody with a network path enumerate which actions
 * this instance has, one 404 at a time. Checking the scope after running the
 * action would be checking it too late.
 *
 * **Nothing here decides who may do what.** The scope check narrows what a token
 * reaches; `can()` inside the action decides whether the member reaches it at
 * all, exactly as it does for the browser. Two gates, one of which this file
 * owns, and neither substitutes for the other.
 *
 * **Every refusal is a typed code.** A client branches on `error.code`, and a
 * fault it does not recognise says nothing about the schema behind it.
 */
import {
  type ActionName,
  API_RATE_LIMIT,
  API_RATE_WINDOW_SECONDS,
  type ApiError,
  apiError,
  bearerFrom,
  buildOpenApiDocument,
  callAction,
  errorFor,
  inputFrom,
  nextCursorFor,
  REST_ROUTES,
  type RestRoute,
  resolveApiToken,
  routeAt,
  stampTokenUse,
  statusFor,
  type TokenRejection,
} from "@openokr/core";
import type { NextRequest } from "next/server";
import { getCache } from "../../../../lib/cache";
import { getPool } from "../../../../lib/pool";

export const dynamic = "force-dynamic";

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

const fail = (error: ApiError): Response =>
  json({ error }, statusFor(error.code));

/**
 * What to say about a token that did not resolve.
 *
 * Each of these requires holding the pre-image of a stored digest, so telling
 * the holder that their token is revoked or expired reveals nothing they could
 * not already work out, and saves them an afternoon. A value that never matched
 * anything gets the flat sentence.
 */
const REJECTIONS: Readonly<Record<TokenRejection, string>> = {
  invalid: "That is not a valid token.",
  revoked: "That token has been revoked.",
  expired: "That token has expired.",
  wrong_audience:
    "That token is for the agent endpoint, not the REST surface. Mint one with the rest audience.",
  no_member: "The member that token belongs to is no longer active.",
};

/** The surface index, so a client with a token can discover the rest. */
function indexResponse(): Response {
  return json(
    {
      data: {
        version: "v1",
        actions: REST_ROUTES.map((route) => ({
          action: route.action,
          method: route.method,
          path: route.path,
          scope: route.scope,
          summary: route.summary,
          parameters: route.parameters,
          pages: route.page !== null,
        })),
      },
    },
    200,
  );
}

async function handle(
  request: NextRequest,
  segments: readonly string[],
  method: "GET" | "POST",
): Promise<Response> {
  const raw = bearerFrom(request.headers.get("authorization"));
  if (!raw) {
    return fail(
      apiError(
        "unauthenticated",
        "This surface needs a bearer token. Mint one in your account settings.",
      ),
    );
  }

  const pool = getPool();
  const now = new Date();
  const resolved = await resolveApiToken(pool, { raw, audience: "rest", now });
  if (resolved.kind === "rejected") {
    return fail(apiError("unauthenticated", REJECTIONS[resolved.reason]));
  }

  // Per token rather than per member: two services sharing one member's
  // authority should not be able to starve each other by accident.
  const limited = await getCache().rateLimit(
    `api:${resolved.tokenId}`,
    API_RATE_LIMIT,
    API_RATE_WINDOW_SECONDS,
  );
  if (!limited.allowed) {
    return fail(
      apiError(
        "rate_limited",
        `That is more than ${API_RATE_LIMIT} requests a minute on this token. Try again shortly.`,
      ),
    );
  }

  if (segments.length === 0) {
    return indexResponse();
  }

  // The document, generated from the registry on request rather than read from
  // the committed artifact (P5-T07b). It therefore describes *this* instance,
  // whatever it is running, and `pnpm check:contract` is what keeps the
  // committed copy honest. Both call the same builder, so they cannot disagree.
  if (segments.length === 1 && segments[0] === "openapi.json") {
    return json(buildOpenApiDocument(), 200);
  }

  const route = routeAt(segments);
  if (!route) {
    return fail(
      apiError(
        "unknown_action",
        `No action at /${segments.join("/")}. GET /api/v1 lists them.`,
      ),
    );
  }
  if (route.method !== method) {
    return fail(
      apiError(
        "method_not_allowed",
        `${route.action} is a ${route.safety} action, so it is ${route.method} rather than ${method}.`,
      ),
    );
  }
  if (!resolved.scopes.includes(route.scope)) {
    return fail(
      apiError(
        "insufficient_scope",
        `${route.action} needs the ${route.scope} scope. This token has: ${resolved.scopes.join(", ")}.`,
      ),
    );
  }

  const input = await readInput(request, route, method);
  if ("error" in input) {
    return fail(input.error);
  }

  try {
    const output = await callAction(
      {
        pool,
        workspaceId: resolved.workspaceId,
        actor: { kind: "human", userId: resolved.userId },
        // Named on the audit row of every write, in one place, so a call that
        // came in over the API is answerable a quarter later.
        channel: "api",
      },
      route.action as ActionName,
      // The action parses this with its own schema. Nothing here pre-validates
      // it: a second opinion on the shape is a second thing to disagree with.
      input.value as never,
    );

    const nextCursor = nextCursorFor(route, output);
    await stampTokenUse(pool, {
      workspaceId: resolved.workspaceId,
      tokenId: resolved.tokenId,
      now,
    });
    return json(
      nextCursor === null ? { data: output } : { data: output, nextCursor },
      200,
    );
  } catch (thrown) {
    return fail(errorFor(thrown));
  }
}

/** Query parameters for a read, a JSON body for a write. */
async function readInput(
  request: NextRequest,
  route: RestRoute,
  method: "GET" | "POST",
): Promise<{ value: unknown } | { error: ApiError }> {
  if (method === "GET") {
    const parsed = inputFrom(route, request.nextUrl.searchParams.entries());
    return parsed.kind === "ok"
      ? { value: parsed.input }
      : { error: parsed.error };
  }

  const text = await request.text();
  if (text.trim() === "") {
    // An empty body is an empty input, not a refusal: several write actions
    // take nothing.
    return { value: {} };
  }
  try {
    const body = JSON.parse(text);
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return {
        error: apiError("invalid_input", "The body must be a JSON object."),
      };
    }
    return { value: body };
  } catch {
    return { error: apiError("invalid_input", "The body is not valid JSON.") };
  }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ path?: string[] }> },
): Promise<Response> {
  const { path } = await context.params;
  return handle(request, path ?? [], "GET");
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ path?: string[] }> },
): Promise<Response> {
  const { path } = await context.params;
  return handle(request, path ?? [], "POST");
}
