/**
 * What the four hosted setups' specs share (PLAN.md §5.2,
 * docs/design/hosting-test-matrix.md).
 *
 * `hosting-okrgoal`, `hosting-provider`, `hosting-group` and
 * `hosting-one-company` each turn the one running server into a setup for their
 * own length and walk it as the people who use it: the operator who runs the
 * instance, a company's administrator who owns its workspace, a workspace
 * administrator they appoint, and a member doing the work.
 *
 * **Every setting is an instance setting, resolved per request**, so writing it
 * turns the same server into a cloud, a group or a company with several
 * workspaces, and deleting it turns it back. Each spec clears what it wrote in
 * `afterAll`, because every later spec on its shard expects the self-hosted
 * default.
 *
 * **Addresses carry the run**, so a retry, which Playwright gives a fresh worker,
 * meets new people rather than an address that already registered.
 */
import { createHmac } from "node:crypto";
import { createServer, type Server } from "node:net";
import { connectionOptions, testDbEnv } from "@openokr/test-support/db";
import type {
  Browser,
  BrowserContext,
  BrowserContextOptions,
  Page,
} from "@playwright/test";
import pg from "pg";
import {
  encryptSecret,
  parseKeyRing,
} from "../packages/core/src/secrets/key-ring.ts";
import { expect } from "./fixtures.ts";
import { goTo, INSTANCE_ACCOUNT, skipOnboarding } from "./instance-account.ts";
import { E2E_ENCRYPTION_KEY } from "./root-key.ts";

export const PASSWORD = "correct horse battery staple";

/** Unique to this worker, so a retry never meets the first attempt's people. */
export const RUN = Date.now().toString(36);

export interface Person {
  readonly name: string;
  readonly email: string;
}

// Started anywhere in the range, so a retry's people are not the first attempt's.
let lastAddress = Math.floor(Math.random() * 254);

/**
 * A browser for one person, arriving from an address of their own.
 *
 * **Better Auth allows ten sign-ups a minute from one address**, and every
 * context in the suite comes from 127.0.0.1. These journeys sign up a dozen
 * people inside a minute, which no one real machine does: the operator, the
 * customer and the customer's staff are on machines of their own. So each
 * person carries their own address in `X-Forwarded-For`, where the server
 * reads the caller behind the proxy every deployment puts in front of it
 * (`packages/core/src/auth/caller-address.ts`). The limit still applies to
 * each of them. The addresses are RFC 5737's documentation range, so none is
 * anybody's.
 */
export async function personContext(
  browser: Browser,
  options: BrowserContextOptions = {},
): Promise<BrowserContext> {
  lastAddress = (lastAddress % 254) + 1;
  return browser.newContext({
    ...options,
    extraHTTPHeaders: {
      ...options.extraHTTPHeaders,
      "x-forwarded-for": `198.51.100.${lastAddress}`,
    },
  });
}

/**
 * The superuser: `system_settings` and `instance_operators` sit above the
 * tenant floor, and writing either is instance administration, as it is in
 * s45-operator-console.spec.ts.
 */
export function instancePool(): pg.Pool {
  return new pg.Pool(
    process.env.DATABASE_URL
      ? { connectionString: process.env.DATABASE_URL }
      : connectionOptions(
          process.env.E2E_DATABASE ?? "openokr_e2e",
          testDbEnv.superuser,
        ),
  );
}

/** Writes plain settings the way a deployment's own are stored. */
export async function applySettings(
  pool: pg.Pool,
  settings: Readonly<Record<string, unknown>>,
): Promise<void> {
  for (const [key, value] of Object.entries(settings)) {
    await pool.query(
      `insert into system_settings (key, value, source)
       values ($1, $2::jsonb, 'admin')
       on conflict (key) do update set value = excluded.value,
         secret_ciphertext = null, secret_data_key = null, secret_key_id = null`,
      [key, JSON.stringify(value)],
    );
  }
}

/**
 * Stores a secret sealed under the root key the server runs with, as
 * `writeSettings` does, so the server opens it and nothing else can.
 */
export async function applySecret(
  pool: pg.Pool,
  key: string,
  secret: string,
): Promise<void> {
  const sealed = encryptSecret(
    parseKeyRing({ current: E2E_ENCRYPTION_KEY }),
    secret,
  );
  await pool.query(
    `insert into system_settings
       (key, value, secret_ciphertext, secret_data_key, secret_key_id, source)
     values ($1, 'null'::jsonb, $2, $3, $4, 'admin')
     on conflict (key) do update set value = excluded.value,
       secret_ciphertext = excluded.secret_ciphertext,
       secret_data_key = excluded.secret_data_key,
       secret_key_id = excluded.secret_key_id`,
    [key, sealed.ciphertext, sealed.dataKey, sealed.keyId],
  );
}

