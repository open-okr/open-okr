import { describe, expect, test } from "vitest";
import { type BoundarySourceFile, checkBoundaries } from "../src/boundaries.ts";

/**
 * The check that keeps the adapter seam real. Both directions matter: it has
 * to catch the mistakes, and it must not cry wolf on correct code, or the
 * first thing anyone does is add an escape marker.
 */

const check = (path: string, text: string) => checkBoundaries([{ path, text }]);

describe("vendor SDK rule", () => {
  test("fails a vendor SDK imported outside packages/adapters", () => {
    const violations = check(
      "packages/core/src/notify.ts",
      `import nodemailer from "nodemailer";\n`,
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ rule: "vendor-sdk", line: 1 });
  });

  test("allows the same import inside packages/adapters", () => {
    expect(
      check(
        "packages/adapters/src/drivers/mail/smtp.ts",
        `import nodemailer from "nodemailer";\n`,
      ),
    ).toEqual([]);
  });

  test("catches subpath imports of a vendor package", () => {
    expect(
      check(
        "apps/web/app/api/route.ts",
        `import { S3 } from "@aws-sdk/client-s3/dist";\n`,
      ),
    ).toHaveLength(1);
  });

  test("catches dynamic import and require", () => {
    expect(
      check(
        "packages/core/src/a.ts",
        `const openai = await import("openai");\n`,
      ),
    ).toHaveLength(1);
    expect(
      check("packages/core/src/b.ts", `const ws = require("ws");\n`),
    ).toHaveLength(1);
  });

  test("catches a re-export of a vendor package", () => {
    expect(
      check("packages/core/src/c.ts", `export { WebSocket } from "ws";\n`),
    ).toHaveLength(1);
  });

  test("does not flag the database layer, which owns Postgres directly", () => {
    expect(
      check(
        "packages/db/src/tenant.ts",
        `import pg from "pg";\nimport { sql } from "drizzle-orm";\n`,
      ),
    ).toEqual([]);
  });

  test("does not flag a package whose name merely starts the same way", () => {
    expect(
      check(
        "packages/core/src/d.ts",
        `import x from "ws-utils";\nimport y from "airtable";\n`,
      ),
    ).toEqual([]);
  });

  test("honours an allow marker that carries a reason", () => {
    const allowed = check(
      "packages/importer/src/mysql.ts",
      `// openokr:allow-vendor-sdk: the FlowyTeam reader is the one approved importer dependency\nimport mysql from "openai";\n`,
    );
    expect(allowed).toEqual([]);

    const bare = check(
      "packages/importer/src/mysql.ts",
      `// openokr:allow-vendor-sdk:\nimport mysql from "openai";\n`,
    );
    expect(bare).toHaveLength(1);
  });
});

describe("driver import rule", () => {
  test("fails application code that imports a driver directly", () => {
    const violations = check(
      "apps/web/lib/mail.ts",
      `import { ConsoleMailer } from "@openokr/adapters/src/drivers/mail/console.ts";\n`,
    );
    expect(violations.some((v) => v.rule === "driver-import")).toBe(true);
  });

  test("allows importing the port surface", () => {
    expect(
      check(
        "apps/web/lib/mail.ts",
        `import type { Mailer } from "@openokr/adapters";\n`,
      ),
    ).toEqual([]);
  });

  test("allows drivers to import one another inside adapters", () => {
    expect(
      check(
        "packages/adapters/src/create-adapters.ts",
        `import { ConsoleMailer } from "./drivers/mail/console.ts";\n`,
      ),
    ).toEqual([]);
  });
});

describe("write path side effect rule", () => {
  test("fails a driver call on a write path", () => {
    const violations = check(
      "packages/core/src/operations/publish-goal.ts",
      `await jobs.enqueue("recompute.goal", { goalId });\n`,
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ rule: "write-path-side-effect" });
    expect(violations[0]?.message).toMatch(/outbox row/);
  });

  test("catches mail, channel and realtime side effects too", () => {
    expect(
      check("packages/core/src/a.ts", `await this.mailer.send(message);\n`),
    ).toHaveLength(1);
    expect(
      check(
        "packages/core/src/b.ts",
        `await adapters.channel.sendToChannel("#okr", m);\n`,
      ),
    ).toHaveLength(1);
    expect(
      check(
        "packages/core/src/c.ts",
        `await realtime.publish(channel, event);\n`,
      ),
    ).toHaveLength(1);
    expect(
      check(
        "packages/agents/src/champion.ts",
        `await jobs.schedule("nudge", cron);\n`,
      ),
    ).toHaveLength(1);
  });

  test("accepts the outbox path", () => {
    expect(
      check(
        "packages/core/src/operations/publish-goal.ts",
        `await enqueueOutbox(tx, { topic: "goal.published", payload, idempotencyKey });\n`,
      ),
    ).toEqual([]);
  });

  test("does not police packages that are not write paths", () => {
    expect(
      check(
        "packages/adapters/src/relay.ts",
        `await this.jobs.enqueue(name, payload);\n`,
      ),
    ).toEqual([]);
    expect(
      check("apps/web/lib/x.ts", `await jobs.enqueue(name, payload);\n`),
    ).toEqual([]);
  });

  test("honours a per-line allow marker that carries a reason", () => {
    expect(
      check(
        "packages/core/src/a.ts",
        `await cache.publish(k, v); // openokr:allow-side-effect: cache invalidation is not a durable side effect\n`,
      ),
    ).toEqual([]);
  });

  test("reports the offending line number", () => {
    const violations = check(
      "packages/core/src/a.ts",
      `const a = 1;\nconst b = 2;\nawait jobs.enqueue("x", {});\n`,
    );
    expect(violations[0]?.line).toBe(3);
  });
});

describe("checkBoundaries over several files", () => {
  test("reports every violation across the set", () => {
    const files: BoundarySourceFile[] = [
      { path: "packages/core/src/a.ts", text: `import "openai";\n` },
      {
        path: "packages/core/src/b.ts",
        text: `await jobs.enqueue("x", {});\n`,
      },
      { path: "packages/adapters/src/c.ts", text: `import "openai";\n` },
    ];
    const violations = checkBoundaries(files);
    expect(violations).toHaveLength(2);
    expect(violations.map((v) => v.path)).toEqual([
      "packages/core/src/a.ts",
      "packages/core/src/b.ts",
    ]);
  });
});
