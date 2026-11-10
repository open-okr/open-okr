/**
 * The caller address notice on Admin, General (S-36, plan 0.8.0 H2,
 * docs/design/trusted-proxies.md D12).
 *
 * The suite's server runs with neither `OPENOKR_TRUSTED_PROXIES` nor
 * `OPENOKR_CLIENT_ADDRESS_HEADER` set, which is the shipped default: a
 * forwarded chain places nobody. A sign-in carrying one is what a visitor
 * behind a CDN and a load balancer sends, so after it this process has met a
 * caller it could not place, and the administrator is told what that costs
 * and which variable to set.
 *
 * `e2e/hosting.ts` gives each person one forwarded address, which is still
 * read as theirs. The notice stays up for the rest of the shard, which no
 * other spec minds: nothing else reads the instance notices.
 */
import { expect, test } from "./fixtures.ts";
import { RUN } from "./hosting.ts";
import { goTo, signIn } from "./instance-account.ts";

test("a sign-in from behind an unnamed proxy shows the notice on General", async ({
  page,
  playwright,
  baseURL,
}) => {
  const visitor = await playwright.request.newContext({
    baseURL: baseURL ?? "",
    extraHTTPHeaders: {
      origin: baseURL ?? "",
      // A caller-written entry, then the visitor as a load balancer saw them.
      "x-forwarded-for": "203.0.113.66, 198.51.100.7",
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
