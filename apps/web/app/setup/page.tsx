import {
  databaseProbe,
  mailProbe,
  notInThisBuild,
  runConnectionTests,
} from "@openokr/core";
import Link from "next/link";
import { getPool } from "../../lib/auth";
import { CheckList } from "./check-list";

/**
 * The first-run wizard, step one: what this instance looks like right now
 * (P1-T09).
 *
 * The wizard confirms rather than demands. Every setting already has a working
 * default from the §4.14 map, so this page reports what is true and offers to
 * change it, which is why an operator can finish in a few clicks.
 *
 * The connection tests run here rather than behind a button so the operator
 * sees the state of their deployment on the first screen they land on. A
 * failing database is the only thing that blocks finishing.
 */
export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const pool = getPool();

  const tests = await runConnectionTests([
    databaseProbe(pool),
    // Mail is not configured yet at this point in the wizard: this reports
    // the honest default rather than testing a server nobody has named.
    mailProbe({ configured: false }),
    notInThisBuild("channel", "Phase 5"),
    notInThisBuild("ai", "Phase 6"),
  ]);

  return (
    <>
      <h1>Set up OpenOKR</h1>
      <p>
        Nothing here needs configuring. Every setting has a working default, so
        you can create your account and start. You can change any of it later.
      </p>

      <h2>This deployment</h2>
      <CheckList tests={tests} />

      <p>
        <Link href="/setup/account">Create the first account</Link>
      </p>
    </>
  );
}
