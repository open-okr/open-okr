/**
 * Verifies the address of the account that claimed the instance (UAT
 * BUG-028).
 *
 * Before the fix, an instance with mail configured at its first run created
 * the setup wizard's account unverified. Verification is required whenever
 * mail can arrive, so that operator could never sign in again: every attempt
 * was refused with the same words as a wrong password. New instances create
 * the first account verified; this brings existing ones level.
 *
 * | Stored | This script |
 * |---|---|
 * | The earliest account, unverified | Verified. It is the one the wizard created |
 * | Any other account | Left alone. It proves its address through the link like anyone else |
 */
import type {
  DataChangeBatchResult,
  DataChangeClient,
  DataChangeScript,
} from "../data-change.ts";

export const verifyFirstAccount: DataChangeScript = {
  name: "0025_verify_first_account",
  summary:
    "Verifies the address of the account the setup wizard created, which could not sign in when mail was configured before the first run.",
  expects: [
    { table: "users", column: "email_verified", dataType: "boolean" },
    {
      table: "users",
      column: "created_at",
      dataType: "timestamp with time zone",
    },
  ],
  async runBatch(client: DataChangeClient): Promise<DataChangeBatchResult> {
    const { rows } = await client.query<{ n: number }>(
      `with first_account as (
         select id from users order by created_at, id limit 1
       ), verified as (
         update users
            set email_verified = true, updated_at = now()
          where id in (select id from first_account)
            and email_verified = false
          returning 1
       )
       select count(*)::int as n from verified`,
    );
    return { done: true, rowsChanged: rows[0]?.n ?? 0 };
  },
};
