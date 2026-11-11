/**
 * Keeps a live stream talking when nothing else does (plan 0.8.0 H11).
 *
 * Every live route sent one heartbeat when it opened and nothing after. A load
 * balancer closes a connection that is silent for its idle timeout, 60 seconds
 * on AWS, and a CDN after about 100 on Cloudflare, so behind either every open
 * tab's stream was cut and reconnected about once a minute. A comment line every
 * 25 seconds is under both, and an EventSource ignores comments.
 */

/** How often a live stream speaks when nothing else does. */
export const HEARTBEAT_MS = 25_000;

/**
 * Calls `send` every `everyMs` until `signal` aborts, or until `send` throws,
 * which is what enqueueing on a closed stream does. Returns a stop function
 * for a route that ends its stream another way.
 */
export function keepAlive(
  send: () => void,
  signal: AbortSignal,
  everyMs: number = HEARTBEAT_MS,
): () => void {
  const timer = setInterval(() => {
    try {
      send();
    } catch {
      clearInterval(timer);
    }
  }, everyMs);
  const stop = () => clearInterval(timer);
  signal.addEventListener("abort", stop, { once: true });
  return stop;
}
