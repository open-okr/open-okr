/**
 * The largest file a person can attach, for the browser (plan 0.8.0 H13).
 *
 * The same number as core's `MAX_BLOB_BYTES`, kept here so a client component
 * can say it and check it without importing the whole of core into the page.
 * A test holds the two equal, and holds the server-action body limit in
 * `next.config.ts` above it: that limit was 8 MB, so a file between 8 and
 * 25 MB was cut off before core's own check could name the real limit.
 */
export const UPLOAD_LIMIT_BYTES = 25 * 1024 * 1024;
