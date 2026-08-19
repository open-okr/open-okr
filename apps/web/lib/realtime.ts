/**
 * Process-wide realtime adapter (PLAN.md §7, P4-T07a).
 *
 * The Postgres realtime driver keeps a dedicated LISTEN connection — it cannot
 * share a pool client because LISTEN persists for the lifetime of the
 * connection. Cached on `globalThis` for the same reason as `getPool()`:
 * Next.js reloads modules in development and would otherwise open a new
 * connection on every reload.
 *
 * The driver is lazily initialised: importing this module does not open a
 * connection until the first `getRealtime()` call.
 */

import type { Realtime } from "@openokr/adapters";
import { PostgresRealtime } from "@openokr/adapters";
import { loadEnv } from "@openokr/config";

const globals = globalThis as typeof globalThis & {
  openokrRealtime?: Realtime;
};

export function getRealtime(): Realtime {
  globals.openokrRealtime ??= new PostgresRealtime({
    connectionOptions: {
      connectionString: loadEnv().DATABASE_URL,
    },
  });
  return globals.openokrRealtime;
}
