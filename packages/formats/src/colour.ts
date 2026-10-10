/**
 * A colour as six hex digits after a hash, like `#336699`.
 *
 * Written once as the text an HTML `pattern` attribute takes, which the
 * browser anchors itself, and once as the regex the server applies, built from
 * the same text so the two cannot differ.
 */
export const HEX_COLOUR_HTML_PATTERN = "#[0-9a-fA-F]{6}";

export const HEX_COLOUR_PATTERN = new RegExp(`^${HEX_COLOUR_HTML_PATTERN}$`);

/** Whether `text` is a colour written as six hex digits after a hash. */
export function isHexColour(text: string): boolean {
  return HEX_COLOUR_PATTERN.test(text);
}
