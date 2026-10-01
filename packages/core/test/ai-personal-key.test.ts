import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { resolveAICredential } from "../src/ai/resolve.ts";
import {
  type KeyRing,
  newRootKey,
  parseKeyRing,
} from "../src/secrets/key-ring.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * A member's own AI key, from the account screen to the request it pays for
 * (completeness review M-36, P2-T14's acceptance).
 *
 * The three actions existed from P2-T14 and no screen called them, so the
 * acceptance "given a workspace key and a personal key, when the member runs
 * an assist, then their own key is used, and an admin cannot read it" could
 * not happen in the product. What is proved here is everything below the
 * screen, acting as people who joined the ordinary way rather than as rows
 * written by hand:
 *
 * - a member who holds `edit` stores, replaces and removes their own key, and
 *   every answer carries a masked hint and never the key;
 * - a malformed key is refused before anything is stored, and the refusal
 *   does not repeat it;
 * - the resolver finds the key by the signed-in account, which is all a
 *   background copilot run carries, and only for that person;
 * - an administrator reads neither the key nor its hint.
 */

const OWNER = "personal-key-owner";
const MEMBER = "personal-key-member";
const COLLEAGUE = "personal-key-colleague";

const OWN_KEY = "sk-ant-member-own-key-7Q4z";
const WORKSPACE_KEY = "sk-ant-workspace-key-9Xy2";

let workspaceId: string;
let ring: KeyRing;

const as = async (userId: string) => {
  const wb = await workerDb();
  return {
    pool: wb.appPool,
    workspaceId,
    actor: { kind: "human" as const, userId },
    ring,
  };
};

/** Somebody who joined through the workspace's own link, so holds `edit`. */
async function join(userId: string): Promise<string> {
  const wb = await workerDb();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [userId, userId, `${userId}@example.com`],
  );
  const link = await callAction(
    await as(OWNER),
    "invitations.createWorkspaceLink",
    {},
  );
  await callAction(await as(userId), "invitations.acceptLink", {
    token: link.token,
  });
  const rows = await wb.admin.query<{ id: string }>(
    `select id from workspace_members
      where workspace_id = $1 and user_id = $2 and deleted_at is null`,
    [workspaceId, userId],
  );
  const id = rows.rows[0]?.id;
  if (!id) {
    throw new Error(`${userId} did not join`);
  }
  return id;
}

