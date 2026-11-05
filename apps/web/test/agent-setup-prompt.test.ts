import { describe, expect, it } from "vitest";
import {
  dismissAgentPrompt,
  isAgentPromptDismissed,
} from "../lib/agent-prompt-dismissal.ts";
import {
  agentSetupLine,
  agentSetupMarkdown,
  agentSetupUrl,
} from "../lib/agent-setup-prompt.ts";

/**
 * The prompt a member pastes into their own agent
 * (docs/design/agent-setup-prompt.md §1, §2, §3).
 */

const origin = "https://okr.example";
const endpoint = "https://okr.example/api/mcp";
const setupUrl = "https://okr.example/agent-setup/prompt.md";
const token = "okr_mcp_abc123";

describe("the line a member pastes (§9.1)", () => {
  it("builds the address of the instructions from the instance's origin", () => {
    expect(agentSetupUrl(origin)).toBe(setupUrl);
    expect(agentSetupUrl(`${origin}/`)).toBe(setupUrl);
  });

  it("is one line naming the instance and the instructions", () => {
    expect(agentSetupLine({ instanceName: "Northwind OKR", setupUrl })).toBe(
      `Fetch and execute the appropriate instructions to set me up for Northwind OKR from ${setupUrl}`,
    );
  });

  it("carries a minted token on a second line, and only then", () => {
    const line = agentSetupLine({ instanceName: "OpenOKR", setupUrl, token });
    const [first, second] = line.split("\n");
    expect(first).toContain(setupUrl);
    expect(second).toContain(`: ${token}`);
    expect(second).toContain("treat it as a password");
    expect(agentSetupLine({ instanceName: "OpenOKR", setupUrl })).not.toContain(
      "token",
    );
  });
});

describe("the instructions the agent fetches (§9.2)", () => {
  const markdown = agentSetupMarkdown({
    instanceName: "Northwind OKR",
    origin,
    endpoint,
  });

  it("opens by naming the instance and asking the agent to do the work", () => {
    expect(markdown).toContain(
      `Northwind OKR, an OpenOKR instance at ${origin}`,
    );
    expect(markdown).toContain("Complete the steps for your agent yourself");
  });

  it("gives every agent a step with this instance's endpoint", () => {
    for (const heading of [
      "### Claude Code",
      "### Codex",
      "### Cursor",
      "### GitHub Copilot (VS Code)",
      "### OpenCode",
      "### Windsurf",
      "### Hermes Agent",
      "### Grok Bot",
      "### ChatGPT",
    ]) {
      expect(markdown).toContain(heading);
    }
    expect(markdown).toContain(
      `claude mcp add --transport http openokr ${endpoint}`,
    );
    expect(markdown).toContain(`codex mcp add openokr --url ${endpoint}`);
    expect(markdown).toContain("codex mcp login openokr");
    expect(markdown).toContain('"servers"');
    expect(markdown).toContain('"type": "http"');
    expect(markdown).toContain('"type": "remote"');
    expect(markdown).toContain("opencode mcp auth openokr");
    expect(markdown).toContain(`"serverUrl": "${endpoint}"`);
    expect(markdown).toContain("auth: oauth");
  });

  describe("Grok Bot's step", () => {
    const step = markdown.slice(
      markdown.indexOf("### Grok Bot"),
      markdown.indexOf("### ChatGPT"),
    );

    it("sits between Hermes Agent and ChatGPT", () => {
      expect(markdown.indexOf("### Hermes Agent")).toBeLessThan(
        markdown.indexOf("### Grok Bot"),
      );
      expect(markdown.indexOf("### Grok Bot")).toBeLessThan(
        markdown.indexOf("### ChatGPT"),
      );
    });

    it("has the Bot add this instance's server in chat", () => {
      expect(step).toContain("add a custom MCP server named `openokr`");
      expect(step).toContain(`at \`${endpoint}\` using streamable HTTP`);
    });

    it("sends a token back to OAuth rather than storing it", () => {
      expect(step).toContain("use OAuth");
      expect(step).toContain("Do not store a token");
      expect(step).not.toContain("Token variant");
    });

    it("says a token does not make a private address reachable", () => {
      expect(step).toContain("needs a public HTTPS address");
      expect(step).toContain("A token does not change that");
    });

    it("is listed in Resources", () => {
      expect(markdown).toContain(
        "- Grok Bot: `https://docs.x.ai/grok-bot/computer-and-apps`",
      );
    });

    it("stays out of the fallback that sends the user to create a token", () => {
      const fallback = markdown.slice(
        markdown.indexOf("## If you cannot fetch"),
        markdown.indexOf("## Resources"),
      );
      expect(fallback).toContain("/account/api-tokens");
      expect(fallback).not.toContain("Grok Bot");
    });
  });

  it("explains the token variant without holding a token", () => {
    expect(markdown).toContain("Bearer <token>");
    expect(markdown).not.toMatch(/Bearer (?!<token>)/);
  });

  it("asks for proof, closes with a box, and covers an agent that cannot fetch", () => {
    expect(markdown).toContain("workspace.overview");
    expect(markdown).toContain("Northwind OKR Agent Setup Complete");
    expect(markdown).toContain(`${origin}/account/api-tokens`);
    expect(markdown).toContain(`${origin}/agent-setup/prompt.md`);
  });
});

/** A storage that behaves like the browser's, and one that refuses. */
function memoryStorage(): Pick<Storage, "getItem" | "setItem"> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

const refusingStorage: Pick<Storage, "getItem" | "setItem"> = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
};

describe("dismissing the Work Map pill", () => {
  it("hides it for the login session that closed it", () => {
    const storage = memoryStorage();
    expect(isAgentPromptDismissed(storage, "session-1")).toBe(false);
    dismissAgentPrompt(storage, "session-1");
    expect(isAgentPromptDismissed(storage, "session-1")).toBe(true);
  });

  it("shows it again after a new sign-in", () => {
    const storage = memoryStorage();
    dismissAgentPrompt(storage, "session-1");
    expect(isAgentPromptDismissed(storage, "session-2")).toBe(false);
  });

  it("shows it when storage is blocked, and closing does not throw", () => {
    expect(isAgentPromptDismissed(refusingStorage, "session-1")).toBe(false);
    expect(() =>
      dismissAgentPrompt(refusingStorage, "session-1"),
    ).not.toThrow();
    expect(isAgentPromptDismissed(null, "session-1")).toBe(false);
  });
});
