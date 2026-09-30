/**
 * The `Retry-After` value for a rate-limit window that is full (completeness
 * review M-12).
 *
 * At least one second: a zero tells a client it may retry immediately, which is
 * the loop the header exists to stop.
 */
export function retryAfter(resetSeconds: number): string {
  return String(Math.max(1, Math.ceil(resetSeconds)));
}
