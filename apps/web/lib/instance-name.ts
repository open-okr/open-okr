import { deploymentInstanceName, resolveInstanceName } from "@openokr/core";
import { getPool } from "./pool";

/**
 * What this instance calls itself, for a server component, a route, a server
 * action, the relay or the scheduler (completeness review M-33).
 *
 * The stored name, then `OPENOKR_INSTANCE_NAME`, then "OpenOKR", through the
 * one reader in `packages/core`. Read per use rather than cached, for the
 * reason `getMailSettings` is: an administrator can rename the instance while
 * this process runs, and the next page, email and nudge should say so.
 *
 * **Never throws.** The reader already survives a database that does not
 * answer; this also survives an environment that cannot build a pool, which
 * is the state the root error page is shown in. A client component reads the
 * same value from `useInstanceName`, which the root layout provides.
 */
export async function getInstanceName(): Promise<string> {
  try {
    return await resolveInstanceName(getPool());
  } catch {
    return deploymentInstanceName();
  }
}
