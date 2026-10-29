/**
 * Whether the Work Map's agent setup pill was closed in this login session
 * (docs/design/agent-setup-prompt.md §3).
 *
 * **Keyed on the session row's id, never its token.** A new sign-in has a new
 * id, so the pill comes back, which is what the product owner asked for.
 *
 * **Browser storage, on purpose.** It is a per-browser convenience. Storage can
 * be blocked or throw, and a lost value only means the pill shows again, so
 * every read and write is wrapped and a failure reads as "not closed".
 */

const AGENT_PROMPT_DISMISSAL_KEY = "openokr.agentPrompt.dismissed";

type KeyValueStore = Pick<Storage, "getItem" | "setItem">;

export function isAgentPromptDismissed(
  storage: KeyValueStore | null,
  sessionId: string,
): boolean {
  try {
    return storage?.getItem(AGENT_PROMPT_DISMISSAL_KEY) === sessionId;
  } catch {
    return false;
  }
}

export function dismissAgentPrompt(
  storage: KeyValueStore | null,
  sessionId: string,
): void {
  try {
    storage?.setItem(AGENT_PROMPT_DISMISSAL_KEY, sessionId);
  } catch {
    // Blocked storage: the pill shows again next time, which is harmless.
  }
}
