import type { AgentDrafter, ProposedImportMapping } from "@openokr/core";
import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { resolveMapping } from "../src/imports/mapping.ts";
import { goalsTemplate } from "../src/imports/templates/index.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * The AI column mapper (TECHNICAL-PLAN §7.1 step 2, P6-T01b-a).
 *
 * The task's test plan, and the shape of the risk it covers: a proposal is
 * text from a model about somebody else's spreadsheet, and every way it can be
 * wrong has to end with a column a person names rather than a column silently
 * put in the wrong field.
 *
 * **The manual path is the control.** Every test that turns the provider off
 * checks that the alias matching still maps the same file, because that is what
 * "the deterministic path is unchanged" means for this row: the mapper is help,
 * never the mechanism.
 */

const OWNER = "mapper-owner";

let workspaceId: string;

const drafterWith = (answer: ProposedImportMapping | null): AgentDrafter => ({
  spentUsd: () => 0,
  async proposeImportMapping() {
    return answer;
  },
});

/** A drafter whose mapper throws, which is a provider falling over mid-call. */
const brokenDrafter = (): AgentDrafter => ({
  spentUsd: () => 0,
  async proposeImportMapping() {
    throw new Error("the provider went away");
  },
});

const HEADERS = [
  "Ref",
  "What we are doing",
  "Tier",
  "Q",
  "Runs it",
  "Checks it",
  "Strategic pillar",
];

const propose = async (
  drafter: AgentDrafter | undefined,
  headers: readonly string[] = HEADERS,
) => {
  const wb = await workerDb();
  return callAction(
    {
      pool: wb.appPool,
      workspaceId,
      actor: { kind: "human" as const, userId: OWNER },
      ...(drafter ? { drafter } : {}),
    },
    "imports.proposeMapping",
    { entity: "goals", headers: [...headers] },
  );
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, 'Ada', $2)",
    [OWNER, "mapper-owner@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Ada",
  });
  workspaceId = provisioned.workspaceId;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("a proposal a person can act on", () => {
  it("maps the columns it recognises and leaves the rest", async () => {
    const answer = await propose(
      drafterWith({
        fields: [
          "externalId",
          "title",
          "level",
          "cycle",
          "champion",
          "reviewer",
          "",
        ],
        notes: "The last column has no field.",
      }),
    );

    expect(answer).not.toBeNull();
    expect(answer?.columns).toEqual({
      Ref: "externalId",
      "What we are doing": "title",
      Tier: "level",
      Q: "cycle",
      "Runs it": "champion",
      "Checks it": "reviewer",
    });
    // A column the model deliberately left alone is a column for a person, not
    // an error.
    expect(answer?.unclaimed).toEqual(["Strategic pillar"]);
    expect(answer?.notes).toBe("The last column has no field.");
  });

  it("drops a field the template does not have rather than passing it on", async () => {
    const answer = await propose(
      drafterWith({
        fields: [
          "externalId",
          "objectiveCode",
          "level",
          "cycle",
          "champion",
          "reviewer",
          "",
        ],
        notes: "",
      }),
    );

    expect(answer?.columns["What we are doing"]).toBeUndefined();
    expect(answer?.unclaimed).toContain("What we are doing");
  });

  it("keeps the first of two columns claiming one field", async () => {
    // A field carries one column. Choosing between two is the reader's call.
    const answer = await propose(
      drafterWith({
        fields: [
          "externalId",
          "title",
          "level",
          "cycle",
          "champion",
          "reviewer",
          "title",
        ],
        notes: "",
      }),
    );

    expect(answer?.columns["What we are doing"]).toBe("title");
    expect(answer?.columns["Strategic pillar"]).toBeUndefined();
    expect(answer?.unclaimed).toEqual(["Strategic pillar"]);
  });

  it("leaves every column for a person when the answer is short", async () => {
    // A model that answered about three columns has said nothing about the
    // other four, and nothing is what they get.
    const answer = await propose(
      drafterWith({ fields: ["externalId", "title", "level"], notes: "" }),
    );

    expect(Object.keys(answer?.columns ?? {})).toEqual([
      "Ref",
      "What we are doing",
      "Tier",
    ]);
    expect(answer?.unclaimed).toEqual([
      "Q",
      "Runs it",
      "Checks it",
      "Strategic pillar",
    ]);
  });
});

describe("with no provider, and when one falls over", () => {
  it("answers nothing at all with the provider off", async () => {
    expect(await propose(undefined)).toBeNull();
  });

  it("answers nothing when the model does", async () => {
    expect(await propose(drafterWith(null))).toBeNull();
  });

  it("answers nothing when the provider throws", async () => {
    expect(await propose(brokenDrafter())).toBeNull();
  });

  it("still maps a familiar file by alias, which is the whole manual path", async () => {
    // The control for all three cases above: nothing here needs a provider.
    const mapping = resolveMapping(goalsTemplate, [
      "Objective ID",
      "Objective",
      "LEVEL",
      "quarter",
      "Champion",
      "reviewer",
    ]);
    expect(Object.keys(mapping.fieldToIndex).sort()).toEqual([
      "champion",
      "cycle",
      "externalId",
      "level",
      "reviewer",
      "title",
    ]);
  });
});

describe("what it refuses outright", () => {
  it("refuses an entity that has no template", async () => {
    const wb = await workerDb();
    await expect(
      callAction(
        {
          pool: wb.appPool,
          workspaceId,
          actor: { kind: "human" as const, userId: OWNER },
          drafter: drafterWith({ fields: [], notes: "" }),
        },
        "imports.proposeMapping",
        { entity: "objectives", headers: ["Ref"] },
      ),
    ).rejects.toThrow(/no template for "objectives"/);
  });

  it("refuses a call with no headers, before it reaches a provider", async () => {
    const wb = await workerDb();
    await expect(
      callAction(
        {
          pool: wb.appPool,
          workspaceId,
          actor: { kind: "human" as const, userId: OWNER },
          drafter: drafterWith({ fields: [], notes: "" }),
        },
        "imports.proposeMapping",
        { entity: "goals", headers: [] },
      ),
    ).rejects.toThrow();
  });
});
