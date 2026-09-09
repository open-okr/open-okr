import {
  databaseProbe,
  mailProbe,
  notInThisBuild,
  runConnectionTests,
  storageProbe,
} from "@openokr/core";
import { buttonVariants, cn } from "@openokr/ui";
import Link from "next/link";
import { getPool } from "../../lib/auth";
import { getMailSettings, mailerFrom } from "../../lib/mail";
import { getStorage, storageDescription } from "../../lib/storage";
import { getTranslations } from "../../lib/translations";
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
  const { t } = await getTranslations();

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
    // Storage is tested by writing and removing a probe object (P6-G05).
    // A read would prove nothing an operator cares about: the failures worth
    // catching are an unwritable directory, a bucket that does not exist and a
    // key pair that cannot put, and all three otherwise surface as a broken
    // upload weeks later.
    storageProbe({
      describe: () => storageDescription(),
      verify: async () => {
        const key = `setup-probe/${crypto.randomUUID()}`;
        await getStorage().put(key, Buffer.from("openokr"));
        await getStorage().delete(key);
      },
    }),
    notInThisBuild("channel", "Phase 5"),
    notInThisBuild("ai", "Phase 6"),
  ]);

  return (
    <>
      <h1 className="text-lg font-bold text-ink">{t("setup.setUpOpenokr")}</h1>
      <p className="text-sm text-ink-3">
        {t("setup.nothingHereNeedsConfiguring")}
      </p>

      <h2 className="mt-2 text-xs font-bold tracking-wide text-ink-4 uppercase">
        {t("setup.thisDeployment")}
      </h2>
      <CheckList tests={tests} />

      <Link
        href="/setup/account"
        className={cn(buttonVariants({ variant: "primary" }), "self-start")}
      >
        {t("common.createTheFirstAccount")}
      </Link>
    </>
  );
}
