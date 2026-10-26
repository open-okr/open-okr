/**
 * The prompt a member pastes into their own agent so it connects itself to
 * this instance (docs/design/agent-setup-prompt.md).
 *
 * **English, and not in the catalogue.** It is read by an agent, not shown to
 * a person, and every agent named here reads English. The button that copies
 * it is UI text and is translated.
 *
 * **No token means OAuth.** The front door copies the prompt without a token,
 * so nothing secret lands in a clipboard history; the member approves the
 * connection in the browser. The token page copies the other one, only in the
 * answer that minted the token, because that is the only moment it exists.
 */

/** The agents the prompt has a step for, in the order the pill shows them. */
export const AGENT_PROMPT_AGENTS = [
  { id: "claude-code", name: "Claude Code" },
  { id: "hermes", name: "Hermes Agent" },
  { id: "chatgpt", name: "ChatGPT" },
] as const;

export type AgentPromptAgent = (typeof AGENT_PROMPT_AGENTS)[number]["id"];

const SERVER_NAME = "openokr";

export function agentSetupPrompt({
  endpoint,
  token,
}: {
  readonly endpoint: string;
  readonly token?: string;
}): string {
  const header = token ? `Authorization: Bearer ${token}` : null;
  const headerFlag = header ? ` --header "${header}"` : "";

  const intro = [
    "Connect yourself to my OpenOKR workspace through MCP (Model Context Protocol).",
    "",
    `Server name: ${SERVER_NAME}`,
    `Server URL: ${endpoint}`,
    "Transport: streamable HTTP",
    header
      ? "Sign-in: the bearer token in the steps below. Treat it as a password: do not repeat it back to me and do not commit it to a repository."
      : "Sign-in: OAuth. You open a sign-in page in my browser and I approve the connection there. No token is needed.",
    "",
    "Do the step for the agent you are. If you cannot change your own configuration, tell me exactly what to do instead.",
  ];

  const claudeCode = [
    "Claude Code",
    `  Run: claude mcp add --transport http ${SERVER_NAME} ${endpoint}${headerFlag}`,
    header
      ? "  Then run /mcp and check that openokr is connected."
      : "  Then run /mcp, choose openokr and sign in.",
  ];

  const hermes = [
    "Hermes Agent",
    "  Add this to ~/.hermes/config.yaml:",
    "    mcp_servers:",
    `      ${SERVER_NAME}:`,
    `        url: "${endpoint}"`,
    ...(header
      ? ["        headers:", `          Authorization: "Bearer ${token}"`]
      : ["        auth: oauth"]),
    header
      ? "  Then restart Hermes and run: hermes mcp test openokr"
      : "  Then restart Hermes. It prints a sign-in link on first connect; I open it and approve.",
  ];

  const chatGpt = [
    "ChatGPT (developer mode)",
    ...(header
      ? [
          "  ChatGPT connectors accept OAuth only, so this token does not work there.",
          "  Tell me to copy the setup prompt from the OpenOKR Work Map instead.",
        ]
      : [
          "  You cannot add this yourself. Tell me to: open Settings, then Apps and Connectors, then Advanced settings, and turn on Developer mode.",
          `  Then create a connector named OpenOKR with the server URL above and OAuth authentication, and sign in when asked.`,
        ]),
  ];

  const close = [
    "When the connection works, call the workspace.overview tool once and tell me the workspace name and my name, so I know it worked.",
  ];

  return [intro, claudeCode, hermes, chatGpt, close]
    .map((section) => section.join("\n"))
    .join("\n\n");
}
