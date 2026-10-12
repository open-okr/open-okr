/**
 * Identifiers somebody copies from another system or makes up for one
 * (guided-inputs §4.11): a channel id, a model id, a provider id.
 */

/**
 * The longest identifier stored: Slack's and Teams' channel ids, and a model
 * id. Teams' conversation ids are the long ones, near a hundred characters.
 */
export const IDENTIFIER_MAX_LENGTH = 200;

/**
 * One word: an id a provider issued has no spaces, and a pasted display name
 * in its place is a link that never posts.
 */
export const ONE_WORD_PATTERN = /^\S+$/;

/** Whether `value` is one word with no whitespace anywhere. */
export function isOneWord(value: string): boolean {
  return ONE_WORD_PATTERN.test(value);
}

/**
 * Lowercase letters, numbers and hyphens: a single sign-on provider id, which
 * is part of the callback address the identity provider holds.
 */
export const SLUG_PATTERN = /^[a-z0-9-]+$/;

/** Whether `value` is lowercase letters, numbers and hyphens only. */
export function isSlug(value: string): boolean {
  return SLUG_PATTERN.test(value);
}