export async function clearSettings(
  pool: pg.Pool,
  keys: readonly string[],
): Promise<void> {
  await pool.query("delete from system_settings where key = any($1)", [
    [...keys],
  ]);
}

async function userIdOf(pool: pg.Pool, email: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    "select id from users where email = $1",
    [email],
  );
  const id = rows[0]?.id;
  if (!id) {
    throw new Error(`${email} has no account`);
  }
  return id;
}

/**
 * The deployment's grant, written to the table rather than through
 * `pnpm cloud:operator`, which `packages/core/test` proves. Granted by the
 * account that claimed the instance, because nobody grants it to themselves.
 */
export async function grantOperator(
  pool: pg.Pool,
  person: Person,
): Promise<void> {
  await pool.query(
    `insert into instance_operators (user_id, granted_by_user_id, note)
     values ($1, $2, 'granted by the end-to-end suite')
     on conflict (user_id) do update set revoked_at = null`,
    [
      await userIdOf(pool, person.email),
      await userIdOf(pool, INSTANCE_ACCOUNT.email),
    ],
  );
}

export async function revokeOperator(
  pool: pg.Pool,
  person: Person,
): Promise<void> {
  await pool.query(
    `update instance_operators set revoked_at = now()
      where user_id = (select id from users where email = $1)
        and revoked_at is null`,
    [person.email],
  );
}

export async function workspaceIdNamed(
  pool: pg.Pool,
  name: string,
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    "select id from workspaces where name = $1 and deleted_at is null",
    [name],
  );
  const id = rows[0]?.id;
  if (!id) {
    throw new Error(`No workspace is called ${name}`);
  }
  return id;
}

/**
 * The one workspace this person belongs to, which for somebody who has just
 * signed up is the one they own. By address rather than by name, because a
 * workspace is named after its owner and a retry signs up a namesake.
 */
export async function onlyWorkspaceOf(
  pool: pg.Pool,
  email: string,
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `select m.workspace_id as id from workspace_members m
       join users u on u.id = m.user_id
      where u.email = $1 and m.deleted_at is null`,
    [email],
  );
  if (rows.length !== 1) {
    throw new Error(`${email} belongs to ${rows.length} workspaces, not one`);
  }
  return (rows[0] as { id: string }).id;
}

/** The member this person is in that workspace. */
export async function memberIdIn(
  pool: pg.Pool,
  workspaceId: string,
  email: string,
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `select m.id from workspace_members m join users u on u.id = m.user_id
      where m.workspace_id = $1 and u.email = $2 and m.deleted_at is null`,
    [workspaceId, email],
  );
  const id = rows[0]?.id;
  if (!id) {
    throw new Error(`${email} is not a member of ${workspaceId}`);
  }
  return id;
}

/** The built-in role this person holds there: owner, admin, member or viewer. */
export async function roleIn(
  pool: pg.Pool,
  workspaceId: string,
  email: string,
): Promise<string | null> {
  const { rows } = await pool.query<{ key: string | null }>(
    `select r.builtin_key as key
       from workspace_members m
       join users u on u.id = m.user_id
       left join workspace_roles r on r.id = m.role_id
      where m.workspace_id = $1 and u.email = $2 and m.deleted_at is null`,
    [workspaceId, email],
  );
  return rows[0]?.key ?? null;
}

/**
 * What follows Create account (plan 0.8.0 S4). Where nothing waits, the
 * welcome card's Get started goes in. Where confirmation is required, the
 * address is confirmed from the link in the caught mail and the person signs
 * in: an instance with mail whose registration is limited to company domains
 * keeps it required whatever the setting says (Q13), for a newcomer by
 * invitation too, so a spec on one passes its catcher.
 */
/**
 * Which way a sign-up ended: on the welcome card, or by confirming from the
 * mail. A spec that knows which its instance gives says so with the answer.
 */
export type SignUpEnding = "welcome" | "confirmed_by_mail";

