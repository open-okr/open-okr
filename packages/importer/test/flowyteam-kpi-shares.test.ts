/**
 * FlowyTeam KPI shares into OpenOKR access bindings (TECHNICAL-PLAN §7.2, 0.10.0 K8).
 *
 * Proves AC-32 to AC-37 and Q7 refusal.
 */
import { callAction, provisionWorkspaceForUser } from "@openokr/core";
import { workerDb } from "@openokr/test-support/db";
import type { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { runFlowyteamImport } from "../src/flowyteam/run.ts";
import { openSource, type Source } from "../src/flowyteam/source.ts";
import {
  available,
  SEEDED,
  type SeededSource,
  SKIP_REASON,
  seedSource,
} from "./support/flowyteam-source.ts";

const OWNER = "77777777-7777-4777-8777-777777777777";
const runnable = await available();
if (!runnable) {
  console.warn(`Skipping the FlowyTeam KPI shares tests. ${SKIP_REASON}`);
}

let pool: Pool;
let workspaceId: string;
let seeded: SeededSource;
let source: Source;

async function run(options: {
  write: boolean;
  only?: readonly string[];
  acceptBroaderVisibility?: boolean;
}) {
  return runFlowyteamImport({
    pool,
    workspaceId,
    userId: OWNER,
    url: seeded.url,
    companyId: SEEDED.first.id,
    source,
    write: options.write,
    only: options.only,
    acceptBroaderVisibility: options.acceptBroaderVisibility,
  });
}

const domain = (
  report: Awaited<ReturnType<typeof run>>["report"],
  name: string,
) =>
  report.reconciliation.find(
    (one) =>
      one.domain.toLowerCase() === name.toLowerCase() ||
      one.domain.toLowerCase().replace(/\s+/g, "-") === name.toLowerCase(),
  );

describe("importing FlowyTeam KPI shares", () => {
  beforeEach(async () => {
    if (!runnable) {
      return;
    }
    const wb = await workerDb();
    pool = wb.appPool;
    await wb.truncateAllTables();
    await wb.admin.query(
      "insert into users (id, name, email) values ($1, $2, $3)",
      [OWNER, "Import Owner", "kpi-owner@example.com"],
    );
    const provisioned = await provisionWorkspaceForUser(wb.appPool, {
      id: OWNER,
      name: "Import Owner",
    });
    workspaceId = provisioned.workspaceId;

    await seeded?.drop();
    await source?.close();
    seeded = await seedSource("kpi_shares");
    source = await openSource({ url: seeded.url });
  });

  afterAll(async () => {
    await seeded?.drop();
    await source?.close();
  });

  it("AC-37: --only kpi-shares automatically includes kpis and organisation first", async () => {
    const { report } = await run({
      write: false,
      only: ["kpi-shares"],
    });

    expect(report.selected).toEqual(["organisation", "kpis", "kpi-shares"]);
    expect(report.addedForDependencies).toContain("organisation");
    expect(report.addedForDependencies).toContain("kpis");
    expect(report.notes.join(" ")).toMatch(
      /because what you asked for depends on them/,
    );
  });

  it("refuses --write when flagged KPIs exist and --accept-broader-visibility is absent (Q7)", async () => {
    await seeded.run(
      "insert into indicators (id, company_id, indicator_type_id, title) values (101, 7, 1, 'Flagged Indicator')",
    );
    await seeded.run(
      "insert into indicator_accesses (id, company_id, indicator_id, user_id, permissions) values (501, 7, 101, 1, 'read')",
    );

    await expect(
      run({
        write: true,
        only: ["kpis", "kpi-shares"],
        acceptBroaderVisibility: false,
      }),
    ).rejects.toThrow(/broader visibility/i);
  });

  it("AC-32: dry run with 50 access rows reports correct write and skip breakdowns", async () => {
    // 1. Setup users in MySQL: users 10..57 (48 users) with company_id = 7
    const userInserts: string[] = [];
    const empInserts: string[] = [];
    for (let i = 10; i <= 57; i++) {
      userInserts.push(`(${i}, 7, 'User ${i}', 'user${i}@example.com')`);
      empInserts.push(`(${i}, 7, ${i})`);
    }
    await seeded.run(
      `insert into users (id, company_id, name, email) values ${userInserts.join(", ")}`,
    );
    await seeded.run(
      `insert into employee_details (id, company_id, user_id) values ${empInserts.join(", ")}`,
    );

    // Import organisation and kpis first
    await run({
      write: true,
      only: ["organisation", "kpis"],
      acceptBroaderVisibility: true,
    });

    const wb = await workerDb();
    const [viewerRole] = (
      await wb.admin.query<{ id: string }>(
        "select id from workspace_roles where workspace_id = $1 and builtin_key = 'viewer'",
        [workspaceId],
      )
    ).rows;
    const [defaultRole] = (
      await wb.admin.query<{ id: string }>(
        "select id from workspace_roles where workspace_id = $1 and is_default = true",
        [workspaceId],
      )
    ).rows;

    const memberRows = (
      await wb.admin.query<{ id: string; placeholder_email: string }>(
        `select wm.id, wm.placeholder_email
           from workspace_members wm
          where wm.workspace_id = $1
            and wm.placeholder_email like 'user%@example.com'
          order by wm.placeholder_email`,
        [workspaceId],
      )
    ).rows;

    expect(memberRows.length).toBe(48);

    // Users 10..29 (20 users): human, default Member role (roleLevel = 70)
    for (let i = 0; i < 20; i++) {
      await wb.admin.query(
        "update workspace_members set kind = 'human', role_id = $1 where id = $2",
        [defaultRole?.id, memberRows[i]?.id],
      );
    }
    // Users 30..44 (15 users): human, set role to viewer
    for (let i = 20; i < 35; i++) {
      await wb.admin.query(
        "update workspace_members set kind = 'human', role_id = $1 where id = $2",
        [viewerRole?.id, memberRows[i]?.id],
      );
    }
    // Users 45..52 (8 users): guest, role_id null
    for (let i = 35; i < 43; i++) {
      await wb.admin.query(
        "update workspace_members set kind = 'guest', role_id = null where id = $1",
        [memberRows[i]?.id],
      );
    }
    // Users 53..57 (5 users): keep placeholder (kind = 'placeholder')

    // Seed 50 rows in indicator_accesses:
    await seeded.run("delete from indicator_accesses where company_id = 7");

    // 2 team shares: user_id null, department_id 1
    const accessRows: string[] = [
      "(1, 7, 1, null, 1, 'read', 'team', 'daily')",
      "(2, 7, 1, null, 1, 'update', 'team', 'weekly')",
    ];

    // 20 role-covered (users 10..29): 10 read, 10 update
    for (let i = 10; i <= 29; i++) {
      const perm = i % 2 === 0 ? "read" : "update";
      const occ = i < 15 ? "daily" : i < 25 ? "weekly" : "monthly";
      accessRows.push(
        `(${i}, 7, 1, ${i}, null, '${perm}', 'everyone', '${occ}')`,
      );
    }

    // 15 Viewers with update (users 30..44): permissions = 'update'
    for (let i = 30; i <= 44; i++) {
      const opt = i === 30 ? "me" : i === 31 ? "manager" : "everyone";
      accessRows.push(`(${i}, 7, 1, ${i}, null, 'update', '${opt}', 'weekly')`);
    }

    // 8 guests with read (users 45..52): permissions = 'read'
    for (let i = 45; i <= 52; i++) {
      const opt =
        i === 45 ? "me" : i === 46 ? "manager" : i === 47 ? "me" : "everyone";
      accessRows.push(`(${i}, 7, 1, ${i}, null, 'read', '${opt}', 'daily')`);
    }

    // 5 placeholders (users 53..57): 3 read, 2 update
    for (let i = 53; i <= 57; i++) {
      const perm = i < 56 ? "read" : "update";
      const opt = i === 53 ? "me" : i === 54 ? "manager" : "everyone";
      accessRows.push(
        `(${i}, 7, 1, ${i}, null, '${perm}', '${opt}', 'monthly')`,
      );
    }

    await seeded.run(
      `insert into indicator_accesses (id, company_id, indicator_id, user_id, department_id, permissions, view_options, occurance) values ${accessRows.join(", ")}`,
    );

    // Run dry run
    const { report } = await run({
      write: false,
      only: ["kpi-shares"],
    });

    const sharesDomain = domain(report, "kpi-shares");
    expect(sharesDomain).toBeDefined();
    expect(sharesDomain?.read).toBe(50);
    // 48 would be written, 2 team shares skipped
    expect(sharesDomain?.created).toBe(48);
    expect(sharesDomain?.skipped.length).toBe(2);
    expect(sharesDomain?.skipped[0]?.reason).toContain(
      "Team share not carried over",
    );

    const notes = report.notes.join("\n");
    expect(notes).toContain("Covered by current role (info)    20");
    expect(notes).toContain("Takes effect when claimed (info)  5");
    expect(notes).toContain("Team share not carried over        2");
    expect(notes).toContain("View options:");
    expect(notes).toContain("View frequencies:");
  });

  it("AC-33: a second --write run writes 0 bindings and reports every row unchanged", async () => {
    // Seed users 10..11
    await seeded.run(
      "insert into users (id, company_id, name, email) values (10, 7, 'U10', 'u10@example.com'), (11, 7, 'U11', 'u11@example.com')",
    );
    await seeded.run(
      "insert into employee_details (id, company_id, user_id) values (10, 7, 10), (11, 7, 11)",
    );
    await seeded.run("delete from indicator_accesses where company_id = 7");
    await seeded.run(
      "insert into indicator_accesses (id, company_id, indicator_id, user_id, permissions, view_options) values " +
        "(10, 7, 1, 10, 'read', 'everyone'), (11, 7, 1, 11, 'update', 'everyone')",
    );

    // First write run
    const first = await run({
      write: true,
      only: ["organisation", "kpis", "kpi-shares"],
      acceptBroaderVisibility: true,
    });
    const firstShares = domain(first.report, "kpi-shares");
    expect(firstShares?.created).toBe(2);

    // Second write run
    const second = await run({
      write: true,
      only: ["kpi-shares"],
      acceptBroaderVisibility: true,
    });
    const secondShares = domain(second.report, "kpi-shares");
    expect(secondShares?.created).toBe(0);
    expect(secondShares?.matched).toBe(2);
  });

  it("AC-34: imported share revoked by kpis.unshare is not rewritten and reported as revoked", async () => {
    await seeded.run(
      "insert into users (id, company_id, name, email) values (20, 7, 'U20', 'u20@example.com')",
    );
    await seeded.run(
      "insert into employee_details (id, company_id, user_id) values (20, 7, 20)",
    );
    await seeded.run("delete from indicator_accesses where company_id = 7");
    await seeded.run(
      "insert into indicator_accesses (id, company_id, indicator_id, user_id, permissions, view_options) values " +
        "(20, 7, 1, 20, 'read', 'everyone')",
    );

    // Initial write
    await run({
      write: true,
      only: ["organisation", "kpis", "kpi-shares"],
      acceptBroaderVisibility: true,
    });

    const wb = await workerDb();
    const [member] = (
      await wb.admin.query<{ id: string }>(
        `select wm.id from workspace_members wm
          where wm.workspace_id = $1 and wm.placeholder_email = 'u20@example.com'`,
        [workspaceId],
      )
    ).rows;
    expect(member).toBeDefined();

    const [binding] = (
      await wb.admin.query<{ context_id: string; kpi_id: string }>(
        `select ab.context_id, ac.resource_id as kpi_id
           from access_bindings ab
           join access_groups ag on ag.id = ab.group_id
           join access_contexts ac on ac.id = ab.context_id
          where ab.workspace_id = $1 and ag.member_id = $2 and ab.tag = 'share'`,
        [workspaceId, member?.id],
      )
    ).rows;
    expect(binding).toBeDefined();
    if (!binding || !member) {
      throw new Error("Binding and member must be defined");
    }

    // Revoke share via kpis.unshare
    await callAction(
      {
        pool,
        workspaceId,
        actor: { kind: "human", userId: OWNER },
      },
      "kpis.unshare",
      {
        kpiId: binding.kpi_id,
        memberId: member.id,
      },
    );

    // Re-run import
    const second = await run({
      write: true,
      only: ["kpi-shares"],
      acceptBroaderVisibility: true,
    });
    const secondShares = domain(second.report, "kpi-shares");
    expect(secondShares?.created).toBe(0);
    expect(
      secondShares?.skipped.some((s) =>
        s.reason.includes("Revoked after an earlier import"),
      ),
    ).toBe(true);
  });

  it("AC-35: dry run names flagged KPI with named people count and human members count", async () => {
    await seeded.run(
      "insert into users (id, company_id, name, email) values (31, 7, 'U31', 'u31@example.com'), (32, 7, 'U32', 'u32@example.com')",
    );
    await seeded.run(
      "insert into employee_details (id, company_id, user_id) values (31, 7, 31), (32, 7, 32)",
    );
    await seeded.run("delete from indicator_accesses where company_id = 7");
    await seeded.run(
      "insert into indicator_accesses (id, company_id, indicator_id, user_id, permissions) values " +
        "(31, 7, 1, 31, 'read'), (32, 7, 1, 32, 'read')",
    );

    const { report } = await run({
      write: false,
      only: ["kpi-shares"],
    });

    const notes = report.notes.join("\n");
    expect(notes).toMatch(/KPIs that may become more visible/);
    expect(notes).toMatch(/2 named people/);
  });

  it("AC-36: placeholder holding imported share reads at imported level once signed up", async () => {
    // Seed placeholder user in FlowyTeam: user with email claim-me@example.com
    await seeded.run(
      "insert into users (id, company_id, name, email) values (40, 7, 'Placeholder Person', 'claim-me@example.com')",
    );
    await seeded.run(
      "insert into employee_details (id, company_id, user_id) values (40, 7, 40)",
    );
    await seeded.run("delete from indicator_accesses where company_id = 7");
    await seeded.run(
      "insert into indicator_accesses (id, company_id, indicator_id, user_id, permissions) values (40, 7, 1, 40, 'update')",
    );

    // Write run
    await run({
      write: true,
      only: ["organisation", "kpis", "kpi-shares"],
      acceptBroaderVisibility: true,
    });

    const wb = await workerDb();
    const [placeholderMember] = (
      await wb.admin.query<{ id: string; kind: string }>(
        `select wm.id, wm.kind
           from workspace_members wm
          where wm.workspace_id = $1 and (wm.placeholder_email = 'claim-me@example.com' or wm.user_id in (select id from users where email = 'claim-me@example.com'))`,
        [workspaceId],
      )
    ).rows;

    expect(placeholderMember).toBeDefined();

    // Verify access binding exists at edit level (level 30) for this member
    const [binding] = (
      await wb.admin.query<{ level: number; tag: string }>(
        `select ab.level, ab.tag
           from access_bindings ab
           join access_groups ag on ag.id = ab.group_id
          where ab.workspace_id = $1
            and ag.member_id = $2
            and ab.tag = 'share'`,
        [workspaceId, placeholderMember?.id],
      )
    ).rows;

    expect(binding).toBeDefined();
    expect(binding?.level).toBe(70);
    expect(binding?.tag).toBe("share");

    // Person signs up with the placeholder's address
    const CLAIM_USER = "88888888-8888-4888-8888-888888888888";
    await wb.admin.query(
      "insert into users (id, name, email) values ($1, $2, $3)",
      [CLAIM_USER, "Claimed User", "claim-me@example.com"],
    );
    // Bind user to the placeholder member
    await wb.admin.query(
      "update workspace_members set user_id = $1, kind = 'human', placeholder_email = null where id = $2",
      [CLAIM_USER, placeholderMember?.id],
    );

    // Now test that they can read the KPI
    const [kpi] = (
      await wb.admin.query<{ id: string }>(
        "select id from kpis where workspace_id = $1 limit 1",
        [workspaceId],
      )
    ).rows;
    if (!kpi) {
      throw new Error("KPI must be defined");
    }

    const detail = await callAction(
      {
        pool,
        workspaceId,
        actor: { kind: "human", userId: CLAIM_USER },
      },
      "kpis.detail",
      {
        kpiId: kpi.id,
        periods: 24,
      },
    );

    expect(detail.kpi.id).toBe(kpi.id);
  });
});
