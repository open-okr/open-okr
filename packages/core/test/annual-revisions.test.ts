import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { richTextFromPlainText } from "../src/rich-text/from-text.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * Annual revisions (METHOD.md §2.1, P9-T13-c-c, NW-Q2-22).
 *
 * The annual OKRs and the not-doing list may be revised at a quarterly
 * revalidation, with a written reason. An agreed frame keeps every revision,
 * with what it held before; an annual target eases under the same rule as
 * any other, and the year-end grading sees the original.
 */

const OWNER = "annual-owner";

let workspaceId: string;
let ownerMemberId: string;

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

const NOT_DOING = richTextFromPlainText(
  "No pricing rebuild before July\nNo new regions this year",
);
const NOT_DOING_REVISED = richTextFromPlainText("No new regions this year");
const REASON = "Competitive price point; the pricing review starts in Q3";
const STRATEGIES = [
  { text: "Win mid-market on time to value" },
  { text: "Make onboarding self-serve" },
];

interface Frame {
  notDoing: unknown;
  revisions: {
    fields: string[];
    before: Record<string, unknown>;
    reason: string;
    authorName: string | null;
  }[];
}

const frame = () => call<Frame>("frame.read", {});

/** Northwind's 2026 frame, agreed in December. */
async function agreedFrame() {
  await call("frame.set", {
    yearLabel: "2026",
    agreed: true,
    notDoing: NOT_DOING,
    strategies: STRATEGIES,
  });
}

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "Elena Owner", `${OWNER}@example.com`],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Elena Owner",
  });
  workspaceId = provisioned.workspaceId;
  ownerMemberId = provisioned.memberId;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("the frame within its year", () => {
  it("saves an edit to the same year's prose, which it used to answer as saved and drop", async () => {
    await call("frame.set", {
      yearLabel: "2026",
      notDoing: NOT_DOING,
      strategies: STRATEGIES,
    });
    await call("frame.set", {
      yearLabel: "2026",
      notDoing: NOT_DOING_REVISED,
      strategies: STRATEGIES,
    });
    const read = await frame();
    expect(JSON.stringify(read.notDoing)).toContain("No new regions");
    expect(JSON.stringify(read.notDoing)).not.toContain("pricing rebuild");
    // A draft keeps no history.
    expect(read.revisions).toEqual([]);
  });
});

describe("an agreed frame (NW-Q2-22)", () => {
  it("refuses a revision without a reason, and keeps one with it, with what it held before", async () => {
    await agreedFrame();
    await expect(
      call("frame.set", {
        yearLabel: "2026",
        agreed: true,
        notDoing: NOT_DOING_REVISED,
        strategies: STRATEGIES,
      }),
    ).rejects.toThrow(/needs a written reason/);

    await call("frame.set", {
      yearLabel: "2026",
      agreed: true,
      notDoing: NOT_DOING_REVISED,
      strategies: STRATEGIES,
      reason: REASON,
    });
    const read = await frame();
    expect(JSON.stringify(read.notDoing)).not.toContain("pricing rebuild");
    expect(read.revisions).toHaveLength(1);
    expect(read.revisions[0]).toMatchObject({
      fields: ["notDoing"],
      reason: REASON,
      authorName: "Elena Owner",
    });
    expect(JSON.stringify(read.revisions[0]?.before.notDoing)).toContain(
      "No pricing rebuild before July",
    );
  });

  it("treats taking it back to draft as a revision, so it cannot be rewritten silently", async () => {
    await agreedFrame();
    await expect(
      call("frame.set", {
        yearLabel: "2026",
        agreed: false,
        notDoing: NOT_DOING,
        strategies: STRATEGIES,
      }),
    ).rejects.toThrow(/needs a written reason/);
    await call("frame.set", {
      yearLabel: "2026",
      agreed: false,
      notDoing: NOT_DOING,
      strategies: STRATEGIES,
      reason: "Reopened for the board's strategy offsite",
    });
    const read = await frame();
    expect(read.revisions).toHaveLength(1);
    expect(read.revisions[0]).toMatchObject({
      fields: ["agreed"],
      reason: "Reopened for the board's strategy offsite",
    });
  });

  it("asks nothing when what is sent is what it holds", async () => {
    await agreedFrame();
    await call("frame.set", {
      yearLabel: "2026",
      agreed: true,
      notDoing: NOT_DOING,
      strategies: STRATEGIES,
    });
    expect((await frame()).revisions).toEqual([]);
  });

  it("keeps a revision of its strategies, with the list they replaced", async () => {
    await agreedFrame();
    await call("frame.set", {
      yearLabel: "2026",
      agreed: true,
      strategies: [...STRATEGIES, { text: "Answer Brightline in mid-market" }],
      reason: "Brightline entered the segment on 10 May",
    });
    const [revision] = (await frame()).revisions;
    expect(revision?.fields).toEqual(["strategies"]);
    expect(revision?.before.strategies).toEqual(
      STRATEGIES.map((entry) => ({ text: entry.text, note: null })),
    );
  });

  it("keeps its strategies, and what is aligned to them, when only the not-doing list is revised (P9-T22c-c-b)", async () => {
    await agreedFrame();
    const ids = async () =>
      (
        await call<{ strategies: { id: string }[] }>("frame.read", {})
      ).strategies.map((strategy) => strategy.id);
    const before = await ids();
    await call("frame.set", {
      yearLabel: "2026",
      agreed: true,
      notDoing: NOT_DOING_REVISED,
      strategies: STRATEGIES,
      reason: REASON,
    });
    // The same rows, so an annual objective aligned to one still is.
    expect(await ids()).toEqual(before);
  });

  it("starts a new year without asking, which supersedes rather than revises", async () => {
    await agreedFrame();
    await call("frame.set", {
      yearLabel: "2027",
      agreed: false,
      notDoing: NOT_DOING_REVISED,
      strategies: STRATEGIES,
    });
    expect((await frame()).revisions).toEqual([]);
  });
});

describe("an annual target (NW-Q2-22's A4)", () => {
  it("eases under the same rule as any target, and its history keeps 35 to 32 with the reason", async () => {
    const cycleId = (
      await call<{ id: string }>("cycles.create", {
        on: `${new Date().getUTCFullYear()}-06-30`,
        mode: "annual",
      })
    ).id;
    const goalId = (
      await call<{ id: string }>("goals.create", {
        title: "Mid-market buyers choose us",
        cycleId,
        level: "company",
        championId: ownerMemberId,
      })
    ).id;
    const keyResultId = (
      await call<{ id: string }>("goals.addKeyResult", {
        goalId,
        title: "Mid-market win rate from 24% to 35%",
        direction: "increase",
        indicatorType: "lagging",
        baselineValue: 24,
        targetValue: 35,
      })
    ).id;
    await expect(
      call("goals.changeTarget", { id: keyResultId, targetValue: 32 }),
    ).rejects.toThrow(/Easing a target needs a written reason/);
    await call("goals.changeTarget", {
      id: keyResultId,
      targetValue: 32,
      reason: "Brightline's entry into the segment on 10 May",
    });
    const history = await call<{
      changes: { from: number; to: number; eased: boolean; reason: string }[];
    }>("goals.targetHistory", { id: keyResultId });
    expect(history.changes).toEqual([
      expect.objectContaining({
        from: 35,
        to: 32,
        eased: true,
        reason: "Brightline's entry into the segment on 10 May",
      }),
    ]);
  });
});
