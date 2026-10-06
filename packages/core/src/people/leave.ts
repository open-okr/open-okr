/**
 * A member's leave, read where the product decides who to ask (METHOD.md
 * §7.4, P9-T19b-b).
 *
 * `packages/method` decides who stands in for whom on a day. This is the half
 * that reads the leave rows, so the nudge run and a check-in's reviewer of
 * record start from the same ones.
 */
import { activeOnly, memberLeave, type WorkspaceTx } from "@openokr/db";
import { type Leave, standInFor } from "@openokr/method";
import { and, eq, gte, lte } from "drizzle-orm";

type AnyTx<TSchema extends Record<string, unknown> = Record<string, never>> =
  WorkspaceTx<TSchema>;

/** Every leave running on a local date, both ends included. */
export async function leavesOnInTx<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: AnyTx<TSchema>, workspaceId: string, on: string): Promise<Leave[]> {
  const rows = await tx
    .select({
      memberId: memberLeave.memberId,
      startsOn: memberLeave.startsOn,
      endsOn: memberLeave.endsOn,
      delegateId: memberLeave.delegateMemberId,
    })
    .from(memberLeave)
    .where(
      activeOnly(
        memberLeave,
        and(
          eq(memberLeave.workspaceId, workspaceId),
          lte(memberLeave.startsOn, on),
          gte(memberLeave.endsOn, on),
        ),
      ),
    );
  return rows;
}

/**
 * Who answers for a member on a local date: themselves, their delegate, or
 * nobody when every link in the chain is away.
 */
export async function standInOnInTx<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  workspaceId: string,
  memberId: string,
  on: string,
): Promise<string | null> {
  return standInFor(memberId, on, await leavesOnInTx(tx, workspaceId, on));
}
