/**
 * The caller address notice on Admin, General (S-36, plan 0.8.0 H2,
 * docs/design/trusted-proxies.md D12).
 *
 * The suite's server runs with nothing set, which is the shipped default:
 * the `X-Forwarded-For` entry one place from the right is the caller
 * (trusted-proxies.md §10). A load balancer that writes the port beside the
 * address, as some do, leaves that entry something that is not an address,
 * so after such a sign-in this process has met a caller it could not place,
 * and the administrator is told what that costs and which variable to set.
 *
 * `e2e/hosting.ts` gives each person one forwarded address, which is still
 * read as theirs. The notice stays up for the rest of the shard, which no
 * other spec minds: nothing else reads the instance notices.
 */
import { expect, test } from "./fixtures.ts";
import { RUN } from "./hosting.ts";
import { goTo, signIn } from "./instance-account.ts";

test("a sign-in nobody can place shows the notice on General", async ({
  page,
  playwright,
  baseURL,
}) => {
  const visitor = await playwright.request.newContext({
    baseURL: baseURL ?? "",
    extraHTTPHeaders: {
      origin: baseURL ?? "",
      // A caller-written entry, then the visitor as a load balancer that
      // writes ports saw them. Without the port the hop count places them.
      "x-forwarded-for": "203.0.113.66, 198.51.100.7:51234",
    },
  });
  // An address nobody has, so the wrong password counts against no account
  // another spec signs in as.
  const answer = await visitor.post("/api/auth/sign-in/email", {
    data: {
      email: `behind-a-proxy-${RUN}@example.com`,
      password: "not the password",
    },
  });
  expect(answer.status()).toBe(401);
  await visitor.dispose();

  await signIn(page);
  await goTo(page, "/admin/general");

  const notice = page.getByTestId("caller-address-notice");
  await expect(notice).toBeVisible();
  await expect(
    notice.getByRole("heading", {
      name: "This instance cannot tell some visitors apart",
    }),
  ).toBeVisible();
  await expect(notice).toContainText("OPENOKR_TRUSTED_PROXIES");
  await expect(
    notice.getByRole("link", { name: "Which to set for your setup" }),
  ).toHaveAttribute("href", /docs\/install\/behind-a-proxy\.md$/);
});
