"use client";

import { Button, CopyButton, useTranslations } from "@openokr/ui";
import { Bot, MessageSquare, Terminal, X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  dismissAgentPrompt,
  isAgentPromptDismissed,
} from "../lib/agent-prompt-dismissal.ts";
import {
  AGENT_PROMPT_AGENTS,
  type AgentPromptAgent,
  agentSetupPrompt,
} from "../lib/agent-setup-prompt.ts";
import { useInstanceName } from "../lib/instance-name-context";

/**
 * The Work Map's way into the agent endpoint
 * (docs/design/agent-setup-prompt.md §3).
 *
 * **Generic icons, not brand marks**, until the product owner decides on
 * marks. Each sits in the button with a title naming its agent, and the names
 * are read out once as part of the button's name.
 *
 * **Hidden until mounted.** Whether it was closed lives in browser storage,
 * which the server cannot read, so rendering it on the server and hiding it
 * on the client would flash it for everybody who closed it.
 */

const ICONS: Record<AgentPromptAgent, typeof Terminal> = {
  "claude-code": Terminal,
  hermes: Bot,
  chatgpt: MessageSquare,
};

const storage = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

export function AgentSetupPill({
  endpoint,
  sessionId,
}: {
  /** The agent endpoint every grant is checked against. */
  readonly endpoint: string;
  /** The login session's row id, never its token. */
  readonly sessionId: string;
}) {
  const { t } = useTranslations();
  const instanceName = useInstanceName();
  const [shown, setShown] = useState(false);

  useEffect(() => {
    setShown(!isAgentPromptDismissed(storage(), sessionId));
  }, [sessionId]);

  if (!shown) {
    return null;
  }

  const agents = AGENT_PROMPT_AGENTS.map((agent) => agent.name).join(", ");

  return (
    <div
      data-testid="agent-setup-pill"
      className="flex flex-wrap items-center justify-center gap-2"
    >
      <CopyButton
        text={agentSetupPrompt({ endpoint })}
        title={t("home.agentPrompt.tooltip")}
        className="h-10 rounded-full border-2 border-brand-strong px-4 text-sm text-ink hover:border-brand-strong"
      >
        {t("home.agentPrompt.label", { instanceName })}
        <span className="inline-flex items-center gap-1" aria-hidden="true">
          {AGENT_PROMPT_AGENTS.map((agent) => {
            const Icon = ICONS[agent.id];
            return (
              <span
                key={agent.id}
                title={agent.name}
                className="inline-flex size-6 items-center justify-center rounded-md bg-raised text-ink-2"
              >
                <Icon className="size-3.5" />
              </span>
            );
          })}
        </span>
        <span className="sr-only">
          {t("home.agentPrompt.worksWith", { agents })}
        </span>
      </CopyButton>
      <Button
        variant="ghost"
        aria-label={t("home.agentPrompt.close")}
        title={t("home.agentPrompt.close")}
        className="size-10 rounded-full border border-line p-0"
        onClick={() => {
          dismissAgentPrompt(storage(), sessionId);
          setShown(false);
        }}
      >
        <X className="size-4" aria-hidden="true" />
      </Button>
    </div>
  );
}
