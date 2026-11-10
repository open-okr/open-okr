import { expect, it } from "vitest";
import { checkOutboundUrl } from "../lib/outbound";

/**
 * The check `sso.createConnection` and `sso.updateConnection` run on a
 * provider's discovery, token and user-info addresses is the host's real
 * outbound guard. The cloud metadata address is refused whether or not private
 * addresses are allowed.
 */
it("refuses the cloud metadata address, on a cloud and on a self-hosted instance", async () => {
  for (const allowPrivate of [false, true]) {
    const checked = await checkOutboundUrl(
      "http://169.254.169.254/latest/meta-data/",
      { allowPrivate },
    );
    expect(checked.ok).toBe(false);
  }
});

it("refuses a private address on a cloud and takes it on a self-hosted instance", async () => {
  expect(
    (
      await checkOutboundUrl(
        "https://10.0.0.5/.well-known/openid-configuration",
        {
          allowPrivate: false,
        },
      )
    ).ok,
  ).toBe(false);
  expect(
    (
      await checkOutboundUrl(
        "https://10.0.0.5/.well-known/openid-configuration",
        {
          allowPrivate: true,
        },
      )
    ).ok,
  ).toBe(true);
});

it("takes a name that does not resolve only when asked to", async () => {
  const name = "https://no-such-idp.invalid/sso";
  expect((await checkOutboundUrl(name, { allowPrivate: false })).ok).toBe(
    false,
  );
  expect(
    (await checkOutboundUrl(name, { allowPrivate: false, allowUnresolved: true }))
      .ok,
  ).toBe(true);
});
