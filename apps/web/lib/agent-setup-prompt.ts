/**
 * The line a member pastes into their own agent, and the instructions the
 * agent then fetches from this instance (docs/design/agent-setup-prompt.md
 * §9, after Cloudflare's agent setup).
 *
 * **English, and not in the catalogue.** Both are read by an agent, not shown
 * to a person, and every agent named here reads English. The button that
 * copies the line is UI text and is translated.
 *
 * **The instructions are public, so they never hold a token.** The agent
 * fetching them has no session. A minted token travels only in the pasted
 * line, which exists only in the answer that minted it.
 */

/** The agents the prompt has a step for, in the order the pill shows them. */
export const AGENT_PROMPT_AGENTS = [
  { id: "claude-code", name: "Claude Code" },
  { id: "codex", name: "Codex" },
  { id: "cursor", name: "Cursor" },
  { id: "hermes", name: "Hermes Agent" },
  { id: "chatgpt", name: "ChatGPT" },
] as const;

export type AgentPromptAgent = (typeof AGENT_PROMPT_AGENTS)[number]["id"];

const SERVER_NAME = "openokr";

/** Where the instructions are served. Public: see `apps/web/proxy.ts`. */
const AGENT_SETUP_PATH = "/agent-setup/prompt.md";

export function agentSetupUrl(origin: string): string {
  return `${origin.replace(/\/+$/, "")}${AGENT_SETUP_PATH}`;
}

export function agentSetupLine({
  instanceName,
  setupUrl,
  token,
}: {
  readonly instanceName: string;
  readonly setupUrl: string;
  readonly token?: string;
}): string {
  const line = `Fetch and execute the appropriate instructions to set me up for ${instanceName} from ${setupUrl}`;
  return token
    ? `${line}\nUse this bearer token instead of OAuth, and treat it as a password (do not repeat it back to me and do not commit it): ${token}`
    : line;
}

const fence = (body: readonly string[], language = ""): string[] => [
  `\`\`\`${language}`,
  ...body,
  "```",
];

