import type { CloudPreflightWarning } from "@openokr/core";
import { getTranslations } from "../../../lib/translations";

/**
 * What the managed cloud is still missing, above the instance flags on S-47.
 *
 * Warnings only. Each names one setting that works with its default and that a
 * public cloud rarely wants left there. Nothing here blocks anything.
 */
const KEYS: Record<CloudPreflightWarning, string> = {
  mail_console: "operator.instance.preflight.mailConsole",
  terms_missing: "operator.instance.preflight.termsMissing",
  privacy_missing: "operator.instance.preflight.privacyMissing",
  retention_zero: "operator.instance.preflight.retentionZero",
};

export async function PreflightNotice({
  warnings,
}: {
  warnings: readonly CloudPreflightWarning[];
}) {
  if (warnings.length === 0) {
    return null;
  }
  const { t } = await getTranslations();
  return (
    <section
      className="rounded-md border border-warn/30 bg-warn-bg p-4.5"
      data-testid="cloud-preflight"
    >
      <h2 className="text-sm font-bold text-ink">
        {t("operator.instance.preflight.title")}
      </h2>
      <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-5 text-sm text-ink-2">
        {warnings.map((warning) => (
          <li data-testid={`cloud-preflight-${warning}`} key={warning}>
            {t(KEYS[warning])}
          </li>
        ))}
      </ul>
    </section>
  );
}
