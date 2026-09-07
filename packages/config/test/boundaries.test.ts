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

  test("allows the delivery side of the outbox to call out (P5-T01a)", () => {
    // The handler runs after the row committed and after the relay claimed it.
    // Reaching a driver there is the point, not a leak.
    expect(
      check(
        "packages/core/src/outbox/handlers.ts",
        `await deps.publish(channel, delivery.topic, data);
`,
      ),
    ).toEqual([]);
    expect(
      check(
        "apps/web/lib/relay.ts",
        `await mailerFrom(mail).send(message);
`,
      ),
    ).toEqual([]);
  });

  test("the delivery exemption is the directory, not the word outbox", () => {
    // An action that happens to sit near the outbox is still a write path.
    expect(
      check(
        "packages/core/src/actions/invitations.ts",
        `await mailer.send(message);
`,
      ),
    ).toHaveLength(1);
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
    // The relay's whole job is to call the driver, after the transaction that
    // wrote the outbox row has committed. `apps` used to be listed here too,
    // which is what let a direct send sit in a server action unnoticed. It is
    // a write path, and it is covered below.
    expect(
      check(
        "packages/adapters/src/relay.ts",
        `await this.jobs.enqueue(name, payload);\n`,
      ),
    ).toEqual([]);
    expect(
      check("packages/method/src/score.ts", `await thing.send(payload);\n`),
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

describe("the mutation rule: writes go through the Operation pipeline", () => {
  const MUTATION = `await tx.update(workspaces).set({ name }).where(eq(workspaces.id, id));\n`;

  test("fails a drizzle mutation in application code that never runs an operation", () => {
    const violations = check(
      "packages/core/src/workspaces/rename.ts",
      MUTATION,
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.rule).toBe("mutation-outside-operation");
    expect(violations[0]?.message).toMatch(/Operation pipeline/);
  });

  test("allows a mutation in a file that runs the pipeline", () => {
    // This is what an action handler looks like: the write is one statement
    // inside the operation spec the pipeline executes.
    const text = `import { runOperation } from "../operations/operation.ts";\nrunOperation(deps, { execute: async ({ tx }) => {\n${MUTATION}} });\n`;
    expect(check("packages/core/src/actions/workspace.ts", text)).toEqual([]);
  });

  test("allows the database package, which implements the primitives", () => {
    expect(check("packages/db/src/outbox.ts", MUTATION)).toEqual([]);
  });

  test("allows the pipeline itself to write the audit and activity rows", () => {
    expect(
      check("packages/core/src/operations/operation.ts", MUTATION),
    ).toEqual([]);
  });

  test("catches insert and delete as well as update", () => {
    expect(
      check(
        "packages/core/src/x.ts",
        `await tx.insert(activities).values(a);\n`,
      ),
    ).toHaveLength(1);
    expect(
      check("packages/core/src/x.ts", `await tx.delete(goals).where(w);\n`),
    ).toHaveLength(1);
  });

  test("ignores array and string methods that share those names", () => {
    // `.delete(` on a Map or Set, and `.insert(` on an editor, are not writes.
    const text = `seen.delete(key);\nconst next = list.insert(0, item);\neditor.update(state);\n`;
    expect(check("packages/core/src/x.ts", text)).toEqual([]);
  });

  test("takes an explicit marker with a reason", () => {
    const text = `// openokr:allow-mutation: the migration runner owns its own bookkeeping table\nawait tx.insert(migrations).values(row);\n`;
    expect(check("packages/core/src/x.ts", text)).toEqual([]);
  });

  test("refuses a marker with no reason", () => {
    const text = `// openokr:allow-mutation:\nawait tx.insert(migrations).values(row);\n`;
    expect(check("packages/core/src/x.ts", text)).toHaveLength(1);
  });

  test("takes a marker anywhere in the comment block above the write", () => {
    // A reason worth writing rarely fits on one line, and a marker that
    // forces it to is a marker people work around rather than explain.
    const text = [
      "function save() {",
      "  // openokr:allow-mutation: instance settings are not workspace data,",
      "  // so there is no workspace whose audit chain this could join.",
      "  // The pipeline needs both, and the wizard has neither.",
      "  await tx.insert(settings).values(row);",
      "}",
    ].join("\n");
    expect(check("packages/core/src/x.ts", text)).toEqual([]);
  });

  test("reports one write once, however many lines it spans", () => {
    // Both mutation patterns match this: one on `await tx`, the other on the
    // `.insert(...)` below it. An operator fixing one finding should not see
    // the same write reported twice.
    const text = [
      "async function save() {",
      "  await tx",
      "    .insert(settings)",
      "    .values(row)",
      "    .onConflictDoUpdate({ target: settings.key, set: row });",
      "}",
    ].join("\n");
    expect(check("packages/core/src/x.ts", text)).toHaveLength(1);
  });

  test("escapes a multi-line write with a multi-line reason", () => {
    const text = [
      "async function save() {",
      "  // openokr:allow-mutation: the wizard writes before any workspace",
      "  // exists, so there is no chain to append to.",
      "  await tx",
      "    .insert(settings)",
      "    .values(row)",
      "    .onConflictDoUpdate({ target: settings.key, set: row });",
      "}",
    ].join("\n");
    expect(check("packages/core/src/x.ts", text)).toEqual([]);
  });

  test("leaves the adapters package alone, which has no domain writes", () => {
    expect(check("packages/adapters/src/drivers/cache.ts", MUTATION)).toEqual(
      [],
    );
  });
});

describe("the mutation rule recognises the registry builder", () => {
  const MUTATION = `await tx.update(workspaces).set({ name }).where(eq(workspaces.id, id));\n`;

  test("allows a write declared with defineWriteAction", () => {
    // A registry write action never names runOperation itself: the builder
    // takes its operation spec and runs it. Requiring the literal call here
    // would push every action file into an escape marker, which is how a lint
    // stops being read.
    const text = `import { defineWriteAction } from "./define.ts";\nexport const rename = defineWriteAction({ operation: () => ({ execute: async ({ tx }) => {\n${MUTATION}} }) });\n`;
    expect(check("packages/core/src/actions/workspace.ts", text)).toEqual([]);
  });

  test("still fails an action file that only pretends to be one", () => {
    const text = `export const rename = { async handler() {\n${MUTATION}} };\n`;
    expect(check("packages/core/src/actions/workspace.ts", text)).toHaveLength(
      1,
    );
  });
});

/**
 * Three ways a Phase 2 write could slip past this gate. Phase 2 multiplies
 * the number of write handlers and moves a lot of them into server actions, so
 * these are the shapes worth closing before that happens rather than after.
 */
describe("gaps the gate used to allow", () => {
  const MUTATION = `await tx.update(workspaces).set({ name }).where(eq(workspaces.id, id));\n`;

  test("watches side effects in the application as well as the packages", () => {
    // Server actions are write paths. P2-T04 and P2-T06 add invitation and
    // notification sends here, and the outbox rule has to reach them.
    const violations = check(
      "apps/web/app/goals/actions.ts",
      `await jobs.enqueue("notify.member", { memberId });\n`,
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.rule).toBe("write-path-side-effect");
  });

  test("does not exempt a whole file because one operation appears in it", () => {
    // A handler file that declares an operation and also writes outside it:
    // the second write commits with no audit row, and the file-level exemption
    // used to wave it through.
    const text = [
      `import { runOperation } from "../operations/operation.ts";`,
      `export const rename = () => runOperation(deps, {`,
      `  execute: async ({ tx }) => {`,
      `    ${MUTATION.trim()}`,
      `  },`,
      `});`,
      `export const sneak = async (tx) => {`,
      `  ${MUTATION.trim()}`,
      `};`,
      ``,
    ].join("\n");

    const violations = check("packages/core/src/actions/workspace.ts", text);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.rule).toBe("mutation-outside-operation");
    // The write inside the operation is fine; the one after it is not.
    expect(violations[0]?.line).toBeGreaterThan(6);
  });

  test("sees a raw SQL write, not only a drizzle builder", () => {
    // `tx.execute(sql`update ...`)` is the obvious way around a lint that only
    // knows Drizzle's builders.
    // Assembled rather than written inline: the fixture is a template literal
    // containing a placeholder, and a lint that reads it as this file's own
    // placeholder is right to complain.
    const text = `await tx.execute(sql\`update workspaces set name = $\{name}\`);\n`;
    const violations = check("packages/core/src/workspaces/rename.ts", text);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.rule).toBe("mutation-outside-operation");
  });

  test("sees a raw SQL write through a client query too", () => {
    const text = `await client.query("insert into workspaces (id) values ($1)", [id]);\n`;
    const violations = check("packages/core/src/workspaces/create.ts", text);
    expect(violations).toHaveLength(1);
  });

  test("leaves a raw SQL read alone", () => {
    const text = "const rows = await tx.execute(sql`select 1`);\n";
    expect(check("packages/core/src/workspaces/read.ts", text)).toEqual([]);
  });
});

describe("side effects reached through a call expression", () => {
  test("catches a send on the result of a factory call", () => {
    // `mailerFrom(settings).send(...)` has no word receiver, so a pattern
    // anchored on an identifier read straight past it. That is how the one
    // direct mail send in the application stayed invisible to this gate.
    const violations = check(
      "apps/web/lib/mail.ts",
      `await mailerFrom(settings).send(message);\n`,
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.rule).toBe("write-path-side-effect");
  });

  test("still lets an outbox helper through", () => {
    expect(
      check(
        "packages/core/src/x.ts",
        `await outboxFor(tx).enqueue("mail.send", payload);\n`,
      ),
    ).toEqual([]);
  });
});

describe("protected-read rule (P2-T02)", () => {
  const READ = `const rows = await tx.select().from(workspaces).where(eq(workspaces.id, id));\n`;

  test("fails a raw read of a protected table in an action file", () => {
    const violations = check("packages/core/src/actions/overview.ts", READ);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      rule: "protected-read-outside-getter",
    });
  });

  test("fails the same read in an app server component", () => {
    expect(check("apps/web/app/dashboard/page.tsx", READ)).toHaveLength(1);
  });

  test("allows the read inside the getter's own module", () => {
    expect(check("packages/core/src/access/reads.ts", READ)).toEqual([]);
  });

  test("allows the read inside packages/db, which implements the tables", () => {
    expect(check("packages/db/src/schema/workspaces.ts", READ)).toEqual([]);
  });

  test("allows the read inside the Operation pipeline itself", () => {
    expect(check("packages/core/src/operations/operation.ts", READ)).toEqual(
      [],
    );
  });

  test("allows the read inside a defineWriteAction operation, which authorises before it runs", () => {
    const text = `import { defineWriteAction } from "./define.ts";\nexport const rename = defineWriteAction({ operation: () => ({ load: async ({ tx }) => {\n${READ}} }) });\n`;
    expect(check("packages/core/src/actions/workspace.ts", text)).toEqual([]);
  });

  test("an escape marker with a reason silences one read", () => {
    const text = `// openokr:allow-raw-read: access already confirmed above; this loads display fields only\n${READ}`;
    expect(check("packages/core/src/actions/overview.ts", text)).toEqual([]);
  });

  test("the marker still works when a multi-line select precedes .from", () => {
    // Reproduces the real shape in overview.ts: a `.select({ ... })` object
    // argument spanning several lines sits between the statement's own start
    // and `.from(...)`. `statementStartLine` cannot be reused here — it stops
    // at the closing brace of that object, which lands it back on the `.from`
    // line itself — so the marker has to sit directly above `.from`, not
    // above the statement.
    const multiLine = `const rows = await tx\n  .select({ id: workspaces.id, name: workspaces.name })\n  .from(workspaces)\n  .where(eq(workspaces.id, id));\n`;
    expect(
      check("packages/core/src/actions/overview.ts", multiLine),
    ).toHaveLength(1);

    const withMarker = `const rows = await tx\n  .select({ id: workspaces.id, name: workspaces.name })\n  // openokr:allow-raw-read: access already confirmed above\n  .from(workspaces)\n  .where(eq(workspaces.id, id));\n`;
    expect(check("packages/core/src/actions/overview.ts", withMarker)).toEqual(
      [],
    );
  });

  test("does not flag reads of a table that is not on the protected list", () => {
    expect(
      check(
        "packages/core/src/actions/overview.ts",
        `await tx.select().from(workspaceMembers);\n`,
      ),
    ).toEqual([]);
  });
});
