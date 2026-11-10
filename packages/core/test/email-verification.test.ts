import { createHash } from "node:crypto";
import { workerDb } from "@openokr/test-support/db";
import type { Pool } from "pg";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createAuth } from "../src/auth/auth.ts";
import { authLimiterStorage } from "../src/auth/limiter-storage.ts";
import {
  EMAIL_VERIFICATION_LINK_SECONDS,
  VERIFY_EMAIL_TOPIC,
} from "../src/auth/verification-links.ts";
import {
  dispatchOutbox,
  type OutboxHandlerDeps,
} from "../src/outbox/handlers.ts";
import {
  METRIC,
  type MetricRecorder,
  NO_METRICS,
  setDefaultMetrics,
} from "../src/telemetry/recorder.ts";

/**
 * The confirmation link through the outbox, and "send the link again"
 * (docs/design/email-verification.md, plan 0.8.0 S3 carrying H1).
 *
 * Driven through Better Auth's HTTP handler against a real database, because
 * the answers a stranger can compare, their status, body and time, are the
 * point. The relay is stood in for by `dispatchOutbox` with a recording
 * `sendMail`, which is all the relay adds.
 */

type Auth = ReturnType<typeof createAuth>;

const BASE_URL = "http://localhost:3000";
const SECRET = "a-test-secret-of-sufficient-length-for-signing";
const PASSWORD = "correct horse battery staple";
const OWNER = "owner@example.com";

/**
 * Stands in for the Postgres cache, with windows that close on a clock the
 * test moves, so a day can pass in a line.
 */
function clockCache() {
  let now = Date.now();
  const windows = new Map<string, { used: number; resetAt: number }>();
  return {
    advance(seconds: number) {
      now += seconds * 1000;
    },
    async rateLimit(key: string, limit: number, windowSeconds: number) {
      const open = windows.get(key);
      const entry =
        open && open.resetAt > now
          ? open
          : { used: 0, resetAt: now + windowSeconds * 1000 };
      entry.used += 1;
      windows.set(key, entry);
      return {
        allowed: entry.used <= limit,
        remaining: Math.max(0, limit - entry.used),
        resetSeconds: Math.ceil((entry.resetAt - now) / 1000),
      };
    },
  };
}

let cache: ReturnType<typeof clockCache>;
let auth: Auth;
let resetLinks: string[];
let counted: { name: string; labels: Record<string, string> }[];

const metrics: MetricRecorder = {
  count(name, labels) {
    counted.push({
      name,
      labels: { ...(labels ?? {}) } as Record<string, string>,
    });
  },
  observe() {},
  gauge() {},
  span(_name, _attributes, fn) {
    return fn();
  },
};

const build = (
  pool: Pool,
  overrides: Partial<Parameters<typeof createAuth>[0]> = {},
) =>
  createAuth({
    pool,
    secret: SECRET,
    baseUrl: BASE_URL,
    requireEmailVerification: true,
    rateLimitStorage: authLimiterStorage(cache),
    sendResetPassword: async ({ url }) => {
      resetLinks.push(url);
    },
    ...overrides,
  });

