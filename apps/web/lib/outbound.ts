import { checkUrl, outboundFetch } from "@openokr/adapters";
import type { OutboxHandlerDeps } from "@openokr/core";

/**
 * The outbound guard's address check, in the shape `ActionCallContext` takes
 * (docs/design/outbound-webhooks.md W7).
 *
 * `packages/core` may not import the guard, so every host that can reach a
 * webhook write hands it this: the REST surface, which the command line goes
 * through, and the admin screen. The refusal is the guard's own sentence,
 * which names the address it would not send to.
 */
export async function checkOutboundUrl(
  url: string,
  options: {
    readonly allowPrivate: boolean;
    readonly allowUnresolved?: boolean;
  },
): Promise<
  { readonly ok: true } | { readonly ok: false; readonly detail: string }
> {
  const checked = await checkUrl(url, {
    allowPrivate: options.allowPrivate,
    allowUnresolved: options.allowUnresolved,
  });
  return checked.ok ? { ok: true } : { ok: false, detail: checked.detail };
}

/**
 * One signed webhook POST through the guard, for the relay (W7): every
 * address the name resolves to is checked again now, no redirect is followed,
 * and the answer is read up to the cap and thrown away. Only its status is
 * kept, because what a receiver says is not ours to log.
 */
export const postWebhook: NonNullable<
  OutboxHandlerDeps["postWebhook"]
> = async (url, request) => {
  const answer = await outboundFetch(url, {
    method: "POST",
    body: request.body,
    headers: request.headers,
    allowPrivate: request.allowPrivate,
    timeoutMs: request.timeoutMs,
    maxBytes: request.maxBytes,
    truncate: true,
  });
  return answer.ok
    ? { ok: true, status: answer.status }
    : { ok: false, refusal: answer.refusal, detail: answer.detail };
};