/** Everything the pipeline wrote alongside the change, as text. */
async function everythingRecorded(): Promise<string> {
  const wb = await workerDb();
  const [audit, activity, outbox, stored] = await Promise.all([
    wb.admin.query("select payload::text as t from audit_events"),
    wb.admin.query("select payload::text as t from activities"),
    wb.admin.query("select payload::text as t from outbox"),
    wb.admin.query(
      "select ciphertext || data_key || key_hint as t from ai_credentials",
    ),
  ]);
  return [audit, activity, outbox, stored]
    .flatMap((result) => result.rows.map((row) => String(row.t)))
    .join("\n");
}

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "Owner", `${OWNER}@example.com`],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Owner",
  });
  workspaceId = provisioned.workspaceId;
  ring = parseKeyRing({ current: newRootKey() });

  // The acceptance's own starting point: a workspace key, and a provider an
  // administrator has opened to personal keys.
  await callAction(await as(OWNER), "ai.updateProviderConfig", {
    provider: "anthropic",
    enabled: true,
    allowUserKeys: true,
  });
  await callAction(await as(OWNER), "ai.setWorkspaceCredential", {
    provider: "anthropic",
    apiKey: WORKSPACE_KEY,
  });
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("storing a key of your own", () => {
  it("is open to a member who holds edit, and answers with the hint alone", async () => {
    const memberId = await join(MEMBER);
    const stored = await callAction(
      await as(MEMBER),
      "ai.setPersonalCredential",
      { provider: "anthropic", apiKey: OWN_KEY },
    );

    expect(stored).toEqual({
      provider: "anthropic",
      keyHint: "••••7Q4z",
      status: "unverified",
    });
    expect(JSON.stringify(stored)).not.toContain(OWN_KEY);

    // Stored against this member and sealed, and nothing the pipeline wrote
    // beside it (the audit row, the activity, the outbox) carries it either.
    const wb = await workerDb();
    const rows = await wb.admin.query<{ owner_member_id: string }>(
      "select owner_member_id from ai_credentials where owner_member_id is not null",
    );
    expect(rows.rows).toEqual([{ owner_member_id: memberId }]);
    expect(await everythingRecorded()).not.toContain(OWN_KEY);
  });

  it("trims what a dashboard copy carries around it", async () => {
    await join(MEMBER);
    const stored = await callAction(
      await as(MEMBER),
      "ai.setPersonalCredential",
      { provider: "anthropic", apiKey: `  ${OWN_KEY}\n` },
    );
    expect(stored.keyHint).toBe("••••7Q4z");
    expect(
      await resolveAICredential(
        (await workerDb()).appPool,
        ring,
        {},
        {
          workspaceId,
          provider: "anthropic",
          userId: MEMBER,
        },
      ),
    ).toMatchObject({ source: "user", apiKey: OWN_KEY });
  });

  it.each([
    ["a space inside it", "sk-ant-part one"],
    ["a line break inside it", "sk-ant-part\none"],
    ["the quotes a word processor adds", "“sk-ant-quoted”"],
    ["nothing at all", "   "],
    ["a pasted document", `sk-${"x".repeat(5000)}`],
  ])(
    "refuses a key with %s, stores nothing and does not repeat it",
    async (_label, malformed) => {
      await join(MEMBER);
      const refusal = await callAction(
        await as(MEMBER),
        "ai.setPersonalCredential",
        { provider: "anthropic", apiKey: malformed },
      ).then(
        () => null,
        (error: unknown) => error,
      );

      expect(refusal).toBeInstanceOf(Error);
      const words = malformed.trim();
      if (words !== "") {
        expect(String((refusal as Error).message)).not.toContain(words);
      }
      const own = await callAction(
        await as(MEMBER),
        "ai.readOwnCredentialStatus",
        {},
      );
      expect(own[0]?.hasPersonalCredential).toBe(false);
    },
  );

  it("replaces the key in place, so there is one per provider", async () => {
    await join(MEMBER);
    const member = await as(MEMBER);
    await callAction(member, "ai.setPersonalCredential", {
      provider: "anthropic",
      apiKey: OWN_KEY,
    });
    await callAction(member, "ai.setPersonalCredential", {
      provider: "anthropic",
      apiKey: "sk-ant-replacement-kE3w",
    });

    const own = await callAction(member, "ai.readOwnCredentialStatus", {});
    expect(own).toHaveLength(1);
    expect(own[0]?.keyHint).toBe("••••kE3w");
    const wb = await workerDb();
    const rows = await wb.admin.query(
      "select 1 from ai_credentials where owner_member_id is not null and deleted_at is null",
    );
    expect(rows.rowCount).toBe(1);
  });

  it("is refused where the provider takes no personal key", async () => {
    await join(MEMBER);
    await callAction(await as(OWNER), "ai.updateProviderConfig", {
      provider: "anthropic",
      allowUserKeys: false,
    });
    await expect(
      callAction(await as(MEMBER), "ai.setPersonalCredential", {
        provider: "anthropic",
        apiKey: OWN_KEY,
      }),
    ).rejects.toMatchObject({ code: "not_found" });
    // And the screen is told there is nothing to offer, rather than a slot.
    expect(
      await callAction(await as(MEMBER), "ai.readOwnCredentialStatus", {}),
    ).toEqual([]);
  });
});

describe("reading your own key back", () => {
  it("says it is set, with its hint, its status and when, and never the key", async () => {
    await join(MEMBER);
    const before = Date.now();
    await callAction(await as(MEMBER), "ai.setPersonalCredential", {
      provider: "anthropic",
      apiKey: OWN_KEY,
    });

    const own = await callAction(
      await as(MEMBER),
      "ai.readOwnCredentialStatus",
      {},
    );
    expect(own).toEqual([
      {
        provider: "anthropic",
        allowUserKeys: true,
        hasPersonalCredential: true,
        keyHint: "••••7Q4z",
        status: "unverified",
        setAt: expect.any(String),
      },
    ]);
    expect(Date.parse(own[0]?.setAt ?? "")).toBeGreaterThanOrEqual(
      before - 5_000,
    );
    expect(JSON.stringify(own)).not.toContain(OWN_KEY);
  });

  it("offers an empty slot to a member who has stored nothing", async () => {
    await join(MEMBER);
    expect(
      await callAction(await as(MEMBER), "ai.readOwnCredentialStatus", {}),
    ).toEqual([
      {
        provider: "anthropic",
        allowUserKeys: true,
        hasPersonalCredential: false,
        keyHint: null,
        status: null,
        setAt: null,
      },
    ]);
  });
});

