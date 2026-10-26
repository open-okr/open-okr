import { describe, expect, it } from "vitest";
import {
  dismissAgentPrompt,
  isAgentPromptDismissed,
} from "../lib/agent-prompt-dismissal.ts";
import {
  AGENT_PROMPT_AGENTS,
  agentSetupPrompt,
} from "../lib/agent-setup-prompt.ts";

/**
 * The prompt a member pastes into their own agent
 * (docs/design/agent-setup-prompt.md §1, §2, §3).
 */

const endpoint = "https://okr.example/api/mcp";
const token = "okr_mcp_abc123";

describe("the OAuth setup prompt", () => {
  const prompt = agentSetupPrompt({ endpoint });

  it("gives every supported agent a step with this instance's address", () => {
    expect(prompt).toContain(
      `claude mcp add --transport http openokr ${endpoint}`,
    );
    expect(prompt).toContain(`url: "${endpoint}"`);
    expect(prompt).toContain("auth: oauth");
    expect(prompt).toContain(
      `gemini mcp add --transport http openokr ${endpoint}`,
    );
    expect(prompt).toContain("Developer mode");
    for (const agent of AGENT_PROMPT_AGENTS) {
      expect(prompt).toContain(agent.name);
    }
  });

  it("carries no token and no authorization header", () => {
    expect(prompt).not.toContain("Bearer");
    expect(prompt).not.toContain("Authorization");
  });

  it("asks the agent to prove the connection with a core read", () => {
    expect(prompt).toContain("workspace.overview");
  });
});

describe("the token setup prompt", () => {
  const prompt = agentSetupPrompt({ endpoint, token });

  it("puts the token in a header for each agent that takes one", () => {
    expect(prompt).toContain(
      `claude mcp add --transport http openokr ${endpoint} --header "Authorization: Bearer ${token}"`,
    );
    expect(prompt).toContain(`Authorization: "Bearer ${token}"`);
    expect(prompt).toContain(
      `gemini mcp add --transport http openokr ${endpoint} --header "Authorization: Bearer ${token}"`,
    );
  });

  it("says ChatGPT takes OAuth only, and never puts the token in its step", () => {
    expect(prompt).toContain("ChatGPT connectors accept OAuth only");
    const chatGpt = prompt.slice(
      prompt.indexOf("ChatGPT"),
      prompt.indexOf("Gemini CLI"),
    );
    expect(chatGpt).not.toContain(token);
  });

  it("never asks for an OAuth sign-in", () => {
    expect(prompt).not.toContain("auth: oauth");
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
