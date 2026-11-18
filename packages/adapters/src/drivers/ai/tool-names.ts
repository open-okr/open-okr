/**
 * Tool names on the wire.
 *
 * The action registry names tools with dots ("goals.read"), and every
 * provider's tool-name pattern rejects a dot. A driver sends the wire name and
 * maps what comes back to the offered name by lookup, so a caller only ever
 * sees the dotted one.
 */

/** Anything outside letters, digits, underscore and hyphen becomes `_`. */
export const toWireName = (name: string): string =>
  name.replace(/[^a-zA-Z0-9_-]/g, "_");

/**
 * The offered tool name a wire name stands for. A name that matches no
 * offered tool is returned as it came, so a model's invented tool reaches the
 * caller to be refused rather than silently renamed.
 */
export function fromWireName(
  wire: string,
  tools: readonly { readonly name: string }[],
): string {
  const exact = tools.find((tool) => tool.name === wire);
  if (exact) {
    return exact.name;
  }
  return tools.find((tool) => toWireName(tool.name) === wire)?.name ?? wire;
}
