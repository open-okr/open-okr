import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * goals.checkDraft: the §4 verdicts on an objective nobody has saved
 * (mcp-audit-2026-10-29, §10.2 Q16).
 */
const OWNER = "check-owner";
let workspaceId: string;

const call = async (name: string, input: unknown) => {
  const wb = await workerDb();
  return callAction(
    {
      pool: wb.appPool,
      workspaceId,
      actor: { kind: "human" as const, userId: OWNER },
    },
    name as never,
    input as never,
  );
};

type Checked = {
  score: number | null;
  objective: {
    id: string;
    status: string;
    condition: string;
    prompt: string;
  }[];
  keyResults: { id: string; status: string; keyResults: number[] }[];
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, 'Ada', $2)",
    [OWNER, "check-owner@example.com"],
  );
  workspaceId = (
    await provisionWorkspaceForUser(wb.appPool, { id: OWNER, name: "Ada" })
  ).workspaceId;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("checking a draft", () => {
  it("names a failing check with its condition and coaching prompt", async () => {
    const checked = (await call("goals.checkDraft", {
      title: "Launch the new website",
      level: "team",
      keyResults: [{ title: "Finish the redesign" }],
    })) as Checked;

    const outcome = checked.objective.find((entry) => entry.id === "OBJ-1");
    expect(outcome?.status).not.toBe("pass");
    expect(outcome?.condition.length).toBeGreaterThan(0);
    expect(outcome?.prompt.length).toBeGreaterThan(20);
    expect(
      checked.keyResults.some(
        (entry) => entry.status !== "pass" && entry.keyResults.includes(0),
      ),
    ).toBe(true);
  });

  it("scores a sharper draft higher than a weak one", async () => {
    const weak = (await call("goals.checkDraft", {
      title: "Launch the new website",
      level: "team",
      keyResults: [{ title: "Finish the redesign" }],
    })) as Checked;
    const sharp = (await call("goals.checkDraft", {
      title: "Customers find what they need without calling us",
      level: "team",
      keyResults: [
        {
          title: "Cut support calls about navigation from 400 to 150 a month",
          kind: "metric",
          direction: "reduce",
          indicatorType: "lagging",
          baselineValue: 400,
          targetValue: 150,
        },
        {
          title: "Raise search success rate from 40% to 70%",
          kind: "metric",
          direction: "increase",
          indicatorType: "leading",
          baselineValue: 40,
          targetValue: 70,
        },
      ],
    })) as Checked;
    expect(sharp.score ?? 0).toBeGreaterThan(weak.score ?? 0);
  });

  it("saves nothing", async () => {
    await call("goals.checkDraft", { title: "Anything at all", level: "team" });
    const wb = await workerDb();
    const { rowCount } = await wb.admin.query("select 1 from goals");
    expect(rowCount).toBe(0);
  });
});
