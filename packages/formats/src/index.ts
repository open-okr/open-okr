/**
 * The format rules the browser and the server share (docs/design/
 * guided-inputs.md §4.1).
 *
 * Pure: no dependencies, no I/O, no imports from outside this folder. A field
 * in `packages/ui` checks a value with the same function the action schema in
 * `packages/core` refuses it with, so the two cannot disagree.
 */
export const PACKAGE_NAME = "@openokr/formats";

export {
  HEX_COLOUR_HTML_PATTERN,
  HEX_COLOUR_PATTERN,
  type Hsl,
  hexChannels,
  hexToHsl,
  isHexColour,
  type StatusHue,
  statusHueOf,
} from "./colour.ts";
export { isLocalDate, LOCAL_DATE_PATTERN } from "./date.ts";
export {
  DEVICE_CODE_ALPHABET,
  DEVICE_USER_CODE_GROUPS,
  formatDeviceUserCode,
} from "./device-code.ts";
export { DOMAIN_PATTERN, isDomain } from "./domain.ts";
export { EMAIL_PATTERN, isEmailAddress } from "./email.ts";
export { hostOf, isHostName } from "./host.ts";
export {
  IDENTIFIER_MAX_LENGTH,
  isOneWord,
  isSlug,
  ONE_WORD_PATTERN,
  SLUG_PATTERN,
} from "./identifier.ts";
export {
  type MentionName,
  richTextAsLine,
  richTextLength,
  textOfRichTextNode,
} from "./rich-text.ts";
export {
  BROWSER_TIMEZONE_COOKIE,
  isKnownTimezone,
  isListedTimezone,
  listTimezones,
  matchListedTimezone,
} from "./timezone.ts";
export { isWebUrl } from "./url.ts";
export {
  isWallClock,
  normaliseWallClock,
  parseWallClock,
  WALL_CLOCK_PATTERN,
} from "./wall-clock.ts";
export {
  localDateTimeInstant,
  localDayBounds,
  zonedInstant,
  zoneOffsetAt,
} from "./zoned.ts";