const post = (
  path: string,
  body: unknown,
  network = "203.0.113.10",
  headers: Record<string, string> = {},
  instance: Auth = auth,
) =>
  instance.handler(
    new Request(`${BASE_URL}/api/auth${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": network,
        ...headers,
      },
      body: JSON.stringify(body),
    }),
  );

const signUp = (email: string, network?: string) =>
  post(
    "/sign-up/email",
    {
      email,
      password: PASSWORD,
      name: "Someone",
      callbackURL: "/email-confirmed",
    },
    network,
  );

const resend = (email: string, network?: string, instance?: Auth) =>
  post(
    "/send-verification-email",
    { email, callbackURL: "/email-confirmed" },
    network,
    {},
    instance,
  );

const cookieFrom = (response: Response): string =>
  response.headers
    .getSetCookie()
    .map((header) => header.split(";")[0] as string)
    .join("; ");

interface QueuedRow {
  idempotency_key: string;
  payload: {
    userId: string;
    to: string;
    url: string;
    expiresAt: string;
    reason: string;
  };
}

const queued = async (): Promise<QueuedRow[]> => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<QueuedRow>(
    "select idempotency_key, payload from outbox where topic = $1 order by created_at, id",
    [VERIFY_EMAIL_TOPIC],
  );
  return rows;
};

const userRow = async (email: string) => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{ id: string; verified: boolean }>(
    "select id, email_verified as verified from users where email = $1",
    [email],
  );
  return rows[0];
};

const verifiedRows = async () => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{
    payload: { userId: string; via: string };
  }>(
    "select payload from instance_audit_events where action = 'auth.email_verified' order by seq",
  );
  return rows.map((row) => row.payload);
};

/**
 * Waits for the clock's next second. A link is a token signed to the second,
 * so two asked for in the same second are the same link, and the second is
 * not queued again (D4). A person cannot press that fast; a test can.
 */
const nextSecond = () =>
  new Promise((resolve) =>
    setTimeout(resolve, 1000 - (Date.now() % 1000) + 10),
  );

/** Waits for work a request started and did not wait for. */
const eventually = async (check: () => Promise<boolean>) => {
  for (let tries = 0; tries < 50; tries++) {
    if (await check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("it never happened");
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  cache = clockCache();
  resetLinks = [];
  counted = [];
  setDefaultMetrics(metrics);
  auth = build(wb.appPool);
  // The account that claims the instance arrives confirmed (BUG-028), and
  // registration stays open so a second sign-up is refused by nothing but
  // the rule under test.
  expect((await signUp(OWNER, "192.0.2.1")).status).toBe(200);
  await wb.admin.query(
    `insert into system_settings (key, value, source)
     values ('registration.policy', '"open"'::jsonb, 'admin')`,
  );
});

afterEach(() => {
  setDefaultMetrics(NO_METRICS);
  vi.restoreAllMocks();
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("a sign-up where mail can arrive", () => {
  it("queues exactly one link and answers as before", async () => {
    // The account that claimed the instance was queued nothing.
    expect(await queued()).toEqual([]);

    const response = await signUp("new@example.com");
    expect(response.status).toBe(200);
    expect(((await response.json()) as { token: unknown }).token).toBeNull();

    const rows = await queued();
    expect(rows).toHaveLength(1);
    const [row] = rows;
    const user = await userRow("new@example.com");
    expect(row?.payload).toMatchObject({
      userId: user?.id,
      to: "new@example.com",
      reason: "sign_up",
    });
    const url = new URL(row?.payload.url ?? "");
    expect(url.pathname).toBe("/api/auth/verify-email");
    expect(url.searchParams.get("callbackURL")).toBe("/email-confirmed");
    // The same link is never queued twice: the key is the token's digest.
    const token = url.searchParams.get("token") ?? "";
    expect(row?.idempotency_key).toBe(
      `${VERIFY_EMAIL_TOPIC}:${createHash("sha256").update(token).digest("hex")}`,
    );
    // It works for a day.
    const lifetime = Date.parse(row?.payload.expiresAt ?? "") - Date.now();
    expect(lifetime).toBeGreaterThan(
      (EMAIL_VERIFICATION_LINK_SECONDS - 60) * 1000,
    );
    expect(lifetime).toBeLessThanOrEqual(
      EMAIL_VERIFICATION_LINK_SECONDS * 1000,
    );

    expect(counted).toContainEqual({
      name: METRIC.verificationLinksTotal,
      labels: { reason: "sign_up", outcome: "queued" },
    });
  });

  it("answers the same when the row cannot be written, and says so in the log", async () => {
    const wb = await workerDb();
    const failing = new Proxy(wb.appPool, {
      get(target, property, receiver) {
        if (property === "query") {
          return (query: unknown, ...rest: unknown[]) => {
            const text =
              typeof query === "string"
                ? query
                : ((query as { text?: string }).text ?? "");
            if (/insert into outbox/i.test(text)) {
              return Promise.reject(new Error("the outbox is unavailable"));
            }
            return (target.query as (...args: unknown[]) => unknown).call(
              target,
              query,
              ...rest,
            );
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    auth = build(failing);
    const written: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      written.push(String(chunk));
      return true;
    });

    const response = await signUp("stuck@example.com");
    expect(response.status).toBe(200);
    expect(((await response.json()) as { token: unknown }).token).toBeNull();

    const again = await resend("stuck@example.com", "203.0.113.11");
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ status: true });

    expect(await queued()).toEqual([]);
    expect(written.join("")).toContain("could not queue a confirmation link");
    expect(counted).toContainEqual({
      name: METRIC.verificationLinksTotal,
      labels: { reason: "sign_up", outcome: "failed" },
    });
    expect(counted).toContainEqual({
      name: METRIC.verificationLinksTotal,
      labels: { reason: "resend", outcome: "failed" },
    });
  });
});

describe("send the link again", () => {
  it("queues a link for an unconfirmed address, and the link confirms it", async () => {
    await signUp("waiting@example.com");
    await nextSecond();
    const response = await resend("waiting@example.com", "203.0.113.12");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: true });

    const rows = await queued();
    expect(rows.map((row) => row.payload.reason)).toEqual([
      "sign_up",
      "resend",
    ]);

    const opened = await auth.handler(new Request(rows[1]?.payload.url ?? ""));
    expect(opened.status).toBe(302);
    expect(opened.headers.get("location")).toBe("/email-confirmed");
    const user = await userRow("waiting@example.com");
    expect(user?.verified).toBe(true);
    expect(await verifiedRows()).toEqual([{ userId: user?.id, via: "link" }]);

    // The older link, opened after the newer, lands with no error and
    // records nothing more.
    const older = await auth.handler(new Request(rows[0]?.payload.url ?? ""));
    expect(older.headers.get("location")).toBe("/email-confirmed");
    expect(await verifiedRows()).toHaveLength(1);
  });

  it("answers an unknown and a confirmed address exactly the same, no sooner, and queues nothing", async () => {
    await signUp("waiting@example.com");
    await nextSecond();
    const answers: { status: number; body: unknown; ms: number }[] = [];
    for (const [index, email] of [
      "waiting@example.com",
      "nobody@example.com",
      OWNER,
    ].entries()) {
      const started = Date.now();
      const response = await resend(email, `203.0.113.${20 + index}`);
      answers.push({
        status: response.status,
        body: await response.json(),
        ms: Date.now() - started,
      });
    }
    for (const answer of answers) {
      expect(answer.status).toBe(200);
      expect(answer.body).toEqual({ status: true });
      expect(answer.ms).toBeGreaterThanOrEqual(495);
    }
    expect((await queued()).map((row) => row.payload.to)).toEqual([
      "waiting@example.com",
      "waiting@example.com",
    ]);
  });

  it("holds a second request within a minute, the same for every address", async () => {
    await signUp("waiting@example.com");
    const bodies: unknown[] = [];
    for (const email of ["waiting@example.com", "nobody@example.com"]) {
      expect((await resend(email, "203.0.113.30")).status).toBe(200);
      const held = await resend(email, "203.0.113.31");
      expect(held.status).toBe(429);
      expect(Number(held.headers.get("retry-after"))).toBeGreaterThan(0);
      expect(held.headers.get("x-retry-after")).toBeNull();
      const body = (await held.json()) as Record<string, unknown>;
      expect(body).toMatchObject({
        code: "VERIFICATION_RESEND_HELD",
        message:
          "Too many links have been asked for this address. Try again in 1 minute.",
      });
      expect(Number(body.retryAfterSeconds)).toBeGreaterThan(0);
      bodies.push({ ...body, retryAfterSeconds: undefined });
    }
    expect(bodies[0]).toEqual(bodies[1]);
    expect(counted).toContainEqual({
      name: METRIC.verificationLinksTotal,
      labels: { reason: "resend", outcome: "refused" },
    });
  });

  it("allows five a day, and refuses the sixth from another network with hours to wait", async () => {
    await signUp("waiting@example.com");
    for (let day = 0; day < 5; day++) {
      await nextSecond();
      const response = await resend("waiting@example.com", `198.51.100.${day}`);
      expect(response.status).toBe(200);
      cache.advance(61);
    }
    const sixth = await resend("waiting@example.com", "198.51.100.99");
    expect(sixth.status).toBe(429);
    const body = (await sixth.json()) as {
      retryAfterSeconds: number;
      message: string;
    };
    expect(body.retryAfterSeconds).toBeGreaterThan(60 * 60);
    expect(body.message).toMatch(/Try again in \d+ hours\./);
    // Five from the button and the sign-up's own, nothing for the sixth.
    expect(await queued()).toHaveLength(6);
  });

  it("refuses the sixth request from one network within a minute across two processes", async () => {
    const wb = await workerDb();
    const other = build(wb.appPool);
    const statuses: number[] = [];
    for (let index = 0; index < 5; index++) {
      const instance = index % 2 === 0 ? auth : other;
      statuses.push(
        (await resend(`person${index}@example.com`, "203.0.113.40", instance))
          .status,
      );
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200]);
    const sixth = await resend("person5@example.com", "203.0.113.40", other);
    expect(sixth.status).toBe(429);
    // The limiter's own answer, which the route records as auth.rate_limited.
    expect(Number(sixth.headers.get("x-retry-after"))).toBeGreaterThan(0);
  });
});

describe("signing up again", () => {
  it("queues a fresh link for an unconfirmed address, and answers as for anybody", async () => {
    await signUp("waiting@example.com");
    await nextSecond();
    const again = await signUp("waiting@example.com", "203.0.113.50");
    expect(again.status).toBe(200);
    expect(((await again.json()) as { token: unknown }).token).toBeNull();

    await eventually(async () => (await queued()).length === 2);
    expect((await queued()).map((row) => row.payload.reason)).toEqual([
      "sign_up",
      "repeat_sign_up",
    ]);
  });

  it("sends a confirmed address nothing", async () => {
    const again = await signUp(OWNER, "203.0.113.51");
    expect(again.status).toBe(200);
    expect(((await again.json()) as { token: unknown }).token).toBeNull();
    // Long enough for a write nobody waited on to have landed if there were one.
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(await queued()).toEqual([]);
  });

  it("queues nothing once the address has spent its allowance", async () => {
    await signUp("waiting@example.com");
    await nextSecond();
    expect((await resend("waiting@example.com", "203.0.113.52")).status).toBe(
      200,
    );
    await nextSecond();
    await signUp("waiting@example.com", "203.0.113.53");
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect((await queued()).map((row) => row.payload.reason)).toEqual([
      "sign_up",
      "resend",
    ]);
  });
});

describe("a completed password reset", () => {
  const reset = async (email: string, newPassword: string) => {
    const requested = await post(
      "/request-password-reset",
      { email, redirectTo: `${BASE_URL}/reset-password` },
      "192.0.2.60",
    );
    expect(requested.status).toBe(200);
    const token = new URL(resetLinks.at(-1) ?? "").pathname.split("/").at(-1);
    const done = await post(
      "/reset-password",
      { newPassword, token },
      "192.0.2.60",
    );
    expect(done.status).toBe(200);
  };

  it("confirms an unconfirmed address, once, and the new password signs in", async () => {
    await signUp("stuck@example.com");
    const before = await post("/sign-in/email", {
      email: "stuck@example.com",
      password: PASSWORD,
    });
    expect(before.status).toBe(403);

    const NEW_PASSWORD = "a brand new and longer password";
    await reset("stuck@example.com", NEW_PASSWORD);

    const user = await userRow("stuck@example.com");
    expect(user?.verified).toBe(true);
    expect(await verifiedRows()).toEqual([{ userId: user?.id, via: "reset" }]);

    const after = await post("/sign-in/email", {
      email: "stuck@example.com",
      password: NEW_PASSWORD,
    });
    expect(after.status).toBe(200);
  });

  it("ends every session of the account, and records nothing for a confirmed one", async () => {
    const first = cookieFrom(
      await post("/sign-in/email", { email: OWNER, password: PASSWORD }),
    );
    const second = cookieFrom(
      await post("/sign-in/email", { email: OWNER, password: PASSWORD }),
    );

    await reset(OWNER, "another brand new password");

    for (const cookie of [first, second]) {
      const session = await auth.handler(
        new Request(`${BASE_URL}/api/auth/get-session`, {
          headers: { cookie },
        }),
      );
      expect(await session.json()).toBeNull();
    }
    expect(await verifiedRows()).toEqual([]);
  });
});

describe("where mail cannot arrive", () => {
  it("signs a new account straight in and queues nothing, and the resend still answers", async () => {
    const wb = await workerDb();
    auth = build(wb.appPool, { requireEmailVerification: false });

    const response = await signUp("console@example.com");
    expect(response.status).toBe(200);
    expect(((await response.json()) as { token: unknown }).token).toBeTruthy();

    const again = await resend("console@example.com", "203.0.113.70");
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ status: true });
    expect(await queued()).toEqual([]);
  });
});

describe("the relay's delivery", () => {
  const deliver = async (
    payload: Record<string, unknown>,
    over: Partial<OutboxHandlerDeps> = {},
  ) => {
    const wb = await workerDb();
    const sent: { to: string; subject: string; text: string }[] = [];
    const skipped: string[] = [];
    await dispatchOutbox(
      {
        topic: VERIFY_EMAIL_TOPIC,
        payload,
        idempotencyKey: "k",
        attempts: 1,
      },
      {
        pool: wb.appPool,
        baseUrl: BASE_URL,
        instanceName: "Northwind OKR",
        sendMail: async (message) => {
          sent.push(message);
        },
        onSkipped: (_delivery, reason) => skipped.push(reason),
        ...over,
      },
    );
    return { sent, skipped };
  };

  const queuedFor = async (email: string) => {
    await signUp(email);
    const row = (await queued()).find((entry) => entry.payload.to === email);
    if (!row) {
      throw new Error("nothing was queued");
    }
    return row.payload as unknown as Record<string, unknown>;
  };

  it("sends the link, in the instance's language, saying how long it works", async () => {
    const payload = await queuedFor("waiting@example.com");
    const wb = await workerDb();
    await wb.admin.query(
      `insert into system_settings (key, value, source)
       values ('instance.language', '"ms"'::jsonb, 'admin')`,
    );

    const { sent, skipped } = await deliver(payload);
    expect(skipped).toEqual([]);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("waiting@example.com");
    expect(sent[0]?.subject).toBe(
      "Sahkan alamat e-mel anda untuk Northwind OKR",
    );
    expect(sent[0]?.text).toContain(String(payload.url));
    expect(sent[0]?.text).toContain("24 jam");
  });

  it("skips an account confirmed since, one gone, and one whose address changed", async () => {
    const payload = await queuedFor("waiting@example.com");
    const wb = await workerDb();

    await wb.admin.query(
      "update users set email = 'moved@example.com' where id = $1",
      [payload.userId],
    );
    expect((await deliver(payload)).skipped).toEqual([
      "the account's address has changed",
    ]);

    await wb.admin.query(
      "update users set email = 'waiting@example.com', email_verified = true where id = $1",
      [payload.userId],
    );
    expect((await deliver(payload)).skipped).toEqual([
      "the address is already confirmed",
    ]);

    expect(
      (await deliver({ ...payload, userId: "no-such-account" })).skipped,
    ).toEqual(["the account is gone"]);
  });
});
