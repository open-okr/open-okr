import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * One space's KPIs, grouped by tree, for the space home (completeness review
 * M-22).
 *
 * The space home showed no KPIs at all. What is proved here is that the read
 * returns exactly the space's own measures, in the trees they are filed in
 * with the unfiled ones last, and that it goes through the space: somebody who
 * cannot open the space is answered not-found, as `spaces.read` answers them.
 */

const OWNER = "space-kpi-owner";

let workspaceId: string;
let growthId: string;
let financeId: string;

const as = async (userId: string) => {
  const wb = await workerDb();
  return {
    pool: wb.appPool,
    workspaceId,
    actor: { kind: "human" as const, userId },
  };
};

async function createUser(id: string, name: string) {
  const wb = await workerDb();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [id, name, `${id}@example.com`],
  );
}

/** Somebody who joined through an ordinary reusable link. */
async function joinAsMember(userId: string): Promise<string> {
  await createUser(userId, userId);
  const link = await callAction(
    await as(OWNER),
    "invitations.createWorkspaceLink",
    {},
  );
  const { memberId } = await callAction(
    await as(userId),
    "invitations.acceptLink",
    { token: link.token },
  );
  return memberId;
}

async function kpi(
  title: string,
  owner: { spaceId: string } | "workspace",
  parentKpiId?: string,
) {
  return callAction(await as(OWNER), "kpis.create", {
    title,
    frequency: "monthly",
    direction: "higher_better",
    indicatorType: "lagging",
    tier: "output",
    aggregate: "sum",
    ...(owner === "workspace"
      ? { ownerKind: "workspace" as const }
      : { ownerKind: "space" as const, spaceId: owner.spaceId }),
    ...(parentKpiId ? { parentKpiId } : {}),
  });
}

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await createUser(OWNER, "Owner");
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Owner",
  });
  workspaceId = provisioned.workspaceId;
  growthId = (
    await callAction(await as(OWNER), "spaces.create", { name: "Growth" })
  ).id;
  financeId = (
    await callAction(await as(OWNER), "spaces.create", { name: "Finance" })
  ).id;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("a space's KPI trees", () => {
  it("holds the space's own KPIs, by tree, with the unfiled ones last", async () => {
    const revenue = await kpi("Revenue", { spaceId: growthId });
    const leads = await kpi(
      "Qualified leads",
      { spaceId: growthId },
      revenue.id,
    );
    await kpi("Churn", { spaceId: growthId });
    await kpi("Cost per hire", { spaceId: financeId });
    await kpi("Net promoter score", "workspace");

    const tree = await callAction(await as(OWNER), "kpis.createTree", {
      name: "Growth engine",
      rootKpiId: revenue.id,
    });
    await callAction(await as(OWNER), "kpis.update", {
      kpiId: leads.id,
      treeId: tree.id,
    });

    const read = await callAction(await as(OWNER), "kpis.spaceTrees", {
      spaceId: growthId,
    });

    expect(read.trees.map((group) => group.name)).toEqual([
      "Growth engine",
      null,
    ]);
    const [named, unfiled] = read.trees;
    expect(named?.id).toBe(tree.id);
    expect(named?.nodes.map((node) => node.title).sort()).toEqual([
      "Qualified leads",
      "Revenue",
    ]);
    // The parent pointer comes through, so the screen can indent by it.
    expect(
      named?.nodes.find((node) => node.title === "Qualified leads")
        ?.parentKpiId,
    ).toBe(revenue.id);
    expect(unfiled?.id).toBeNull();
    expect(unfiled?.nodes.map((node) => node.title)).toEqual(["Churn"]);
  });

  it("is empty for a space that owns no KPI", async () => {
    await kpi("Net promoter score", "workspace");
    const read = await callAction(await as(OWNER), "kpis.spaceTrees", {
      spaceId: financeId,
    });
    expect(read.trees).toEqual([]);
  });

  it("is readable by any member who can open the space", async () => {
    await kpi("Revenue", { spaceId: growthId });
    await joinAsMember("space-kpi-member");
    const read = await callAction(
      await as("space-kpi-member"),
      "kpis.spaceTrees",
      { spaceId: growthId },
    );
    expect(read.trees[0]?.nodes.map((node) => node.title)).toEqual(["Revenue"]);
  });

  it("answers not-found to somebody who cannot open the space", async () => {
    await kpi("Revenue", { spaceId: growthId });
    const memberId = await joinAsMember("space-kpi-guest");
    // A guest reaches no space through a standard group, so this one can open
    // neither space and must learn nothing about what either measures.
    await callAction(await as(OWNER), "people.convertToGuest", { memberId });

    await expect(
      callAction(await as("space-kpi-guest"), "kpis.spaceTrees", {
        spaceId: growthId,
      }),
    ).rejects.toThrow(/No such space/);

    // Put in the one space, they see that space's measures and only those.
    await callAction(await as(OWNER), "spaces.addMember", {
      spaceId: growthId,
      memberId,
      role: "member",
    });
    const read = await callAction(
      await as("space-kpi-guest"),
      "kpis.spaceTrees",
      { spaceId: growthId },
    );
    expect(read.trees[0]?.nodes.map((node) => node.title)).toEqual(["Revenue"]);
    await expect(
      callAction(await as("space-kpi-guest"), "kpis.spaceTrees", {
        spaceId: financeId,
      }),
    ).rejects.toThrow(/No such space/);
  });

  it("answers not-found for a space that does not exist", async () => {
    await expect(
      callAction(await as(OWNER), "kpis.spaceTrees", {
        spaceId: "00000000-0000-4000-8000-000000000000",
      }),
    ).rejects.toThrow(/No such space/);
  });
});
