import { workerDb } from "@openokr/test-support/db";
import { beforeEach, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { writeSettings } from "../src/secrets/instance-settings.ts";
import { parseKeyRing } from "../src/secrets/key-ring.ts";
import { resolveMemberLanguage } from "../src/settings/member-language.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

const owner = { id: "language-owner", name: "Language Owner" };

async function context() {
  const { admin, appPool } = await workerDb();
  await admin.query(
    "insert into users (id, name, email) values ($1, $2, 'language-owner@example.com')",
    [owner.id, owner.name],
  );
  const { workspaceId, memberId } = await provisionWorkspaceForUser(
    appPool,
    owner,
  );
  return {
    pool: appPool,
    workspaceId,
    actor: { kind: "human" as const, userId: owner.id, memberId },
  };
}

beforeEach(async () => {
  await (await workerDb()).truncateAllTables();
});

it("skips an unavailable workspace language and preserves it when another setting is saved", async () => {
  const call = await context();
  const { admin } = await workerDb();
  await admin.query(
    'update workspaces set settings = settings || \'{"language":"xx"}\'::jsonb where id = $1',
    [call.workspaceId],
  );
  await admin.query(
    "insert into system_settings (key, value) values ('instance.language', '\"ms\"'::jsonb)",
  );

  expect(await resolveMemberLanguage(call, call.actor.memberId)).toBe("ms");
  await expect(
    callAction(call, "settings.updateWorkspaceGeneral", {
      timezone: "Asia/Kuala_Lumpur",
    }),
  ).resolves.toMatchObject({
    settings: { language: "xx", timezone: "Asia/Kuala_Lumpur" },
  });
});

it.each(["xx", "zh-Hans"])(
  "refuses the unshipped workspace locale %s",
  async (language) => {
    const call = await context();
    await expect(
      callAction(call, "settings.updateWorkspaceGeneral", { language }),
    ).rejects.toThrow();
  },
);

it.each(["xx", "zh-Hans"])(
  "refuses the unshipped instance locale %s",
  async (language) => {
    const { appPool } = await workerDb();
    const ring = parseKeyRing({
      current: Buffer.alloc(32, 1).toString("base64"),
    });
    await expect(
      writeSettings(appPool, ring, [
        { key: "instance.language", value: language },
      ]),
    ).rejects.toThrow();
  },
);
