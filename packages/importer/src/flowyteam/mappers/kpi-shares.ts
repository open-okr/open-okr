/**
 * FlowyTeam KPI shares into OpenOKR access bindings (TECHNICAL-PLAN §7.2, 0.10.0 K8).
 *
 * Maps `indicator_accesses` rows to `kpi` context `share` bindings through
 * `kpis.importShare`.
 */
import {
  ACCESS_LEVELS,
  type ActionCallContext,
  callAction,
} from "@openokr/core";
import { introspectIndicatorAccesses } from "../introspect.ts";
import type { Source } from "../source.ts";
import { type DomainReconciliation, DomainTally } from "./reconcile.ts";
import type { Resolver } from "./resolve.ts";
import { withWorkspaceQuery } from "./workspace-query.ts";

export interface KpiSharesResult {
  readonly domains: readonly DomainReconciliation[];
  readonly notes: readonly string[];
  readonly flaggedCount: number;
}

interface MapperOptions {
  readonly source: Source;
  readonly context: ActionCallContext;
  readonly companyId: number;
  readonly resolver: Resolver;
  readonly actingMemberId: string;
  readonly write: boolean;
}

interface SourceAccessRow {
  readonly id?: number;
  readonly company_id: number;
  readonly indicator_id: number;
  readonly user_id: number | null;
  readonly department_id: number | null;
  readonly permissions: string | null;
  readonly view_options: string | null;
  readonly occurance: string | null;
  readonly deleted_at?: string | null;
}

interface FlaggedIndicator {
  readonly id: number;
  readonly title: string;
  readonly named_people: number;
}

/** What a dry run resolves to, as `resolve.ts` plans it. */
const PLANNED = "planned-by-a-dry-run";

/**
 * The source user who will own a KPI a dry run has only planned, read the way
 * `kpis.ts` reads it. A source id rather than a target one, because in a dry
 * run every planned member resolves to the same placeholder. Undefined for a
 * KPI owned by a space, the workspace, or an owner that no longer exists.
 */
async function plannedOwnerUser(
  options: MapperOptions,
  indicatorId: number,
): Promise<number | undefined> {
  const [indicator] = await options.source.query<{
    model_id: number | null;
    model_type: string | null;
  }>("select model_id, model_type from indicators where id = ?", [indicatorId]);
  if (
    indicator?.model_type !== "App\\Models\\EmployeeDetails" ||
    !indicator.model_id
  ) {
    return undefined;
  }
  const [employee] = await options.source.query<{ user_id: number | null }>(
    "select user_id from employee_details where id = ? and deleted_at is null",
    [indicator.model_id],
  );
  return employee?.user_id ?? undefined;
}

