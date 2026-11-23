import { workerDb } from "@openokr/test-support/db";
import { expect, it } from "vitest";

it("stores a new member language and refuses a code outside the registry", async () => {
  const { admin } = await workerDb();
  const workspace = await admin.query<{ id: string }>(
    "insert into workspaces (id, name, slug) values (gen_random_uuid(), 'Languages', 'languages-test') returning id",
  );
  const insertMember = (language: string) =>
    admin.query<{ language: string }>(
      "insert into workspace_members (id, workspace_id, name, language) values (gen_random_uuid(), $1, 'Member', $2) returning language",
      [workspace.rows[0]?.id, language],
    );

  await expect(insertMember("zh-Hans")).resolves.toMatchObject({
    rows: [{ language: "zh-Hans" }],
  });
  await expect(insertMember("xx")).rejects.toMatchObject({
    code: "23514",
    constraint: "workspace_members_language_known",
  });
});
