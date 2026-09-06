/**
 * The port an external agent reaches the product through (AI-NATIVE-PLAN.md
 * §8.3, P5-T09b).
 *
 * **The protocol is a vendor here, and it is treated as one.** The Model Context
 * Protocol SDK is the only thing that knows about JSON-RPC framing, session
 * headers, streaming and version negotiation, and it lives behind this port for
 * the same reason a mail provider does: the application should be able to answer
 * "what tools are there and who may call them" without knowing how a message is
 * wrapped.
 *
 * **Nothing in this port decides anything.** It carries a catalogue in and a
 * dispatch function out. What a tool does, whether a caller may call it, and
 * what the answer looks like are all decided in `packages/core`, by the same
 * `can()` a click goes through. That is what makes the transport swappable and
 * the permission story single.
 */

/** One tool, in the terms the protocol needs. Built from the action registry. */
export interface AgentTool {
  readonly name: string;
  readonly description: string;
  /** JSON Schema, as the registry's own Zod schema converts to. */
  readonly inputSchema: Record<string, unknown>;
  readonly annotations: {
    readonly readOnlyHint: boolean;
    readonly destructiveHint: boolean;
    readonly idempotentHint: boolean;
  };
}

export interface AgentResource {
  readonly uriTemplate: string;
  readonly name: string;
  readonly description: string;
  readonly mimeType: string;
}

export interface AgentPrompt {
  readonly name: string;
  readonly description: string;
  readonly arguments: readonly {
    readonly name: string;
    readonly description: string;
    readonly required: boolean;
  }[];
}

/**
 * What running one tool answers with.
 *
 * A refusal is a result rather than a thrown error, because the protocol has a
 * place for one: `isError` on the result is what lets an agent read a denial
 * and say so, instead of seeing a transport fault and retrying.
 */
export interface AgentToolResult {
  readonly text: string;
  readonly isError: boolean;
}

/** Runs one tool. Supplied by the caller, which is where every decision lives. */
export type AgentDispatch = (
  name: string,
  input: Record<string, unknown>,
) => Promise<AgentToolResult>;

/** Reads one resource by the URI an agent asked for. */
export type AgentResourceReader = (uri: string) => Promise<AgentToolResult>;

export interface AgentServerConfig {
  /** What the server calls itself when a client asks. */
  readonly name: string;
  readonly version: string;
  readonly tools: readonly AgentTool[];
  readonly resources: readonly AgentResource[];
  readonly prompts: readonly AgentPrompt[];
  readonly dispatch: AgentDispatch;
  readonly readResource: AgentResourceReader;
}

export interface AgentServerPort {
  /**
   * Answers one HTTP request.
   *
   * Web-standard `Request` in and `Response` out, so the route handler that
   * calls this is transport and nothing else.
   */
  handle(request: Request): Promise<Response>;
}