async function throughSignUpEnding(
  page: Page,
  person: Person,
  mail?: MailCatcher,
): Promise<SignUpEnding> {
  const welcome = page.getByTestId("get-started");
  const checkEmail = page.getByTestId("check-email");
  await expect(welcome.or(checkEmail)).toBeVisible({ timeout: 30_000 });
  if (!(await checkEmail.isVisible())) {
    await welcome.click();
    return "welcome";
  }
  if (!mail) {
    throw new Error(
      `${person.email} has to confirm its address on this instance: pass the mail catcher.`,
    );
  }
  const text = await mail.waitFor(person.email, /verify-email/);
  const link = text.match(
    /https?:\/\/[^\s)>\]]+\/api\/auth\/verify-email\?[^\s)>\]]+/,
  )?.[0];
  if (!link) {
    throw new Error(`No confirmation link in:\n${text}`);
  }
  await page.goto(link);
  await page.getByRole("link", { name: "Sign in", exact: true }).click();
  await page.getByLabel("Email").fill(person.email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).first().click();
  return "confirmed_by_mail";
}

/**
 * Signs somebody up through the open sign-up page, and skips their setup.
 *
 * Where nothing waits, the welcome card's Get started goes in (plan 0.8.0
 * S4). Where confirmation is required, the address is confirmed from the link
 * in the caught mail and they sign in: an instance with mail whose
 * registration is limited to company domains keeps confirmation required
 * whatever the setting says (Q13), so a spec on one passes its catcher.
 */
