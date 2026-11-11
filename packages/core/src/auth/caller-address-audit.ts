/**
 * When the reading of the caller's address changed, on the instance chain
 * (docs/design/trusted-proxies.md D11, plan 0.8.0 H2).
 *
 * The reading decides whether every per-address limit works, so "when did that
 * change" belongs on the chain. It comes from the environment, so the change
 * is seen at boot: each process compares the newest row with its own reading
 * and appends one only when they differ. The first boot after the upgrade
 * records the starting point.
 *
 * The comparison and the append run under the chain's own lock, in one
 * transaction, so replicas booting together write one row between them. There
 * is no actor: the deployment changed it, which the row says by naming none.
 */
import type { CallerAddressReading } from "@openokr/config";
import { instanceAuditEvents, withInstanceAdmin } from "@openokr/db";
import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { canonicalJson } from "../audit/chain.ts";
import {
  appendInstanceAuditInTx,
  lockInstanceChain,
} from "../audit/instance-chain.ts";

const ACTION = "instance.caller_address_configured";

/** The row's payload: every field present, the ranges sorted (D11). */
function payloadOf(reading: CallerAddressReading): Record<string, unknown> {
  return {
    mode: reading.mode,
    trustedProxies:
      reading.mode === "trusted_proxies"
        ? [...reading.trustedProxies].sort()
        : [],
    header: reading.mode === "header" ? reading.header : null,
    // The hop count is a reading too (combined with the hardening batch on
    // 11 November 2026), so going from one proxy to two is a change.
    hops: reading.mode === "proxy_hops" ? reading.hops : null,
  };
}

/**
 * Appends `instance.caller_address_configured` when the reading differs from
 * the newest one recorded, or when none is.
 */
export async function recordCallerAddressReading(
  pool: Pool,
  reading: CallerAddressReading,
): Promise<"recorded" | "unchanged"> {
  const payload = payloadOf(reading);
  return withInstanceAdmin(drizzle(pool), async (tx) => {
    await lockInstanceChain(tx);
    const [newest] = await tx
      .select({ payload: instanceAuditEvents.payload })
      .from(instanceAuditEvents)
      .where(eq(instanceAuditEvents.action, ACTION))
      .orderBy(desc(instanceAuditEvents.seq))
      .limit(1);
    if (
      newest !== undefined &&
      canonicalJson(newest.payload) === canonicalJson(payload)
    ) {
      return "unchanged";
    }
    await appendInstanceAuditInTx(tx, { action: ACTION, payload });
    return "recorded";
  });
}