export async function importKpiShares(
  options: MapperOptions,
): Promise<KpiSharesResult> {
  const tally = new DomainTally("KPI shares");
  const cols = await introspectIndicatorAccesses(options.source);

  // 1. Read source rows
  const whereDeleted = cols.hasDeletedAt ? "and ia.deleted_at is null" : "";
  const orderCol = cols.hasId ? "ia.id" : "ia.indicator_id, ia.user_id";

  const rows = await options.source.query<SourceAccessRow>(
    `select ia.*
       from indicator_accesses ia
       join indicators i on i.id = ia.indicator_id
      where i.company_id = ?
        and i.deleted_at is null
        ${whereDeleted}
      order by ${orderCol}`,
    [options.companyId],
  );

  let writtenAtView = 0;
  let writtenAtEdit = 0;
  let raised = 0;
  let unchanged = 0;
  let coveredByRole = 0;
  let takesEffectWhenClaimed = 0;
  let revoked = 0;
  let kpiNotImported = 0;
  let personNotImported = 0;
  let teamSharesNotCarried = 0;

  const viewOptionsCounts = new Map<string, number>();
  const viewFrequenciesCounts = new Map<string, number>();
  const nonEveryoneRows: Array<{
    indicatorId: number;
    userId: number;
    option: string;
  }> = [];

  // 2. Count active human members in target workspace
  const humanMemberRows = await withWorkspaceQuery<{ n: string }>(
    options.context.pool,
    options.context.workspaceId,
    `select count(*)::text as n
       from workspace_members
      where workspace_id = $1
        and kind = 'human'
        and status = 'active'
        and deleted_at is null`,
    [options.context.workspaceId],
  );
  const activeHumanMemberCount = Number(humanMemberRows[0]?.n ?? 0);

  // What this dry run would already have written, by KPI and person.
  const plannedPairs = new Map<string, number>();

  // 3. Process each row
  for (const row of rows) {
    tally.sawRow();

    if (row.view_options) {
      const opt = row.view_options.toLowerCase();
      viewOptionsCounts.set(opt, (viewOptionsCounts.get(opt) ?? 0) + 1);
      if (opt !== "everyone" && row.user_id !== null) {
        nonEveryoneRows.push({
          indicatorId: row.indicator_id,
          userId: row.user_id,
          option: row.view_options,
        });
      }
    }

    if (row.occurance) {
      const occ = row.occurance.toLowerCase();
      viewFrequenciesCounts.set(occ, (viewFrequenciesCounts.get(occ) ?? 0) + 1);
    }

    // Team share only (user_id is null, department_id is set)
    if (row.user_id === null && row.department_id !== null) {
      teamSharesNotCarried += 1;
      const teamSpaceId = await options.resolver.resolve(
        "teams",
        row.department_id,
      );
      const teamLabel = teamSpaceId ? ` (team space ${teamSpaceId})` : "";
      const sourceKey =
        cols.hasId && row.id !== undefined
          ? `indicator_accesses:${row.id}`
          : `indicator_accesses:${row.indicator_id}:dept_${row.department_id}`;
      tally.skip(sourceKey, `Team share not carried over${teamLabel}`);
      continue;
    }

    // Source legacy key
    const legacyKey: { type: "flowyteam"; id: string } = {
      type: "flowyteam",
      id:
        cols.hasId && row.id !== undefined
          ? `indicator_accesses:${row.id}`
          : `${row.indicator_id}:${row.user_id}`,
    };
    const sourceKey =
      cols.hasId && row.id !== undefined
        ? `indicator_accesses:${row.id}`
        : `indicator_accesses:${row.indicator_id}:${row.user_id}`;

    // Resolve indicator
    const kpiId = await options.resolver.resolve(
      "indicators",
      row.indicator_id,
    );
    if (!kpiId) {
      kpiNotImported += 1;
      tally.skip(sourceKey, "KPI not imported");
      continue;
    }

    // Resolve person
    if (row.user_id === null) {
      personNotImported += 1;
      tally.skip(sourceKey, "Person not imported");
      continue;
    }
    const memberId = await options.resolver.resolve("users", row.user_id);
    if (!memberId) {
      personNotImported += 1;
      tally.skip(sourceKey, "Person not imported");
      continue;
    }

    // Note department ignored if user_id & department_id both set
    if (row.department_id !== null) {
      tally.flag(sourceKey, "Department ignored");
    }

    const level =
      row.permissions === "read" ? ("view" as const) : ("edit" as const);
    const shareLevel =
      level === "edit" ? ACCESS_LEVELS.edit : ACCESS_LEVELS.view;

    // **The dry run counts what the write would, including this run's own
    // earlier rows.** Two source rows naming the same person on the same KPI
    // are one share: the write's second call finds the first one's binding and
    // reports it unchanged, or raised when it asks for more. And a share with
    // the KPI's own owner changes nothing, whether or not the KPI exists yet.
    // By source ids: in a dry run every planned KPI and member resolves to the
    // same placeholder, which would make every planned pair look like one.
    const pair = `${row.indicator_id}|${row.user_id}`;
    if (!options.write && (kpiId === PLANNED || memberId === PLANNED)) {
      if (
        kpiId === PLANNED &&
        (await plannedOwnerUser(options, row.indicator_id)) === row.user_id
      ) {
        unchanged += 1;
        tally.wrote(false);
        continue;
      }
      const earlier = plannedPairs.get(pair);
      if (earlier !== undefined) {
        if (earlier >= shareLevel) {
          unchanged += 1;
          tally.wrote(false);
        } else {
          raised += 1;
          plannedPairs.set(pair, shareLevel);
          tally.wrote(true);
        }
        continue;
      }
      plannedPairs.set(pair, shareLevel);
      if (level === "view") {
        writtenAtView += 1;
      } else {
        writtenAtEdit += 1;
      }
      tally.wrote(true);
      continue;
    }

    if (options.write) {
      const result = await callAction(options.context, "kpis.importShare", {
        kpiId,
        memberId,
        level,
        legacy: legacyKey,
      });

      if (result.outcome === "written") {
        if (level === "view") {
          writtenAtView += 1;
        } else {
          writtenAtEdit += 1;
        }
        tally.wrote(true);
      } else if (result.outcome === "raised") {
        raised += 1;
        tally.wrote(true);
      } else if (result.outcome === "unchanged") {
        unchanged += 1;
        tally.wrote(false);
      } else if (result.outcome === "revoked") {
        revoked += 1;
        tally.skip(sourceKey, "Revoked after an earlier import, left revoked");
      } else {
        console.log(
          "kpi-shares write outcome:",
          result.outcome,
          "for sourceKey:",
          sourceKey,
        );
      }

      if (result.coveredByRole) {
        coveredByRole += 1;
      }

      // Check placeholder
      const targetMemberRows = await withWorkspaceQuery<{ kind: string }>(
        options.context.pool,
        options.context.workspaceId,
        "select kind from workspace_members where id = $1 and workspace_id = $2 and deleted_at is null",
        [memberId, options.context.workspaceId],
      );
      if (targetMemberRows[0]?.kind === "placeholder") {
        takesEffectWhenClaimed += 1;
      }
    } else {
      // Dry run simulation
      const targetMemberRows = await withWorkspaceQuery<{
        kind: string;
        status: string;
      }>(
        options.context.pool,
        options.context.workspaceId,
        "select kind, status from workspace_members where id = $1 and workspace_id = $2 and deleted_at is null",
        [memberId, options.context.workspaceId],
      );
      if (targetMemberRows[0]?.kind === "placeholder") {
        takesEffectWhenClaimed += 1;
      }

      const roleRows = await withWorkspaceQuery<{ level: number | null }>(
        options.context.pool,
        options.context.workspaceId,
        `select (
           select max(rp.level) from role_permissions rp
            where rp.workspace_id = m.workspace_id
              and rp.role_id = m.role_id
              and rp.domain = 'kpi'
              and rp.deleted_at is null
         )::int as level
          from workspace_members m
         where m.id = $1
           and m.workspace_id = $2
           and m.deleted_at is null`,
        [memberId, options.context.workspaceId],
      );
      const roleLevel = roleRows[0]?.level ?? null;
      if (roleLevel !== null && roleLevel >= shareLevel) {
        coveredByRole += 1;
      }

      const kpiRows = await withWorkspaceQuery<{ owner_member_id: string }>(
        options.context.pool,
        options.context.workspaceId,
        "select owner_member_id from kpis where id = $1 and workspace_id = $2 and deleted_at is null",
        [kpiId, options.context.workspaceId],
      );

      if (kpiRows[0]?.owner_member_id === memberId) {
        unchanged += 1;
        tally.wrote(false);
        continue;
      }

      const earlier = plannedPairs.get(pair);
      if (earlier !== undefined) {
        if (earlier >= shareLevel) {
          unchanged += 1;
          tally.wrote(false);
        } else {
          raised += 1;
          plannedPairs.set(pair, shareLevel);
          tally.wrote(true);
        }
        continue;
      }

      // Audit check
      const auditRows = await withWorkspaceQuery<{ id: string }>(
        options.context.pool,
        options.context.workspaceId,
        `select id
           from audit_events
          where workspace_id = $1
            and target_type = 'kpi'
            and target_id = $2
            and action = 'kpis.importShare'
            and payload->>'legacyId' = $3
          limit 1`,
        [options.context.workspaceId, kpiId, String(legacyKey.id)],
      );

      // Live binding check
      const bindingRows = await withWorkspaceQuery<{ level: number }>(
        options.context.pool,
        options.context.workspaceId,
        `select ab.level
           from access_bindings ab
           join access_groups ag on ag.id = ab.group_id
           join access_contexts ac on ac.id = ab.context_id
          where ab.workspace_id = $1
            and ac.resource_type = 'kpi'
            and ac.resource_id = $2
            and ab.tag = 'share'
            and ag.member_id = $3
            and ab.deleted_at is null
          limit 1`,
        [options.context.workspaceId, kpiId, memberId],
      );

      if (auditRows.length === 0) {
        if (bindingRows.length === 0) {
          plannedPairs.set(pair, shareLevel);
          if (level === "view") {
            writtenAtView += 1;
          } else {
            writtenAtEdit += 1;
          }
          tally.wrote(true);
        } else if ((bindingRows[0]?.level ?? 0) < shareLevel) {
          plannedPairs.set(pair, shareLevel);
          raised += 1;
          tally.wrote(true);
        } else {
          unchanged += 1;
          tally.wrote(false);
        }
      } else {
        if (bindingRows.length > 0) {
          unchanged += 1;
          tally.wrote(false);
        } else {
          revoked += 1;
          tally.skip(
            sourceKey,
            "Revoked after an earlier import, left revoked",
          );
        }
      }
    }
  }

  // 4. Restriction detection (§8.4)
  const flaggedKpis = await options.source.query<FlaggedIndicator>(
    `select i.id, i.title, count(distinct ia.user_id) as named_people
       from indicators i
       join indicator_accesses ia on ia.indicator_id = i.id
      where i.company_id = ?
        and i.deleted_at is null
        ${whereDeleted}
        and ia.user_id is not null
      group by i.id, i.title
      order by i.id`,
    [options.companyId],
  );

  for (const flagged of flaggedKpis) {
    tally.flag(
      `indicators:${flagged.id}`,
      `May become more visible: ${flagged.named_people} named people, ${activeHumanMemberCount} active human members will read it`,
    );
  }

  // 5. Construct dry-run notes block (§8.5)
  const viewOptionsSummary = [...viewOptionsCounts.entries()]
    .map(([opt, count]) => `${opt} ${count}`)
    .join(", ");
  const viewFrequenciesSummary = [...viewFrequenciesCounts.entries()]
    .map(([freq, count]) => `${freq} ${count}`)
    .join(", ");

  const blockLines = [
    "KPI shares (indicator_accesses)",
    `  Rows read                         ${rows.length}`,
    `  Would write at view               ${writtenAtView}`,
    `  Would write at edit               ${writtenAtEdit}`,
    `  Would raise a manual share         ${raised}`,
    `  Unchanged (owner or same level)    ${unchanged}`,
    `  Covered by current role (info)    ${coveredByRole}`,
    `  Takes effect when claimed (info)  ${takesEffectWhenClaimed}`,
    `  Revoked after an earlier import    ${revoked}`,
    `  KPI not imported                   ${kpiNotImported}`,
    `  Person not imported                ${personNotImported}`,
    `  Team share not carried over        ${teamSharesNotCarried}`,
    `  View options: ${viewOptionsSummary || "none"}`,
    `  View frequencies: ${viewFrequenciesSummary || "none"}`,
    `  KPIs that may become more visible: ${flaggedKpis.length} (listed below)`,
  ];

  const notes: string[] = [blockLines.join("\n")];

  if (flaggedKpis.length > 0) {
    notes.push(
      `KPIs that may become more visible (${flaggedKpis.length}):\n` +
        flaggedKpis
          .map(
            (k) =>
              `  - KPI "${k.title}" (${k.id}): ${k.named_people} named people, ${activeHumanMemberCount} active human members will read it`,
          )
          .join("\n"),
    );
  }

  return {
    domains: [tally.finish()],
    notes,
    flaggedCount: flaggedKpis.length,
  };
}
