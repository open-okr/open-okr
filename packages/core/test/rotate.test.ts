import {
  aiCredentials,
  channelConnections,
  includeDeleted,
  ssoConnections,
  withWorkspace,
} from "@openokr/db";
import { workerDb } from "@openokr/test-support/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { readSecret, writeSettings } from "../src/secrets/instance-settings.ts";
import {
  decryptSecret,
  encryptSecret,
  KeyRingError,
  newRootKey,
  parseKeyRing,
} from "../src/secrets/key-ring.ts";
import { rotateInstanceSecrets } from "../src/secrets/rotate.ts";
import { createWorkspace } from "../src/workspaces/provisioning.ts";

/**
 * Root key rotation against real stored secrets.
 *
 * The property that matters is that no secret becomes unreadable. A rotation
 * that loses one credential has lost it permanently, so this exercises the
 * interrupted case as well as the clean one.
 */

const FIRST = newRootKey();
const SECOND = newRootKey();

const oldRing = parseKeyRing({ current: FIRST });
const rotatingRing = parseKeyRing({ current: SECOND, previous: [FIRST] });
const newRingOnly = parseKeyRing({ current: SECOND });

beforeEach(async () => {
  const wb = await workerDb();
  // Every table, not only the settings: rotation reads the workspace tables
  // too, and a credential another suite sealed under its own key would be a
  // secret this ring cannot open.
  await wb.truncateAllTables();
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

const seed = async () => {
  const wb = await workerDb();
  await writeSettings(wb.appPool, oldRing, [
    { key: "mail.password", secret: "smtp-secret" },
    { key: "ai.key", secret: "provider-secret" },
    { key: "instance.name", value: "Acme" },
  ]);
  return wb;
};

describe("rotating", () => {
  it("re-wraps every sealed secret and leaves plain settings alone", async () => {
    const wb = await seed();
    const report = await rotateInstanceSecrets(wb.appPool, rotatingRing);

    expect(report.examined).toBe(2);
    expect(report.rewrapped).toBe(2);
    expect(report.current).toBe(0);
  });

  it("leaves every secret readable under the new key alone", async () => {
    // The point of the whole exercise: once rotation finishes, the old key can
    // be thrown away.
    const wb = await seed();
    await rotateInstanceSecrets(wb.appPool, rotatingRing);

    expect(await readSecret(wb.appPool, newRingOnly, "mail.password")).toBe(
      "smtp-secret",
    );
    expect(await readSecret(wb.appPool, newRingOnly, "ai.key")).toBe(
      "provider-secret",
    );
  });

  it("does not change the secret's own ciphertext", async () => {
    // Rotation re-wraps data keys only. Rewriting ciphertext would mean
    // decrypting every credential, which is exactly what envelope encryption
    // exists to avoid.
    const wb = await seed();
    const before = await wb.admin.query(
      "select secret_ciphertext from system_settings where key = 'mail.password'",
    );
    await rotateInstanceSecrets(wb.appPool, rotatingRing);
    const after = await wb.admin.query(
      "select secret_ciphertext from system_settings where key = 'mail.password'",
    );

    expect(after.rows[0]?.secret_ciphertext).toBe(
      before.rows[0]?.secret_ciphertext,
    );
  });

  it("does nothing on a second run", async () => {
    const wb = await seed();
    await rotateInstanceSecrets(wb.appPool, rotatingRing);
    const second = await rotateInstanceSecrets(wb.appPool, rotatingRing);

    expect(second.rewrapped).toBe(0);
    expect(second.current).toBe(2);
  });

  it("leaves an unrotated instance readable, so an interrupted run is safe", async () => {
    // Simulates dying after one secret: the remaining one is still on the old
    // key, and the ring still holds it.
    const wb = await seed();
    await writeSettings(wb.appPool, rotatingRing, [
      { key: "mail.password", secret: "smtp-secret" },
    ]);

    expect(await readSecret(wb.appPool, rotatingRing, "mail.password")).toBe(
      "smtp-secret",
    );
    expect(await readSecret(wb.appPool, rotatingRing, "ai.key")).toBe(
      "provider-secret",
    );
  });

  it("refuses to read an old secret once the old key leaves the ring", async () => {
    // The failure an operator must never hit by accident, proven to be a loud
    // error rather than a silently empty value.
    const wb = await seed();
    await expect(
      readSecret(wb.appPool, newRingOnly, "mail.password"),
    ).rejects.toThrow(KeyRingError);
  });

  it("reports nothing to do on an instance with no secrets", async () => {
    const wb = await workerDb();
    await writeSettings(wb.appPool, oldRing, [
      { key: "instance.name", value: "Acme" },
    ]);

    const report = await rotateInstanceSecrets(wb.appPool, rotatingRing);
    expect(report).toEqual({
      examined: 0,
      rewrapped: 0,
      current: 0,
      workspaceSecrets: 0,
    });
  });
});

/**
 * Workspace secrets (completeness review H-25).
 *
 * AI provider keys, chat channel credentials and SSO client secrets are sealed
 * under the same root key as the instance settings. Rotation re-wrapped only
 * the instance settings, and `./openokr rotate-key` drops the previous key as
 * soon as rotation returns, so a routine rotation left every one of them
 * unreadable. This suite connects as the restricted application role, which
 * is also what the command runs as now.
 */
describe("rotating the secrets workspaces hold", () => {
  const seedWorkspace = async (userId: string) => {
    const wb = await workerDb();
    await wb.admin.query(
      "insert into users (id, name, email) values ($1, $2, $3)",
      [userId, userId, `${userId}@example.com`],
    );
    const { workspaceId } = await createWorkspace(wb.appPool, {
      user: { id: userId, name: userId },
    });
    const ai = encryptSecret(oldRing, `ai-${userId}`);
    const chat = encryptSecret(oldRing, `chat-${userId}`);
    const sso = encryptSecret(oldRing, `sso-${userId}`);
    await withWorkspace(wb.db, workspaceId, async (tx) => {
      await tx.insert(aiCredentials).values({
        workspaceId,
        provider: "anthropic",
        keyHint: "sk-...abcd",
        ...ai,
      });
      await tx.insert(channelConnections).values({
        workspaceId,
        provider: "slack",
        ...chat,
      });
      await tx.insert(ssoConnections).values({
        workspaceId,
        providerId: `idp-${userId}`,
        displayName: "Company sign-in",
        clientId: "client",
        secretCiphertext: sso.ciphertext,
        secretDataKey: sso.dataKey,
        secretKeyId: sso.keyId,
      });
    });
    return workspaceId;
  };

  const openAll = async (workspaceId: string) => {
    const wb = await workerDb();
    return withWorkspace(wb.db, workspaceId, async (tx) => {
      const [ai] = await tx
        .select()
        .from(aiCredentials)
        .where(includeDeleted(aiCredentials));
      const [chat] = await tx
        .select()
        .from(channelConnections)
        .where(includeDeleted(channelConnections));
      const [sso] = await tx
        .select()
        .from(ssoConnections)
        .where(includeDeleted(ssoConnections));
      if (!ai || !chat || !sso) {
        throw new Error("a seeded secret is missing");
      }
      return [
        decryptSecret(newRingOnly, ai),
        decryptSecret(newRingOnly, chat),
        decryptSecret(newRingOnly, {
          ciphertext: sso.secretCiphertext,
          dataKey: sso.secretDataKey,
          keyId: sso.secretKeyId,
        }),
      ];
    });
  };

  it("re-wraps every one, in every workspace, so the old key can go", async () => {
    const wb = await workerDb();
    const first = await seedWorkspace("rotate-a");
    const second = await seedWorkspace("rotate-b");

    const report = await rotateInstanceSecrets(wb.appPool, rotatingRing);
    expect(report.workspaceSecrets).toBe(6);
    expect(report.rewrapped).toBe(6);

    expect(await openAll(first)).toEqual([
      "ai-rotate-a",
      "chat-rotate-a",
      "sso-rotate-a",
    ]);
    expect(await openAll(second)).toEqual([
      "ai-rotate-b",
      "chat-rotate-b",
      "sso-rotate-b",
    ]);
  });

  it("includes a credential that was deleted, which a restore can bring back", async () => {
    const wb = await workerDb();
    const workspaceId = await seedWorkspace("rotate-c");
    await withWorkspace(wb.db, workspaceId, (tx) =>
      tx
        .update(aiCredentials)
        .set({ deletedAt: new Date() })
        .where(eq(aiCredentials.workspaceId, workspaceId)),
    );

    await rotateInstanceSecrets(wb.appPool, rotatingRing);
    expect(await openAll(workspaceId)).toContain("ai-rotate-c");
  });

  it("does nothing to them on a second run", async () => {
    const wb = await workerDb();
    await seedWorkspace("rotate-d");
    await rotateInstanceSecrets(wb.appPool, rotatingRing);
    const second = await rotateInstanceSecrets(wb.appPool, rotatingRing);
    expect(second.rewrapped).toBe(0);
    expect(second.current).toBe(3);
  });
});
