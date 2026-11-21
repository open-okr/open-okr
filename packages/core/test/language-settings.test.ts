import { workerDb } from "@openokr/test-support/db";
import { beforeEach, expect, it, vi } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { writeSettings } from "../src/secrets/instance-settings.ts";
import { parseKeyRing } from "../src/secrets/key-ring.ts";
import { resolveMemberLanguage } from "../src/settings/member-language.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

// Indonesian is the last registry locale to ship (0.10.0 S19i). The refusal
// tests below need a registry code that is not shipped, so this file alone
// treats "id" as unshipped.
vi.mock("@openokr/formats", async (importOriginal) => {
  const formats = await importOriginal<typeof import("@openokr/formats")>();
  return {
    ...formats,
    SHIPPED_LOCALES: formats.SHIPPED_LOCALES.filter((code) => code !== "id"),
    isShippedLocale: (value: unknown) =>
      value !== "id" && formats.isShippedLocale(value),
  };
});

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

it("clears the workspace language to follow the instance", async () => {
  const call = await context();
  const { admin } = await workerDb();
  await admin.query(
    "insert into system_settings (key, value) values ('instance.language', '\"ms\"'::jsonb)",
  );

  await expect(
    callAction(call, "settings.updateWorkspaceGeneral", { language: null }),
  ).resolves.toMatchObject({ settings: { language: null } });
  expect(await resolveMemberLanguage(call, call.actor.memberId)).toBe("ms");
});

it.each(["xx", "id"])(
  "refuses the unshipped workspace locale %s",
  async (language) => {
    const call = await context();
    await expect(
      callAction(call, "settings.updateWorkspaceGeneral", { language }),
    ).rejects.toThrow();
  },
);

it.each(["xx", "id"])(
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