describe("removing it", () => {
  it("takes it away, and the member's requests use the workspace key again", async () => {
    await join(MEMBER);
    const member = await as(MEMBER);
    await callAction(member, "ai.setPersonalCredential", {
      provider: "anthropic",
      apiKey: OWN_KEY,
    });
    await callAction(member, "ai.removePersonalCredential", {
      provider: "anthropic",
    });

    const own = await callAction(member, "ai.readOwnCredentialStatus", {});
    expect(own[0]?.hasPersonalCredential).toBe(false);
    expect(
      await resolveAICredential(
        (await workerDb()).appPool,
        ring,
        {},
        {
          workspaceId,
          provider: "anthropic",
          userId: MEMBER,
        },
      ),
    ).toMatchObject({ source: "workspace", apiKey: WORKSPACE_KEY });
  });

  it("says so when there was nothing to remove", async () => {
    await join(MEMBER);
    await expect(
      callAction(await as(MEMBER), "ai.removePersonalCredential", {
        provider: "anthropic",
      }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("removes only the caller's own, whoever else holds one", async () => {
    await join(MEMBER);
    await join(COLLEAGUE);
    await callAction(await as(MEMBER), "ai.setPersonalCredential", {
      provider: "anthropic",
      apiKey: OWN_KEY,
    });
    // There is no member id to pass, so the colleague's attempt can only
    // reach the colleague's own, which does not exist.
    await expect(
      callAction(await as(COLLEAGUE), "ai.removePersonalCredential", {
        provider: "anthropic",
      }),
    ).rejects.toMatchObject({ code: "not_found" });
    const own = await callAction(
      await as(MEMBER),
      "ai.readOwnCredentialStatus",
      {},
    );
    expect(own[0]?.hasPersonalCredential).toBe(true);
  });
});

describe("whose key a request uses", () => {
  it("is the asker's own, found by their account, and the workspace's for everyone else", async () => {
    await join(MEMBER);
    await join(COLLEAGUE);
    await callAction(await as(MEMBER), "ai.setPersonalCredential", {
      provider: "anthropic",
      apiKey: OWN_KEY,
    });
    const pool = (await workerDb()).appPool;
    const resolve = (userId?: string) =>
      resolveAICredential(
        pool,
        ring,
        {},
        {
          workspaceId,
          provider: "anthropic",
          ...(userId ? { userId } : {}),
        },
      );

    expect(await resolve(MEMBER)).toMatchObject({
      source: "user",
      apiKey: OWN_KEY,
    });
    // A colleague, the administrator, and a request nobody asked for (an
    // agent run, the scheduler) all get the workspace's.
    for (const other of [COLLEAGUE, OWNER, undefined]) {
      expect(await resolve(other)).toMatchObject({
        source: "workspace",
        apiKey: WORKSPACE_KEY,
      });
    }
  });

  it("is the workspace's once the member is suspended", async () => {
    const memberId = await join(MEMBER);
    await callAction(await as(MEMBER), "ai.setPersonalCredential", {
      provider: "anthropic",
      apiKey: OWN_KEY,
    });
    await callAction(await as(OWNER), "people.suspend", { memberId });

    expect(
      await resolveAICredential(
        (await workerDb()).appPool,
        ring,
        {},
        {
          workspaceId,
          provider: "anthropic",
          userId: MEMBER,
        },
      ),
    ).toMatchObject({ source: "workspace", apiKey: WORKSPACE_KEY });
  });

  it("makes the assist available to its owner alone where the workspace holds no key", async () => {
    await join(MEMBER);
    await join(COLLEAGUE);
    await callAction(await as(OWNER), "ai.removeWorkspaceCredential", {
      provider: "anthropic",
    });
    await callAction(await as(MEMBER), "ai.setPersonalCredential", {
      provider: "anthropic",
      apiKey: OWN_KEY,
    });

    expect(
      await callAction(await as(MEMBER), "ai.readAvailability", {}),
    ).toEqual({ available: true });
    expect(
      await callAction(await as(COLLEAGUE), "ai.readAvailability", {}),
    ).toEqual({ available: false });
  });
});

describe("an administrator", () => {
  it("reads neither the key nor its hint, through any read they hold", async () => {
    await join(MEMBER);
    await callAction(await as(MEMBER), "ai.setPersonalCredential", {
      provider: "anthropic",
      apiKey: OWN_KEY,
    });
    const admin = await as(OWNER);

    const config = await callAction(admin, "ai.readProviderConfig", {});
    // Their own status read is theirs: an empty slot, not the member's key.
    const ownStatus = await callAction(admin, "ai.readOwnCredentialStatus", {});
    expect(ownStatus[0]?.hasPersonalCredential).toBe(false);

    const everything = JSON.stringify([config, ownStatus]);
    expect(everything).not.toContain(OWN_KEY);
    expect(everything).not.toContain("7Q4z");
  });
});
