import { withWorkspace } from "@openokr/db";
import { workerDb } from "@openokr/test-support/db";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { getOrCreateNotificationSettings } from "../src/notifications/settings.ts";
import {
  resolveMemberNotificationSettings,
  SETTINGS_REGISTRY,
} from "../src/settings/registry.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * The member half of the settings map (TECHNICAL-PLAN §4.14, P6-G08).
 *
 * **It was storage with no way in.** Per-reason routing, the batching window,
 * the daily summary and its time have been in `notification_settings` since
 * P2-T06, read by `notifyRecipients` on every fan-out and by the Champion's
 * daily run since P4-T05b. Nothing could see any of it and nothing could write
 * the routing at all: `notifications.updateSettings` took four fields and the
 * routing was not one of them. The gap audit recorded it under B-06, and
 * `/account/channels` covered the primary channel and quiet hours only.
 *
 * **The defaults are enumerated from the registry, not from a list here.** Two
 * homes for one default is one default that will drift, and the whole point of
 * §4.14 is that a member who has never opened the screen is already correctly
 * configured. This is the test that fails when the registry and the table's
 * own column defaults disagree.
 */

const OWNER = "member-settings-owner";

let workspaceId: string;
let ownerMemberId: string;

function context(userId: string) {
  return { workspaceId, actor: { kind: "human" as const, userId } };
}

async function pool() {
  return (await workerDb()).appPool;
}

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "Settings Owner", "member-settings@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Settings Owner",
  });
  workspaceId = provisioned.workspaceId;
  ownerMemberId = provisioned.memberId;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("the member scope of the settings registry", () => {
  it("declares every notification preference the plan documents", () => {
    const keys = SETTINGS_REGISTRY.filter(
      (setting) => setting.home === "notification_settings",
    ).map((setting) => setting.key);
    expect(keys.slice().sort()).toEqual(
      [
        "batchWindowMinutes",
        "dailySummary",
        "dailySummaryTime",
        "mentionImmediate",
        "routing",
      ].sort(),
    );
  });

  it("agrees with the table's own defaults for a member with no row", async () => {
    // The invariant. `notification_settings` is created lazily, so its column
    // defaults are what a fresh member actually gets, and the registry is what
    // §4.14 says they get. Enumerated, so a sixth preference added to either
    // side without the other fails here.
    const wb = await workerDb();
    const stored = await withWorkspace(drizzle(wb.appPool), workspaceId, (tx) =>
      getOrCreateNotificationSettings(tx, workspaceId, ownerMemberId),
    );
    const declared = resolveMemberNotificationSettings({});

    const disagreements: string[] = [];
    for (const [key, expected] of Object.entries(declared)) {
      const actual = (stored as unknown as Record<string, unknown>)[key];
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        disagreements.push(
          `${key}: table has ${JSON.stringify(actual)}, registry says ${JSON.stringify(expected)}`,
        );
      }
    }
    expect(disagreements).toEqual([]);
  });

  it("keeps the notification keys out of the member columns", () => {
    // `resolveMemberSettings` is written into `workspace_members` at
    // provisioning. A notification key reaching it would be an insert naming a
    // column that does not exist, which is why the filter is on the home and
    // not on the scope.
    const columnKeys = SETTINGS_REGISTRY.filter(
      (setting) => setting.home === "workspace_members",
    ).map((setting) => setting.key);
    // Enumerated rather than derived, so a key given this home without a
    // column to land in fails here. `theme` and `density` joined the list at
    // P6-G23 with migration 0077, and `language` at P6-G22a with 0078. It has
    // caught both, which is the argument for the list being written out.
    expect(columnKeys.slice().sort()).toEqual([
      "density",
      "language",
      "primaryChannel",
      "quietHours",
      "theme",
    ]);
  });

  it("gives every setting a home", () => {
    const homeless = SETTINGS_REGISTRY.filter(
      (setting) => setting.home === undefined,
    ).map((setting) => setting.key);
    expect(homeless).toEqual([]);
  });
});

describe("notifications.getSettings", () => {
  it("answers a member who has never opened the screen", async () => {
    const settings = await callAction(
      { pool: await pool(), ...context(OWNER) },
      "notifications.getSettings",
      {},
    );
    expect(settings.mentionImmediate).toBe(true);
    expect(settings.batchWindowMinutes).toBe(30);
    expect(settings.dailySummary).toBe(true);
    expect(settings.dailySummaryTime).toBe("08:00");
    expect(settings.routing).toEqual({});
  });
});

describe("notifications.updateSettings", () => {
  it("stores a per-reason override and reads it back", async () => {
    await callAction(
      { pool: await pool(), ...context(OWNER) },
      "notifications.updateSettings",
      { routing: { review: "email", mentioned: "app" } },
    );

    const settings = await callAction(
      { pool: await pool(), ...context(OWNER) },
      "notifications.getSettings",
      {},
    );
    expect(settings.routing).toEqual({ review: "email", mentioned: "app" });
  });

  it("removes an override by sending the map without it", async () => {
    // The whole map rather than one entry, so removal needs no second verb.
    await callAction(
      { pool: await pool(), ...context(OWNER) },
      "notifications.updateSettings",
      { routing: { review: "email", joined: "email" } },
    );
    await callAction(
      { pool: await pool(), ...context(OWNER) },
      "notifications.updateSettings",
      { routing: { review: "email" } },
    );

    const settings = await callAction(
      { pool: await pool(), ...context(OWNER) },
      "notifications.getSettings",
      {},
    );
    expect(settings.routing).toEqual({ review: "email" });
  });

  it("moves the batch window, and refuses one that is not a window", async () => {
    const updated = await callAction(
      { pool: await pool(), ...context(OWNER) },
      "notifications.updateSettings",
      { batchWindowMinutes: 10 },
    );
    expect(updated.batchWindowMinutes).toBe(10);

    // A million minutes is a member who never hears from the product again.
    // The input took any positive integer until P6-G08.
    await expect(
      callAction(
        { pool: await pool(), ...context(OWNER) },
        "notifications.updateSettings",
        { batchWindowMinutes: 1_000_000 },
      ),
    ).rejects.toThrow();
  });

  it("moves the summary time, which is what moves when it fires", async () => {
    const updated = await callAction(
      { pool: await pool(), ...context(OWNER) },
      "notifications.updateSettings",
      { dailySummaryTime: "17:30" },
    );
    expect(updated.dailySummaryTime).toBe("17:30");

    // Not a time.
    await expect(
      callAction(
        { pool: await pool(), ...context(OWNER) },
        "notifications.updateSettings",
        { dailySummaryTime: "25:00" },
      ),
    ).rejects.toThrow();
  });
});
