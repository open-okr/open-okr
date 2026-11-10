import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { OperationError } from "../src/operations/errors.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * The annual frame is reference material during a quarterly cycle
 * (METHOD.md §2.1 and §2.2, docs/design/okr-core-domain.md §3.1, plan 0.7.0
 * O1).
 *
 * `frame.set` takes the cycle it acts from. An annual cycle, or no cycle at
 * all, may write the frame; a quarterly cycle may not, because its phase 3
 * revalidates the frame and never rewrites it.
 */

const OWNER = "frame-owner";
let workspaceId: string;

async function call<T>(action: string, input: unknown): Promise<T> {
  return (await callAction(
    {
      pool: (await workerDb()).appPool,
      workspaceId,
      actor: { kind: "human" as const, userId: OWNER },
    },
    action as never,
    input as never,
  )) as T;
}

const FRAME = {
  yearLabel: "2026",
  strategies: [{ text: "Win mid-market on time to value" }],
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "Elena Owner", `${OWNER}@example.com`],
  );
  workspaceId = (
    await provisionWorkspaceForUser(wb.appPool, { id: OWNER, name: "Elena" })
  ).workspaceId;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("writing the annual frame from a cycle", () => {
  it("refuses a quarterly cycle and writes nothing", async () => {
    const quarter = await call<{ id: string }>("cycles.current", {
      mode: "quarterly",
    });

    const refused = await call("frame.set", {
      ...FRAME,
      cycleId: quarter.id,
    }).catch((error: unknown) => error);

    expect(refused).toBeInstanceOf(OperationError);
    expect((refused as OperationError).code).toBe("forbidden");
    expect((refused as OperationError).message).toMatch(/annual cycle/i);
    expect(await call("frame.read", {})).toBeNull();
  });

  it("writes from an annual cycle", async () => {
    const year = await call<{ id: string }>("cycles.create", {
      on: "2026-06-30",
      mode: "annual",
    });

    await call("frame.set", { ...FRAME, cycleId: year.id });

    expect(await call<{ yearLabel: string }>("frame.read", {})).toMatchObject({
      yearLabel: "2026",
    });
  });

  it("writes with no cycle at all, which is how the API and the demo write it", async () => {
    await call("frame.set", FRAME);
    expect(await call<{ yearLabel: string }>("frame.read", {})).toMatchObject({
      yearLabel: "2026",
    });
  });

  it("answers not found for a cycle that is not in this workspace", async () => {
    const refused = await call("frame.set", {
      ...FRAME,
      cycleId: "00000000-0000-4000-8000-000000000000",
    }).catch((error: unknown) => error);
    expect((refused as OperationError).code).toBe("not_found");
  });
});
