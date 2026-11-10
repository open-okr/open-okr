import { ACCESS_LEVELS, isCloudEnabled } from "@openokr/core";
import { RUNNING_VERSION } from "./app-version.ts";
import { releaseCheck } from "./newest-release.ts";
import { getPool } from "./pool";
import { getTranslations } from "./translations";

/**
 * The content footer, on the right: the running version, and the newest
 * release when this instance is behind it (docs/design/version-footer.md §3).
 *
 * **The version is for every signed-in member** (plan 0.8.0 V1, Q7). It was
 * administrators only, which hid it on every OKRGoal instance from the people
 * reporting a problem and the people reading the release notes. It is still
 * never shown signed out, where it would tell anybody scanning for instances
 * behind a known fault which ones are.
 *
 * **The notice is for administrators only**, because only they can act on it,
 * and never on a managed cloud, where the operator upgrades and is told on the
 * console instead (V2).
 */
export async function VersionFooter({ level }: { readonly level: number }) {
  const { t } = await getTranslations();

  let newer = null;
  if (level >= ACCESS_LEVELS.full) {
    const pool = getPool();
    // A read that fails is treated as a cloud, which sends nothing.
    const cloud = await isCloudEnabled(pool).catch(() => true);
    newer = cloud ? null : (await releaseCheck(pool)).newer;
  }

  const running = t("shell.version.running", { version: RUNNING_VERSION });
  const available = newer
    ? t("shell.version.available", { version: newer.version })
    : null;

  return (
    <span
      data-testid="version-footer"
      className="inline-flex flex-wrap items-center gap-x-3.5 gap-y-1"
    >
      <span className="tabular-nums">{running}</span>
      {newer && available ? (
        <a
          href={newer.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-5 items-center gap-1.5 rounded-full bg-brand-weak px-2 font-semibold text-brand-text hover:underline"
        >
          <span aria-hidden="true" className="size-1.5 rounded-full bg-brand" />
          {available}
        </a>
      ) : null}
    </span>
  );
}
