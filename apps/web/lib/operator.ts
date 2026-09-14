import { isCloudEnabled, isLiveOperator } from "@openokr/core";
import { notFound } from "next/navigation";
import { getPool } from "./pool";
import { requireSession } from "./session";

/**
 * The cloud operator console's route guard (P8-T03b, screens S-45 to S-47).
 *
 * Three things have to hold, and failing any of them gives the same answer:
 * not-found. Not "forbidden", and not a hidden menu item over a route that
 * still answers. A self-hosted instance should not advertise a door it will
 * not open, and a signed-in member who is not an operator should not learn
 * that an operator console exists.
 *
 * That matches what `requireAccessLevel` already does for the admin routes
 * and what the access getter does everywhere: a denied route is never an
 * oracle for what exists.
 */
export interface CurrentOperator {
  readonly userId: string;
  readonly name: string;
}

export async function requireOperator(): Promise<CurrentOperator> {
  const session = await requireSession();
  const pool = getPool();

  // 1. A cloud instance. On a self-hosted one there are no tenants to
  //    operate and the console is absent rather than empty.
  if (!(await isCloudEnabled(pool))) {
    notFound();
  }

  // 2. A live grant, read on this request rather than trusted from the
  //    session. Revoking an operator takes effect on their next page load,
  //    not at their next sign-in, and the database policy behind this makes
  //    the same check on every query underneath.
  if (!(await isLiveOperator(pool, session.user.id))) {
    notFound();
  }

  return { userId: session.user.id, name: session.user.name };
}
