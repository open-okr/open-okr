import { checkUrl } from "@openokr/adapters";

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
  options: { readonly allowPrivate: boolean },
): Promise<
  { readonly ok: true } | { readonly ok: false; readonly detail: string }
> {
  const checked = await checkUrl(url, { allowPrivate: options.allowPrivate });
  return checked.ok ? { ok: true } : { ok: false, detail: checked.detail };
}
