/**
 * The door a browser's errors come in by (docs/design/error-reporting.md D16,
 * D17, plan 0.7.0 E3).
 *
 * **Browser errors come to our own server, never straight to a tracker.** No
 * third-party script, no change to the content-security policy, nothing that
 * fails on an isolated network, and no DSN in the page for somebody to read
 * and flood the tracker with. Here they pass the same classifier, the same
 * scrub and the same caps as a server error.
 *
 * **A public write, so it is guarded like one:**
 *
 * | Guard | Rule |
 * |---|---|
 * | Session | Signed in, or nothing happens |
 * | Rate | 10 a minute per signed-in person, through the Cache port |
 * | Size | 16 KB of body at most, read no further than that |
 * | Shape | Zod, strict (`parseBrowserError`); frames are capped at 50 |
 *
 * **Nothing a member types reaches the tracker** (D6). The route is open to
 * any signed-in person, so a browser's message is always withheld and its
 * class, functions and files must have the shape of code.
 *
 * **It answers 204 every time**, accepted or refused, so the answer says
 * nothing about which guard turned a request away.
 */
import {
  BROWSER_ERROR_BODY_LIMIT,
  BROWSER_ERRORS_PER_MINUTE,
  describeBrowserError,
  type ErrorFrame,
  isExpectedBrowserError,
  parseBrowserError,
  reportDescribedError,
} from "@openokr/core";

interface ClientErrorSession {
  readonly userId: string;
  readonly workspaceId: string | null;
  readonly memberId: string | null;
}

export interface ClientErrorDeps {
  /** The signed-in person and their active workspace, or null. */
  session(): Promise<ClientErrorSession | null>;
  rateLimit(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<{ readonly allowed: boolean }>;
  resolveFrames(frames: readonly ErrorFrame[]): Promise<ErrorFrame[]>;
}

const noContent = (): Response => new Response(null, { status: 204 });

/** The body as text, or null past the limit. Reads no further than it. */
async function readCapped(
  request: Request,
  limit: number,
): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > limit) {
    return null;
  }
  const reader = request.body?.getReader();
  if (!reader) {
    return "";
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** Receives one browser error. Always 204. */
export async function receiveClientError(
  request: Request,
  deps: ClientErrorDeps,
): Promise<Response> {
  try {
    const session = await deps.session();
    if (!session) {
      return noContent();
    }
    const window = await deps.rateLimit(
      `client-errors:${session.userId}`,
      BROWSER_ERRORS_PER_MINUTE,
      60,
    );
    if (!window.allowed) {
      return noContent();
    }
    const text = await readCapped(request, BROWSER_ERROR_BODY_LIMIT);
    if (text === null) {
      return noContent();
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return noContent();
    }
    const body = parseBrowserError(json);
    if (!body) {
      return noContent();
    }
    if (isExpectedBrowserError(body)) {
      return noContent();
    }
    // Stricter than a server error's scrub: every word is the page's claim.
    const described = describeBrowserError(body);
    reportDescribedError(
      { ...described, frames: await deps.resolveFrames(described.frames) },
      {
        source: "browser",
        digest: body.digest ?? null,
        route: body.route ?? null,
        workspaceId: session.workspaceId,
        memberId: session.memberId,
        userId: session.userId,
        tags: { kind: body.kind },
      },
    );
  } catch {
    // A report that could not be taken is not the caller's problem.
  }
  return noContent();
}
