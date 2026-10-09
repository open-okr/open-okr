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
  isHexColour,
} from "./colour.ts";
export { isLocalDate, LOCAL_DATE_PATTERN } from "./date.ts";
export {
  DEVICE_CODE_ALPHABET,
  DEVICE_USER_CODE_GROUPS,
  formatDeviceUserCode,
} from "./device-code.ts";
export { DOMAIN_PATTERN, isDomain } from "./domain.ts";
export { EMAIL_PATTERN, isEmailAddress } from "./email.ts";
export { isKnownTimezone } from "./timezone.ts";