export async function signUp(
  page: Page,
  person: Person,
  mail?: MailCatcher,
): Promise<void> {
  await goTo(page, "/sign-up");
  await page.getByLabel("Name").fill(person.name);
  await page.getByLabel("Email").fill(person.email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await throughSignUpEnding(page, person, mail);
  await skipOnboarding(page);
  await expect(page).toHaveURL("/", { timeout: 15_000 });
}

/**
 * An administrator's invitation by address, from Admin → Invitations. Returns
 * the link's path, which is what the invited person opens.
 */
export async function inviteByEmail(
  page: Page,
  email: string,
): Promise<string> {
  // Retried rather than asserted after, for the reason `s35-join` records: a
  // document navigation issued into a settling client transition is aborted.
  await expect(async () => {
    await page.goto("/admin/invitations");
    await expect(page.getByLabel("Email address", { exact: true })).toBeVisible(
      { timeout: 5_000 },
    );
  }).toPass({ timeout: 30_000 });
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Create the invitation" }).click();
  const link = page.getByTestId("invite-link");
  await expect(link).toBeVisible({ timeout: 15_000 });
  const url = (await link.textContent())?.trim() ?? "";
  return new URL(url).pathname;
}

/**
 * Accepts an invitation as somebody with no account yet: the join page, then the
 * sign-up it leads to. A first administrator of a fresh workspace lands on its
 * setup, which is skipped; everybody else lands on their front door.
 */
export async function joinAsNewcomer(
  page: Page,
  joinPath: string,
  person: Person,
  mail?: MailCatcher,
): Promise<SignUpEnding> {
  await goTo(page, joinPath);
  await expect(
    page.getByRole("heading", { name: /You have been invited/ }),
  ).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Name").fill(person.name);
  await page.getByLabel("Email").fill(person.email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  const ending = await throughSignUpEnding(page, person, mail);
  await page.waitForURL(
    (url) => url.pathname === "/" || url.pathname === "/welcome",
    { timeout: 30_000 },
  );
  await skipSetupIfAsked(page);
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible({
    timeout: 30_000,
  });
  return ending;
}

/**
 * A fresh workspace sends its owner to its setup, and only once the front door
 * has settled, so arriving on `/` is not yet the answer. Waits for either the
 * shell or the setup, then skips the setup if that is what came.
 *
 * **Asked again as a whole page when the answer was `/`.** The home page
 * sends an owner who has not set up to `/welcome` with a server redirect, but
 * reached by an in-app navigation, which is how sign-up arrives, the layout's
 * shell paints first and the redirect lands about 300 ms later. A look in
 * between sees the shell on `/` and skips nothing, and the setup then covers
 * the shell: the first CI run of PR #210 failed exactly so, twice in a row.
 * `networkidle` cannot close the gap, because the page reached it long before
 * this navigation and it returns at once. A document request follows the
 * redirect before anything paints, so the address it ends on is the answer.
 */
async function skipSetupIfAsked(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  if (new URL(page.url()).pathname === "/") {
    await goTo(page, "/");
  }
  await expect(
    page
      .getByRole("navigation", { name: "Primary" })
      .or(page.getByTestId("welcome-skip"))
      .first(),
  ).toBeVisible({ timeout: 30_000 });
  if (new URL(page.url()).pathname === "/welcome") {
    await skipOnboarding(page);
  }
}

/** Accepts an invitation as somebody already signed in. */
export async function joinWhileSignedIn(
  page: Page,
  joinPath: string,
  workspaceName: string,
): Promise<void> {
  await goTo(page, joinPath);
  await page.getByRole("button", { name: `Join ${workspaceName}` }).click();
  await page.waitForURL((url) => url.pathname === "/", { timeout: 30_000 });
}

/** An owner makes a member an administrator from the member's own page. */
export async function makeAdministrator(
  page: Page,
  memberId: string,
): Promise<void> {
  await goTo(page, `/people/${memberId}`);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Make administrator" }).click();
  await expect(
    page.getByRole("button", { name: "Remove as administrator" }),
  ).toBeVisible({ timeout: 15_000 });
}

/** Chooses another workspace in the switcher at the top of the sidebar. */
export async function switchWorkspace(page: Page, name: string): Promise<void> {
  const select = page.getByLabel("Workspace", { exact: true }).first();
  const id = await select
    .locator("option", { hasText: name })
    .getAttribute("value");
  expect(id, `the switcher does not offer ${name}`).toBeTruthy();
  await select.selectOption({ label: name });
  // The choice is a cookie the server action sets, and the next request reads.
  await expect(async () => {
    const cookies = await page.context().cookies();
    expect(
      cookies.find((cookie) => cookie.name === "openokr_workspace")?.value,
    ).toBe(id);
  }).toPass({ timeout: 15_000 });
  await goTo(page, "/");
  await skipSetupIfAsked(page);
  await expect(
    page
      .getByLabel("Workspace", { exact: true })
      .first()
      .locator("option:checked"),
  ).toHaveText(name, { timeout: 15_000 });
}

/** The workspaces the switcher offers, or none when there is nowhere to go. */
export async function switcherOptions(page: Page): Promise<string[]> {
  const select = page.getByLabel("Workspace", { exact: true });
  if ((await select.count()) === 0) {
    return [];
  }
  return select.first().locator("option").allTextContents();
}

export async function expectNotFound(page: Page, route: string): Promise<void> {
  await goTo(page, route);
  await expect(
    page.getByRole("heading", { level: 1, name: "Not found" }),
  ).toBeVisible({ timeout: 15_000 });
}

/**
 * A member's own objective, typed into the OKR list the way s13c does, so each
 * setup has somebody doing the work as well as running it. Returns its id.
 */
export async function writeObjective(
  page: Page,
  pool: pg.Pool,
  title: string,
): Promise<string> {
  const main = page.getByRole("main");
  await goTo(page, "/goals");
  const add = main.getByRole("button", { name: "Add objective" }).last();
  await expect(add).toBeVisible({ timeout: 15_000 });
  await add.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.type(title);
  await page.keyboard.press("Enter");
  await expect(
    main.getByRole("textbox", { name: "Add key result" }),
  ).toBeFocused({ timeout: 15_000 });
  let id = "";
  await expect(async () => {
    const { rows } = await pool.query<{ id: string }>(
      "select id from goals where title = $1 and deleted_at is null",
      [title],
    );
    id = rows[0]?.id ?? "";
    expect(id).not.toBe("");
  }).toPass({ timeout: 15_000 });
  return id;
}

/** An operator moves a workspace from S-46, with the reason a customer reads. */
export async function operatorMoves(
  page: Page,
  workspaceId: string,
  workspaceName: string,
  state: "active" | "suspended",
  reason: string,
): Promise<void> {
  await goTo(page, `/operator/${workspaceId}`);
  await page.locator("#lifecycle-state").selectOption(state);
  await page.locator("#lifecycle-reason").fill(reason);
  await page.getByRole("button", { name: `Apply to ${workspaceName}` }).click();
  await expect(
    page.getByText("Applied. The workspace's members see the change now."),
  ).toBeVisible({ timeout: 15_000 });
}

/** An operator sets a workspace's plan from S-46. */
export async function operatorSetsPlan(
  page: Page,
  workspaceId: string,
  workspaceName: string,
  planKey: string,
  reason: string,
): Promise<void> {
  await goTo(page, `/operator/${workspaceId}`);
  await page.locator("#plan-key").selectOption(planKey);
  await page.locator("#plan-reason").fill(reason);
  await page
    .getByRole("button", { name: `Set the plan for ${workspaceName}` })
    .click();
  await expect(page.getByText("The plan was changed.")).toBeVisible({
    timeout: 15_000,
  });
}

/** A Stripe-Signature header for this body, as Stripe computes it. */
export function stripeSignature(body: string, secret: string): string {
  const at = Math.floor(Date.now() / 1000);
  const signed = createHmac("sha256", secret)
    .update(`${at}.${body}`)
    .digest("hex");
  return `t=${at},v1=${signed}`;
}

interface CaughtMail {
  readonly to: readonly string[];
  readonly text: string;
}

/** Decodes the parts of a MIME message a person would read. */
function readable(raw: string): string {
  const message = raw.replace(/\r\n\.\./g, "\r\n.");
  return message
    .split(/\r\n--[^\r\n]+/)
    .map((part) => {
      const split = part.indexOf("\r\n\r\n");
      if (split === -1) {
        return part;
      }
      const headers = part.slice(0, split).toLowerCase();
      const body = part.slice(split + 4);
      if (headers.includes("content-transfer-encoding: base64")) {
        return Buffer.from(body.replace(/\s+/g, ""), "base64").toString("utf8");
      }
      if (headers.includes("content-transfer-encoding: quoted-printable")) {
        return Buffer.from(
          body
            .replace(/=\r\n/g, "")
            .replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) =>
              String.fromCharCode(Number.parseInt(hex, 16)),
            ),
          "latin1",
        ).toString("utf8");
      }
      return body;
    })
    .join("\n");
}

