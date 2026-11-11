"use client";

import { Button, CopyButton, useTranslations } from "@openokr/ui";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  dismissAgentPrompt,
  isAgentPromptDismissed,
} from "../lib/agent-prompt-dismissal.ts";
import {
  AGENT_PROMPT_AGENTS,
  agentSetupLine,
} from "../lib/agent-setup-prompt.ts";
import { useInstanceName } from "../lib/instance-name-context";
import { AgentMark } from "./agent-marks.tsx";

/**
 * Home's way into the agent endpoint (docs/design/agent-setup-prompt.md §3).
 *
 * **The agents' own marks**, drawn after Cloudflare's "Onboard your agent"
 * pill at the product owner's request. Each has a title naming its agent, and
 * the names are read out once as part of the button's name.
 *
 * **The close button waits for hover**, except where nothing can hover: a
 * phone would otherwise have no way to close the pill. Keyboard focus opens
 * it too, so it is never reachable yet invisible.
 *
 * **Hidden until mounted.** Whether it was closed lives in browser storage,
 * which the server cannot read, so rendering it on the server and hiding it
 * on the client would flash it for everybody who closed it.
 */

const storage = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

export function AgentSetupPill({
  setupUrl,
  sessionId,
}: {
  /** Where this instance serves the agent's setup instructions. */
  readonly setupUrl: string;
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
      {/* `max-w-full`, and below `sm` a pill that wraps: on a phone the
          label and the five marks are wider than the screen, and the centred
          pill was cut off on both sides at 390px (Q-10c, 0.8.0 acceptance
          test). There the marks move to a line of their own, and a long
          instance name or the Malay label wraps too. */}
      <span className="group inline-flex max-w-full items-center">
        <CopyButton
          text={agentSetupLine({ instanceName, setupUrl })}
          title={t("home.agentPrompt.tooltip")}
          className="h-auto min-h-11 cursor-pointer flex-wrap gap-x-3 gap-y-1.5 whitespace-normal rounded-full border-line bg-surface px-5 py-2 text-center text-sm font-medium text-ink shadow-none hover:translate-y-0 hover:border-line-2 hover:shadow-none sm:h-11 sm:flex-nowrap sm:gap-3 sm:whitespace-nowrap sm:py-0 sm:text-base"
        >
          {t("home.agentPrompt.label", { instanceName })}
          <span className="inline-flex items-center gap-1.5" aria-hidden="true">
            {AGENT_PROMPT_AGENTS.map((agent) => (
              <span key={agent.id} title={agent.name} className="inline-flex">
                <AgentMark agent={agent.id} className="size-5" />
              </span>
            ))}
          </span>
          <span className="sr-only">
            {t("home.agentPrompt.worksWith", { agents })}
          </span>
        </CopyButton>
        {/* The slot opens from no width, so the centred pill slides left to
            make room rather than leaving a gap for a button nobody sees. */}
        <span className="inline-flex w-0 overflow-hidden opacity-0 transition-[width,opacity] duration-200 ease-out group-focus-within:w-8 group-focus-within:opacity-100 group-hover:w-8 group-hover:opacity-100 motion-reduce:transition-none [@media(hover:none)]:w-8 [@media(hover:none)]:opacity-100">
          <Button
            variant="ghost"
            aria-label={t("home.agentPrompt.close")}
            title={t("home.agentPrompt.close")}
            className="size-8 shrink-0 cursor-pointer rounded-full border border-line bg-surface p-0 text-ink-3 shadow-none"
            onClick={() => {
              dismissAgentPrompt(storage(), sessionId);
              setShown(false);
            }}
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        </span>
      </span>
    </div>
  );
}
