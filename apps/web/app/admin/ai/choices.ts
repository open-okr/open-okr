/**
 * The values the AI screen's two pickers post (guided-inputs §4.10).
 *
 * Each picker stands where a select and a pasted id or name stood, so its
 * value carries what the select said: whose a budget is says whether it is a
 * person's or an agent's, and which model a tier routes to says whose model
 * it is. Plain functions, so the screen and the save agree on the shape.
 */

export type BudgetOwner =
  | { readonly scope: "workspace"; readonly scopeRef: null }
  | { readonly scope: "user" | "agent"; readonly scopeRef: string };

export function budgetOwnerValue(scope: "user" | "agent", id: string): string {
  return `${scope}:${id}`;
}

/** Nobody chosen is the whole workspace; anything else is refused as null. */
export function budgetOwnerFrom(value: string): BudgetOwner | null {
  if (value === "") {
    return { scope: "workspace", scopeRef: null };
  }
  const match = /^(user|agent):(.+)$/.exec(value);
  if (!match) {
    return null;
  }
  return { scope: match[1] as "user" | "agent", scopeRef: match[2] as string };
}

export function tierModelValue(provider: string, modelId: string): string {
  return `${provider}:${modelId}`;
}

/**
 * Split at the first colon: a provider's name holds none, and a model's id
 * may, as Ollama's `llama3:8b` does.
 */
export function tierModelFrom(
  value: string,
): { readonly provider: string; readonly modelId: string } | null {
  const at = value.indexOf(":");
  if (at <= 0 || at === value.length - 1) {
    return null;
  }
  return { provider: value.slice(0, at), modelId: value.slice(at + 1) };
}