/**
 * A mail server for the length of one spec, so an invitation can be followed
 * the way its recipient follows it.
 *
 * **The suite has no mailbox, and the relay strips an invitation's token from
 * its outbox row the moment it is delivered**, so the email is the only place
 * the link exists. Mail settings are read per delivery (`apps/web/lib/mail.ts`),
 * so pointing `mail.transport` at this turns it on with no restart. It speaks
 * just enough SMTP for one client on the same machine, and offers no TLS, which
 * is why the spec also sets `mail.requireTls` off.
 */
export class MailCatcher {
  readonly #server: Server;
  /** Written by the listener, read by `waitFor`. */
  readonly #caught: CaughtMail[];

  private constructor(server: Server, caught: CaughtMail[]) {
    this.#server = server;
    this.#caught = caught;
  }

  static async start(): Promise<MailCatcher> {
    const caught: CaughtMail[] = [];
    const server = createServer((socket) => {
      socket.setEncoding("utf8");
      let buffer = "";
      let data: string | null = null;
      let to: string[] = [];
      const reply = (line: string) => socket.write(`${line}\r\n`);
      reply("220 hosting-spec ESMTP");
      socket.on("data", (chunk: string) => {
        buffer += chunk;
        for (;;) {
          if (data !== null) {
            const end = buffer.indexOf("\r\n.\r\n");
            if (end === -1) {
              return;
            }
            data += buffer.slice(0, end);
            buffer = buffer.slice(end + 5);
            caught.push({ to, text: readable(data) });
            data = null;
            to = [];
            reply("250 OK");
            continue;
          }
          const end = buffer.indexOf("\r\n");
          if (end === -1) {
            return;
          }
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const verb = line.slice(0, 4).toUpperCase();
          if (verb === "EHLO") {
            socket.write("250-hosting-spec\r\n250 8BITMIME\r\n");
          } else if (verb === "RCPT") {
            to.push(line.replace(/^RCPT TO:\s*<?([^>\s]*)>?.*$/i, "$1"));
            reply("250 OK");
          } else if (verb === "DATA") {
            data = "";
            reply("354 End data with <CR><LF>.<CR><LF>");
          } else if (verb === "QUIT") {
            reply("221 Bye");
            socket.end();
            return;
          } else {
            reply("250 OK");
          }
        }
      });
      socket.on("error", () => undefined);
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    return new MailCatcher(server, caught);
  }

  /** The settings that send this instance's mail here. */
  settings(): Record<string, unknown> {
    const address = this.#server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    return {
      "mail.transport": "smtp",
      "mail.host": "127.0.0.1",
      "mail.port": port,
      "mail.secure": false,
      "mail.requireTls": false,
    };
  }

  /** The first message to this address whose text matches, once it arrives. */
  async waitFor(address: string, match: RegExp): Promise<string> {
    let found = "";
    await expect(async () => {
      const mail = this.#caught.find(
        (one) =>
          one.to.some((to) => to.toLowerCase() === address.toLowerCase()) &&
          match.test(one.text),
      );
      found = mail?.text ?? "";
      expect(found, `no mail to ${address} matching ${match}`).not.toBe("");
    }).toPass({ timeout: 45_000 });
    return found;
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => this.#server.close(() => resolve()));
  }
}

/** The path of the invitation link in an email's text. */
export function joinPathIn(text: string): string {
  const match = text.match(/\/join\/([A-Za-z0-9_-]{20,})/);
  if (!match) {
    throw new Error(`No invitation link in:\n${text}`);
  }
  return match[0];
}
