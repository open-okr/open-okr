/**
 * The trial sweep (docs/design/tenant-lifecycle.md §11, plan 0.7.0 P4,
 * approved by Akmal on 9 November 2026).
 *
 * **A trial is a catalogue plan with an end date and no subscription** (T1).
 * It gates nothing. When the date passes, the sweep applies the rule
 * billing.md §6 uses for a subscription that ends (T5):
 *
 * | The workspace | Becomes |
 * |---|---|
 * | Has a live subscription | Unchanged; only the date is cleared |
 * | Its people fit the default plan | On the default plan, still active |
 * | Its people do not fit | Read-only, `suspended_by_trial`, nobody suspended |
 *
 * "The product never chooses who loses access" (billing.md §1), so the third
 * row is read-only rather than anybody removed. The customer leaves it the way
 * they leave billing's: subscribe, or make the people fit and press Settle.
 *
 * Self-hosted is untouched (T12): with the cloud flag off this returns before
 * reading anything.
 */
import {
  activeOnly,
  billingAccounts,
  tenants,
  withInstanceAdmin,
  withWorkspace,
} from "@openokr/db";
import { and, eq, isNull, lte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { LIVE_STATUSES } from "../billing/webhook.ts";
import { type OperationTx, runOperation } from "../operations/operation.ts";
import { setTenantStateInTx } from "./lifecycle.ts";
import {
  applyPlanInTx,
  type Plan,
  resolveDefaultPlan,
  seatsInUseInTx,
} from "./plans.ts";
import { isCloudEnabled } from "./settings.ts";

/** What a trial ending did to its workspace. */
type TrialOutcome = "subscribed" | "moved" | "suspended";

export interface DueTrial {
  readonly workspaceId: string;
  readonly trialEndsAt: Date;
  /** What the sweep would do now, for `pnpm cloud:trials` without `--write`. */
  readonly outcome: TrialOutcome;
  readonly people: number;
}

/** Thrown inside the Operation when another run settled it first. */
class AlreadySettled extends Error {}

/** Whether a live subscription carries the workspace, whatever the trial says. */
async function hasLiveSubscription(
  tx: OperationTx,
  workspaceId: string,
): Promise<boolean> {
  const [account] = await tx
    .select({ status: billingAccounts.status })
    .from(billingAccounts)
    .where(
      activeOnly(billingAccounts, eq(billingAccounts.workspaceId, workspaceId)),
    )
    .limit(1);
  return account?.status != null && LIVE_STATUSES.has(account.status);
}

/** T5's table, decided from the rows as they are inside the transaction. */
async function decide(
  tx: OperationTx,
  workspaceId: string,
  defaultPlan: Plan | null,
): Promise<{ readonly outcome: TrialOutcome; readonly people: number }> {
  const people = await seatsInUseInTx(tx, workspaceId);
  if (await hasLiveSubscription(tx, workspaceId)) {
    return { outcome: "subscribed", people };
  }
  // No default plan configured is no plan and no limit, so everybody fits.
  const seats = defaultPlan?.seats ?? null;
  return {
    outcome: seats !== null && people > seats ? "suspended" : "moved",
    people,
  };
}

/** Active tenants whose trial has ended and that erasure has not claimed. */
async function listDue(
  pool: Pool,
  now: Date,
): Promise<readonly { workspaceId: string; trialEndsAt: Date }[]> {
  const rows = await withInstanceAdmin(drizzle(pool), (tx) =>
    tx
      .select({
        workspaceId: tenants.workspaceId,
        trialEndsAt: tenants.trialEndsAt,
      })
      // openokr:allow-raw-read: there is no acting member here, and a dated
      // sweep has to find which tenants are due before it can scope anything,
      // as `remindBeforeErasure` does. Ids and dates only.
      .from(tenants)
      .where(
        activeOnly(
          tenants,
          and(
            eq(tenants.state, "active"),
            isNull(tenants.erasingAt),
            lte(tenants.trialEndsAt, now),
          ),
        ),
      ),
  );
  return rows.flatMap((row) =>
    row.trialEndsAt
      ? [{ workspaceId: row.workspaceId, trialEndsAt: row.trialEndsAt }]
      : [],
  );
}

/**
 * Ends one workspace's trial, in its own Operation as `system` (T4, T6).
 *
 * The tenant row is re-read and locked first, so two scheduler replicas
 * cannot settle one trial twice: the second finds the date already cleared.
 */
async function endTrial(
  pool: Pool,
  workspaceId: string,
  input: { readonly now: Date; readonly defaultPlan: Plan | null },
): Promise<TrialOutcome> {
  return runOperation(
    { pool },
    {
      action: "workspace.endTrial",
      workspaceId,
      // Nobody is acting: the date arrived.
      actor: { kind: "system" },
      bootstrap: true,
      async execute({ tx, workspaceId: id }) {
        const [locked] = await tx
          .select({
            trialEndsAt: tenants.trialEndsAt,
            planKey: tenants.planKey,
          })
          .from(tenants)
          .where(
            activeOnly(
              tenants,
              and(
                eq(tenants.workspaceId, id),
                eq(tenants.state, "active"),
                isNull(tenants.erasingAt),
                lte(tenants.trialEndsAt, input.now),
              ),
            ),
          )
          .for("update")
          .limit(1);
        if (!locked) {
          throw new AlreadySettled();
        }

        const { outcome, people } = await decide(tx, id, input.defaultPlan);
        if (outcome === "moved") {
          await applyPlanInTx(tx, { workspaceId: id, plan: input.defaultPlan });
        } else if (outcome === "suspended") {
          await setTenantStateInTx(tx, {
            workspaceId: id,
            state: "suspended",
            now: input.now,
          });
        }
        // openokr:allow-mutation: this Operation's own transaction. A past
        // date is not a state (§2), so clearing it is what makes the next
        // pass find nothing; the flag is set after the move, which clears it.
        await tx
          .update(tenants)
          .set({
            trialEndsAt: null,
            trialRemindedAt: null,
            suspendedByTrial: outcome === "suspended",
            updatedAt: input.now,
          })
          .where(activeOnly(tenants, eq(tenants.workspaceId, id)));

        const planKey =
          outcome === "moved"
            ? (input.defaultPlan?.key ?? null)
            : locked.planKey;
        return {
          result: outcome,
          activity: {
            kind: "workspace.trial_ended",
            subjectType: "workspace",
            subjectId: id,
            payload: {
              outcome,
              plan:
                outcome === "moved"
                  ? (input.defaultPlan?.name ?? "Free")
                  : null,
            },
          },
          audit: {
            action: "workspace.endTrial",
            targetType: "workspace",
            targetId: id,
            payload: { outcome, planKey, people },
          },
        };
      },
    },
  );
}

/**
 * Every trial that is due, and what ending it would do now (T11). Nothing with
 * the cloud flag off.
 */
export async function dueTrials(
  pool: Pool,
  options: { readonly now?: Date } = {},
): Promise<readonly DueTrial[]> {
  if (!(await isCloudEnabled(pool))) {
    return [];
  }
  const now = options.now ?? new Date();
  const defaultPlan = await resolveDefaultPlan(pool);
  const due: DueTrial[] = [];
  for (const row of await listDue(pool, now)) {
    const decided = await withWorkspace(drizzle(pool), row.workspaceId, (tx) =>
      decide(tx as unknown as OperationTx, row.workspaceId, defaultPlan),
    );
    due.push({ ...row, ...decided });
  }
  return due;
}

/**
 * Ends every trial past its date (T4). Run hourly by the scheduler as
 * `cloud.sweepTrials`, and by `pnpm cloud:trials --write`. Returns what was
 * due and how many this run ended; a trial another run settled first is not
 * counted.
 */
export async function sweepTrials(
  pool: Pool,
  options: { readonly now?: Date } = {},
): Promise<{ readonly due: readonly DueTrial[]; readonly ended: number }> {
  const due = await dueTrials(pool, options);
  if (due.length === 0) {
    return { due, ended: 0 };
  }
  const now = options.now ?? new Date();
  const defaultPlan = await resolveDefaultPlan(pool);
  let ended = 0;
  for (const trial of due) {
    try {
      await endTrial(pool, trial.workspaceId, { now, defaultPlan });
      ended += 1;
    } catch (error) {
      if (!(error instanceof AlreadySettled)) {
        throw error;
      }
    }
  }
  return { due, ended };
}
