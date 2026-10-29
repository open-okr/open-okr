/**
 * Which tools one agent connection is offered (docs/design/mcp-toolsets.md).
 *
 * Presentation over the catalogue, not a second permission model: the scope
 * gate and `can()` still decide every call. What this adds is that the list
 * and the call agree, so an agent that guesses a name it was not shown gets a
 * sentence saying where the tool lives rather than a different product.
 */
import type { McpTool } from "./catalogue.ts";
import {
  ALWAYS_OFFERED,
  DEFAULT_TOOLSETS,
  TOOLSET_CHOICES,
  TOOLSET_NAMES,
  TOOLSETS,
  type ToolsetName,
} from "./toolset-data.ts";

export type ToolsetChoice =
  | { readonly kind: "ok"; readonly toolsets: ReadonlySet<ToolsetName> }
  | { readonly kind: "unknown"; readonly message: string };

/**
 * The toolsets a connection named in `?toolsets=`, or the default.
 *
 * An unknown name is refused rather than dropped: a typo that quietly became
 * `core` would look like tools going missing.
 */
export function parseToolsets(raw: string | null): ToolsetChoice {
  const names = (raw ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "");
  if (names.length === 0) {
    return { kind: "ok", toolsets: new Set(DEFAULT_TOOLSETS) };
  }
  const unknown = names.filter(
    (name) => !(TOOLSET_CHOICES as readonly string[]).includes(name),
  );
  if (unknown.length > 0) {
    return {
      kind: "unknown",
      message: `There is no toolset called ${unknown.join(", ")}. Choose from ${TOOLSET_CHOICES.join(", ")}.`,
    };
  }
  return {
    kind: "ok",
    toolsets: new Set(
      names.includes("all") ? TOOLSET_NAMES : (names as ToolsetName[]),
    ),
  };
}

/** The toolset a tool belongs to, or null for a tool nobody has placed. */
export function toolsetOf(name: string): ToolsetName | null {
  return TOOLSET_NAMES.find((toolset) => TOOLSETS[toolset].has(name)) ?? null;
}

function inChosen(name: string, chosen: ReadonlySet<ToolsetName>): boolean {
  const toolset = toolsetOf(name);
  return ALWAYS_OFFERED.has(name) || (toolset !== null && chosen.has(toolset));
}

/**
 * The tools this connection is shown: in a chosen toolset, and callable with
 * its scopes. A tool the scope gate would refuse is not listed, which is not
 * hiding it: a token that holds the scope sees it.
 */
export function offeredTools(
  tools: readonly McpTool[],
  scopes: readonly string[],
  chosen: ReadonlySet<ToolsetName>,
): McpTool[] {
  return tools.filter(
    (tool) => scopes.includes(tool.scope) && inChosen(tool.name, chosen),
  );
}

/** Why a call to this tool is outside the connection's toolsets, or null. */
export function toolsetRefusal(
  name: string,
  chosen: ReadonlySet<ToolsetName>,
): string | null {
  if (inChosen(name, chosen)) {
    return null;
  }
  const toolset = toolsetOf(name);
  return `${name} is in the ${toolset} toolset, which this connection did not choose. Add ?toolsets=${[...chosen, toolset].join(",")} to the server address.`;
}