export function agentSetupMarkdown({
  instanceName,
  origin,
  endpoint,
}: {
  readonly instanceName: string;
  readonly origin: string;
  readonly endpoint: string;
}): string {
  const base = origin.replace(/\/+$/, "");
  const bearer = "Bearer <token>";
  const title = `${instanceName} Agent Setup Complete`;
  const width = Math.max(title.length + 6, 48);
  const row = (text: string) => `│  ${text.padEnd(width - 2)}│`;

  const sections: string[][] = [
    [
      `These are the setup instructions from ${instanceName}, an OpenOKR instance at ${base}. They connect you to the user's OKR workspace through MCP (Model Context Protocol).`,
      "",
      "Complete the steps for your agent yourself by running the commands directly. Ask the user only for what you cannot do, such as approving the sign-in in their browser.",
      "",
      `- Server name: \`${SERVER_NAME}\``,
      `- Server URL: \`${endpoint}\``,
      "- Transport: streamable HTTP",
      "- Sign-in: OAuth with dynamic client registration. The user approves the connection in their browser. No token is needed.",
      "",
      "If the user gave you a bearer token together with the link to this file, use the token variant of your step instead of OAuth, put the token where `<token>` stands, and never repeat it back or commit it to a repository.",
    ],
    [
      "## Connect your agent",
      "",
      "Use the section for your agent. Keep any servers already in a configuration file, and replace an existing `openokr` entry instead of adding a second one.",
    ],
    [
      "### Claude Code",
      "",
      ...fence([`claude mcp add --transport http ${SERVER_NAME} ${endpoint}`]),
      "",
      `Then ask the user to run \`/mcp\`, choose \`${SERVER_NAME}\` and sign in.`,
      "",
      `Token variant: add \`--header "Authorization: ${bearer}"\` to the command.`,
    ],
    [
      "### Codex",
      "",
      ...fence([
        `codex mcp add ${SERVER_NAME} --url ${endpoint}`,
        `codex mcp login ${SERVER_NAME}`,
      ]),
      "",
      "Token variant: add this to `~/.codex/config.toml` instead, and keep that file out of any repository, because Codex stores it in plain text:",
      "",
      ...fence(
        [
          `[mcp_servers.${SERVER_NAME}]`,
          `url = "${endpoint}"`,
          `http_headers = { "Authorization" = "${bearer}" }`,
        ],
        "toml",
      ),
    ],
    [
      "### Cursor, `~/.cursor/mcp.json`",
      "",
      'Add under `"mcpServers"`:',
      "",
      ...fence([`"${SERVER_NAME}": { "url": "${endpoint}" }`], "json"),
      "",
      `Then ask the user to open Cursor Settings, MCP, and sign in to \`${SERVER_NAME}\`.`,
      "",
      `Token variant: \`"${SERVER_NAME}": { "url": "${endpoint}", "headers": { "Authorization": "${bearer}" } }\``,
    ],
    [
      "### GitHub Copilot (VS Code), `.vscode/mcp.json`",
      "",
      'Add under `"servers"` (VS Code uses `servers`, not `mcpServers`):',
      "",
      ...fence(
        [`"${SERVER_NAME}": { "type": "http", "url": "${endpoint}" }`],
        "json",
      ),
      "",
      "OAuth starts on first use.",
      "",
      `Token variant: add \`"headers": { "Authorization": "${bearer}" }\` to the entry.`,
    ],
    [
      "### OpenCode, `opencode.json`",
      "",
      'Add under `"mcp"`:',
      "",
      ...fence(
        [
          `"${SERVER_NAME}": { "type": "remote", "url": "${endpoint}", "enabled": true, "oauth": {} }`,
        ],
        "json",
      ),
      "",
      "Then run:",
      "",
      ...fence([`opencode mcp auth ${SERVER_NAME}`]),
      "",
      `Token variant: replace \`"oauth": {}\` with \`"oauth": false, "headers": { "Authorization": "${bearer}" }\` and skip the auth command.`,
    ],
    [
      "### Windsurf, `~/.codeium/windsurf/mcp_config.json`",
      "",
      'Add under `"mcpServers"` (note: `serverUrl`, not `url`):',
      "",
      ...fence([`"${SERVER_NAME}": { "serverUrl": "${endpoint}" }`], "json"),
      "",
      "OAuth starts on first use. A token is not covered here: use OAuth.",
    ],
    [
      "### Hermes Agent, `~/.hermes/config.yaml`",
      "",
      ...fence(
        [
          "mcp_servers:",
          `  ${SERVER_NAME}:`,
          `    url: "${endpoint}"`,
          "    auth: oauth",
        ],
        "yaml",
      ),
      "",
      "Then restart Hermes. It prints a sign-in link on first connect; the user opens it and approves.",
      "",
      `Token variant: replace \`auth: oauth\` with \`headers:\` and \`Authorization: "${bearer}"\` beneath it, then run \`hermes mcp test ${SERVER_NAME}\`.`,
    ],
    [
      "### Grok Bot",
      "",
      `You have no configuration file for this. In this chat, add a custom MCP server named \`${SERVER_NAME}\` at \`${endpoint}\` using streamable HTTP.`,
      "",
      "Then ask the user to approve it and sign in from the Connect card. The tools appear after sign-in. If the server shows Needs auth or Disconnected, ask them to choose Authenticate (Authorize on the phone).",
      "",
      "If a later task does not have the tools, ask the user to type `@` and attach the server.",
      "",
      "This needs a public HTTPS address. If this instance is on `localhost` or an office network, tell the user Grok Bot cannot connect to it. A token does not change that.",
      "",
      "A token is not covered here: use OAuth. Do not store a token the user pasted into this chat.",
    ],
    [
      "### ChatGPT (developer mode)",
      "",
      `You cannot add this yourself. Tell the user to open Settings, then Apps and Connectors, then Advanced settings, turn on Developer mode, and create a connector named ${instanceName} with the server URL above and OAuth authentication. ChatGPT connectors take OAuth only, so a token does not work there.`,
    ],
    [
      "## Check the connection",
      "",
      "Call the `workspace.overview` tool once. Then tell the user:",
      "",
      ...fence([
        `┌─ ${title} ${"─".repeat(Math.max(width - title.length - 3, 1))}┐`,
        row("✓ Connected  <workspace name>"),
        row("✓ Signed in  <member name>"),
        row(""),
        row("Restart your agent if the tools do not appear"),
        `└${"─".repeat(width)}┘`,
      ]),
    ],
    [
      "## If you cannot fetch this file or reach the server",
      "",
      `An agent running in the cloud (ChatGPT, or Claude on the web) cannot reach an instance on \`localhost\` or an office network. Ask the user to open ${base}/account/api-tokens, create an agent token, and paste the configuration shown there.`,
    ],
    [
      "## Resources",
      "",
      "- Claude Code: `https://docs.anthropic.com/en/docs/claude-code/mcp`",
      "- Codex: `https://developers.openai.com/codex/mcp`",
      "- Cursor: `https://cursor.com/docs/context/mcp`",
      "- GitHub Copilot (VS Code): `https://code.visualstudio.com/docs/copilot/customization/mcp-servers`",
      "- OpenCode: `https://opencode.ai/docs/mcp-servers/`",
      "- Windsurf: `https://docs.windsurf.com/windsurf/cascade/mcp`",
      "- Hermes Agent: `https://hermes-agent.nousresearch.com`",
      "- Grok Bot: `https://docs.x.ai/grok-bot/computer-and-apps`",
    ],
    [
      `These instructions are served at \`${agentSetupUrl(base)}\`, so you can fetch them again to check them.`,
    ],
  ];

  // A rule before each part, as Cloudflare's file has, not between agents.
  const text = sections
    .map((section) => section.join("\n"))
    .map((section, index) =>
      index > 0 && /^## |^These instructions/.test(section)
        ? `---\n\n${section}`
        : section,
    )
    .join("\n\n");
  return `${text}\n`;
}
