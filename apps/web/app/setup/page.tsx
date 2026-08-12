import {
  databaseProbe,
  mailProbe,
  notInThisBuild,
  runConnectionTests,
} from "@openokr/core";
import { buttonVariants, cn } from "@openokr/ui";
import Link from "next/link";
import { getPool } from "../../lib/auth";
import { getMailSettings, mailerFrom } from "../../lib/mail";
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

  // Mail is tested as it is actually resolved: an operator who set
  // OPENOKR_MAIL_HOST in their compose override gets a live connection test
  // against it, right here, before anything depends on it. With nothing
  // configured, the console default reports itself honestly.
  const mail = await getMailSettings();

  const tests = await runConnectionTests([
    databaseProbe(pool),
    mailProbe({
      configured: mail.transport === "smtp",
      verify: () => mailerFrom(mail).verify(),
      host: mail.host,
    }),
    notInThisBuild("channel", "Phase 5"),
    notInThisBuild("ai", "Phase 6"),
  ]);

  return (
    <>
      <h1 className="text-lg font-bold text-ink">Set up OpenOKR</h1>
      <p className="text-sm text-ink-3">
        Nothing here needs configuring. Every setting has a working default, so
        you can create your account and start. You can change any of it later.
      </p>

      <h2 className="mt-2 text-xs font-bold tracking-wide text-ink-4 uppercase">
        This deployment
      </h2>
      <CheckList tests={tests} />

      <Link
        href="/setup/account"
        className={cn(buttonVariants({ variant: "primary" }), "self-start")}
      >
        Create the first account
      </Link>
    </>
  );
}
