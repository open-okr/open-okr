import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { parseKeyRing } from "../src/secrets/key-ring.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * A member's own delivery preferences (P5-T02c).
 *
 * `people.updateOwnProfile` grew two fields, and this is the test that says the
 * write lands. It exists because the browser spec asserted the saved value came
 * back and got the seeded default instead, which is the shape of a write that
 * silently did nothing.
 */

const OWNER = "delivery-own";
let workspaceId: string;

const ring = parseKeyRing({
  current: "5UB2Ez1oQ0Rr8sT1n5x7yWl4qKcM9vHfJbGdApXeZi0=",
});

const context = () => ({
  workspaceId,
  actor: { kind: "human" as const, userId: OWNER },
  ring,
});

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "Owner", "delivery-own@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Owner",
  });
  workspaceId = provisioned.workspaceId;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

it("saves a primary channel and a quiet window, and reads them back", async () => {
  const wb = await workerDb();
  await callAction(
    { pool: wb.appPool, ...context() },
    "people.updateOwnProfile",
    { primaryChannel: "app", quietHours: { start: "22:00", end: "07:00" } },
  );

  const settings = await callAction(
    { pool: wb.appPool, ...context() },
    "channels.mySettings",
    {},
  );
  expect(settings.primaryChannel).toBe("app");
  expect(settings.quietHours).toEqual({ start: "22:00", end: "07:00" });
});

it("refuses a time that is not a time", async () => {
  const wb = await workerDb();
  // The regex lost its backslashes when this schema was first written, so it
  // matched the literal letter d and refused every real time. The browser spec
  // saw only a saved value that never changed, which is the shape of a write
  // that silently did nothing; this is the test that names the cause.
  await expect(
    callAction({ pool: wb.appPool, ...context() }, "people.updateOwnProfile", {
      quietHours: { start: "half past ten", end: "07:00" },
    }),
  ).rejects.toThrow();
});

it("clears the window with null rather than storing two equal times", async () => {
  const wb = await workerDb();
  await callAction(
    { pool: wb.appPool, ...context() },
    "people.updateOwnProfile",
    { quietHours: null },
  );
  const settings = await callAction(
    { pool: wb.appPool, ...context() },
    "channels.mySettings",
    {},
  );
  expect(settings.quietHours).toBeNull();
});

it("stops offering a provider to link once it is disconnected", async () => {
  const wb = await workerDb();
  await callAction({ pool: wb.appPool, ...context() }, "channels.connect", {
    provider: "slack",
    credentials: JSON.stringify({ botToken: "b", signingSecret: "s" }),
    config: { teamId: "T-own" },
  });
  expect(
    (
      await callAction(
        { pool: wb.appPool, ...context() },
        "channels.mySettings",
        {},
      )
    ).connected,
  ).toEqual(["slack"]);

  await callAction({ pool: wb.appPool, ...context() }, "channels.disconnect", {
    provider: "slack",
  });

  // Nothing for a member to link, which is what the account page reads to
  // decide whether to offer the option at all.
  expect(
    (
      await callAction(
        { pool: wb.appPool, ...context() },
        "channels.mySettings",
        {},
      )
    ).connected,
  ).toEqual([]);
});
