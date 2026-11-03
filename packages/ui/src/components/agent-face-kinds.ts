/**
 * The agent faces' kinds and moods (docs/design/agent-faces.md).
 *
 * **Apart from the face itself on purpose.** `agent-face.tsx` is a client
 * component, and a plain function exported from a `"use client"` module is a
 * client reference on the server: the Agents page called `agentFaceKind` while
 * rendering and the request failed. These are data and a pure function, so
 * they live where a server component can call them.
 */

export const AGENT_FACE_KINDS = ["agent", "coach", "champion"] as const;
export type AgentFaceKind = (typeof AGENT_FACE_KINDS)[number];

export const AGENT_MOODS = [
  "idle",
  "thinking",
  "happy",
  "sad",
  "surprised",
  "sleeping",
] as const;
export type AgentMood = (typeof AGENT_MOODS)[number];

/**
 * The face for an agent row's stored kind. A custom agent has no face of its
 * own and wears the general one, as does any kind added after this.
 */
export function agentFaceKind(kind: string): AgentFaceKind {
  return kind === "coach" || kind === "champion" ? kind : "agent";
}
