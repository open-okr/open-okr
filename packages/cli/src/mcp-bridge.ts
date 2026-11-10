/**
 * `okr mcp`: a desktop agent's standard input and output, bridged to the
 * instance's agent endpoint (docs/design/agent-stdio.md, plan 0.7.0 A1).
 *
 * **A bridge, not a second server (T1).** Each JSON-RPC message on standard
 * input is posted to `/api/mcp` with the profile's agent token, and the answer
 * is written to standard output, one message per line. Every check an agent
 * meets, scopes, rate limits, the record of each call, stays on the server.
 *
 * **Only an agent token (T2)**, stored as `mcpToken` by `okr login
 * --mcp-token`. The profile's REST token is never sent here.
 *
 * **Nothing of the messages is logged (T3).** They can hold workspace content;
 * this writes them to standard output and nowhere else.
 *
 * **One message at a time, in order (T4)**, as standard input and output
 * requires. A refusal from the server is passed through as the server wrote
 * it. An instance that cannot be reached answers the request with a JSON-RPC
 * error naming the address, and the bridge keeps running.
 */
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

/** JSON-RPC 2.0's "server error" range, for a failure on the way there. */
const UNREACHABLE = -32000;
const PARSE_ERROR = -32700;

export interface BridgeOptions {
  /** The instance, as the profile names it. */
  readonly url: string;
  /** An agent token, minted for the `mcp` audience. */
  readonly token: string;
  readonly input: Readable;
  readonly output: Writable;
  readonly fetch?: typeof globalThis.fetch;
}

/** The id a JSON-RPC message carries, or undefined for a notification. */
function idOf(message: unknown): string | number | null | undefined {
  if (typeof message !== "object" || message === null) {
    return null;
  }
  if (!("id" in message)) {
    return undefined;
  }
  const id = (message as { id?: unknown }).id;
  return typeof id === "string" || typeof id === "number" ? id : null;
}

function endpointOf(url: string): string {
  let end = url.length;
  while (end > 0 && url.charCodeAt(end - 1) === 47) {
    end -= 1;
  }
  return `${url.slice(0, end)}/api/mcp`;
}

/**
 * Runs the bridge until standard input closes. Resolves when it has, so the
 * process can exit with the agent.
 */
export async function runMcpBridge(options: BridgeOptions): Promise<void> {
  const call = options.fetch ?? globalThis.fetch;
  const endpoint = endpointOf(options.url);
  const write = (message: unknown) =>
    new Promise<void>((done) => {
      options.output.write(`${JSON.stringify(message)}\n`, () => done());
    });
  const failure = (id: string | number | null, code: number, text: string) =>
    write({ jsonrpc: "2.0", id, error: { code, message: text } });

  // What the server said after `initialize`, sent back on every later call.
  let session: string | null = null;
  let protocolVersion: string | null = null;

  const lines = createInterface({ input: options.input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (line.trim() === "") {
      continue;
    }
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      await failure(null, PARSE_ERROR, "That line is not JSON.");
      continue;
    }
    const id = idOf(message);

    let response: Response;
    try {
      response = await call(endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.token}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...(session ? { "mcp-session-id": session } : {}),
          ...(protocolVersion
            ? { "mcp-protocol-version": protocolVersion }
            : {}),
        },
        body: line,
      });
    } catch (error) {
      // A notification is answered by nobody, even when it could not be sent.
      if (id !== undefined) {
        await failure(
          id,
          UNREACHABLE,
          `Could not reach ${options.url}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      continue;
    }

    session = response.headers.get("mcp-session-id") ?? session;
    const text = await response.text();
    if (text.trim() === "") {
      // Accepted with nothing to say: what a notification gets.
      continue;
    }
    // The endpoint answers JSON, but the protocol allows an event stream, so
    // its `data:` lines are passed on as messages too.
    if (
      (response.headers.get("content-type") ?? "").includes("text/event-stream")
    ) {
      for (const data of text
        .split("\n")
        .filter((candidate) => candidate.startsWith("data:"))) {
        try {
          await write(JSON.parse(data.slice(5).trim()));
        } catch {
          // A line that is not a message is not passed on.
        }
      }
      continue;
    }
    let answer: unknown;
    try {
      answer = JSON.parse(text);
    } catch {
      if (id !== undefined) {
        await failure(
          id,
          UNREACHABLE,
          `${options.url} answered ${response.status} with something that is not JSON.`,
        );
      }
      continue;
    }
    const version = (
      answer as { result?: { protocolVersion?: unknown } } | null
    )?.result?.protocolVersion;
    if (typeof version === "string") {
      protocolVersion = version;
    }
    // A JSON-RPC answer, success or refusal, goes through as it came. A
    // refusal before JSON-RPC (a token the endpoint would not take) is said
    // as an error on the request it answers.
    if (typeof answer === "object" && answer !== null && "jsonrpc" in answer) {
      await write(answer);
    } else if (id !== undefined) {
      const said = (answer as { error?: unknown; message?: unknown } | null)
        ?.message;
      await failure(
        id,
        UNREACHABLE,
        typeof said === "string"
          ? said
          : `${options.url} refused the call (${response.status}).`,
      );
    }
  }
}
