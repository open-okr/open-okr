import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The wizard stores no name when the field is left as it was pre-filled
 * (completeness review M-33).
 *
 * The field is pre-filled with the name the instance already resolves to,
 * which on the demo was `OPENOKR_INSTANCE_NAME`. It used to store whatever
 * the field held, and a stored value beats the environment, so clicking
 * through the wizard copied the variable into the database, where changing it
 * afterwards did nothing. `packages/core/test/instance-name.test.ts` proves the
 * rule against a real database; this proves the wizard's action applies it,
 * comparing against the name resolved on the server rather than anything the
 * browser says.
 */

const completeSetup = vi.fn();

vi.mock("@openokr/core", async (original) => ({
  ...(await original<typeof import("@openokr/core")>()),
  completeSetup: (...args: unknown[]) => completeSetup(...args),
  readSetupState: async () => ({ configured: false, hasUser: true }),
}));
vi.mock("../lib/auth", () => ({ getPool: () => ({}) }));
vi.mock("../lib/secrets", () => ({ getKeyRing: () => ({}) }));
vi.mock("../lib/session", () => ({ currentSession: async () => ({}) }));
vi.mock("../lib/instance-name", () => ({
  getInstanceName: async () => "OKR Goal",
}));
vi.mock("../lib/translations", () => ({
  getTranslations: async () => ({ t: (key: string) => key }),
}));

const { finishSetup } = await import("../app/setup/account/actions");

beforeEach(() => {
  completeSetup.mockReset().mockResolvedValue({
    completedAt: "2026-09-29T00:00:00.000Z",
    claimed: true,
  });
});

const storedSettings = () => {
  const input = completeSetup.mock.calls[0]?.[2] as
    | { settings: unknown[] }
    | undefined;
  return input?.settings;
};

describe("finishing the wizard", () => {
  it("stores no name when the field is left as pre-filled", async () => {
    expect(await finishSetup({ instanceName: "OKR Goal" })).toEqual({
      ok: true,
    });
    expect(storedSettings()).toEqual([]);
  });

  it("stores no name for an emptied field", async () => {
    await finishSetup({ instanceName: "  " });
    expect(storedSettings()).toEqual([]);
  });

  it("stores the name the operator typed", async () => {
    await finishSetup({ instanceName: " Acme OKR " });
    expect(storedSettings()).toEqual([
      { key: "instance.name", value: "Acme OKR" },
    ]);
  });

  it("refuses a name over the limit and stores nothing", async () => {
    const result = await finishSetup({ instanceName: "x".repeat(121) });
    expect(result.ok).toBe(false);
    expect(completeSetup).not.toHaveBeenCalled();
  });
});
