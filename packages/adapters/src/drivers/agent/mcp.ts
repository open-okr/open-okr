/**
 * The Model Context Protocol server (AI-NATIVE-PLAN.md §8.3, P5-T09b).
 *
 * **The only file in this repository that imports the protocol SDK.** Everything
 * above it works in `AgentTool` and `AgentToolResult`, which are this product's
 * own words, so the transport can be replaced without touching a decision.
 *
 * **The low-level `Server`, not `McpServer`.** The high-level wrapper takes Zod
 * shapes and builds JSON Schema from them; the catalogue already *is* JSON
 * Schema, generated once from the action registry and committed. Converting it
 * back into Zod so the SDK could convert it forward again would be a second
 * translation with a second chance to differ from the artifact the drift gate
 * pins.
 *
 * **A refusal is a result, not a thrown error.** The protocol has `isError` on a
 * tool result exactly so an agent can read a denial and say so. Throwing would
 * reach the client as a transport fault, which is a thing to retry rather than a
 * thing to report, and an agent that retries a permission denial is an agent
 * that looks broken to the person watching it.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  CallToolRequestSchema,
  ListPromptsRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { AgentServerConfig, AgentServerPort } from "../../ports/agent.ts";

export class McpAgentServer implements AgentServerPort {
  readonly #config: AgentServerConfig;

  constructor(config: AgentServerConfig) {
    this.#config = config;
  }

  /**
   * Builds a server for one request.
   *
   * **Per request rather than per process, on purpose.** Every tool call runs as
   * one member in one workspace, and the dispatch function this was built with
   * closes over that principal. A server held across requests would be a server
   * whose closure belongs to whoever connected first.
   */
  #server(): Server {
    const server = new Server(
      { name: this.#config.name, version: this.#config.version },
      {
        capabilities: {
          tools: {},
          resources: {},
          prompts: {},
        },
      },
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.#config.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema as { type: "object" },
        annotations: tool.annotations,
      })),
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const outcome = await this.#config.dispatch(
        request.params.name,
        (request.params.arguments ?? {}) as Record<string, unknown>,
      );
      return {
        content: [{ type: "text" as const, text: outcome.text }],
        isError: outcome.isError,
      };
    });

    server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
      resourceTemplates: this.#config.resources.map((resource) => ({
        uriTemplate: resource.uriTemplate,
        name: resource.name,
        description: resource.description,
        mimeType: resource.mimeType,
      })),
    }));

    server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const outcome = await this.#config.readResource(request.params.uri);
      return {
        contents: [
          {
            uri: request.params.uri,
            mimeType: "application/json",
            text: outcome.text,
          },
        ],
      };
    });

    server.setRequestHandler(ListPromptsRequestSchema, async () => ({
      prompts: this.#config.prompts.map((prompt) => ({
        name: prompt.name,
        description: prompt.description,
        arguments: prompt.arguments.map((argument) => ({
          name: argument.name,
          description: argument.description,
          required: argument.required,
        })),
      })),
    }));

    return server;
  }

  async handle(request: Request): Promise<Response> {
    const transport = new WebStandardStreamableHTTPServerTransport({
      // **Stateless, and the session belongs to the caller.**
      //
      // The transport keeps session state in memory, and a server built per
      // request has no memory to keep it in. There were two ways out: hold
      // transports in a module map, which stops working the moment a second
      // instance answers a request, or run stateless and let the caller record
      // the session in the database, where it can be seen, bound to a grant and
      // revoked with it. This takes the second, which is also what the design
      // already claimed a session was: a record, never an authority.
      //
      // So no `sessionIdGenerator` and no session callbacks: nothing in here
      // generates or remembers one.
      //
      // **JSON rather than a stream, for now.** Every tool answers in one step:
      // there is no long-running call to report progress on, and a streaming
      // answer to a question that is already finished is a connection held open
      // for nothing. The transport can stream the moment something needs it.
      enableJsonResponse: true,
    });

    const server = this.#server();
    await server.connect(transport);

    try {
      return await transport.handleRequest(request);
    } finally {
      // The server and its transport belong to this request. Leaving them
      // connected would leak one principal's closure per call.
      await server.close().catch(() => undefined);
    }
  }
}
