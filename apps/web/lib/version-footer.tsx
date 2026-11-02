import { outboundFetch } from "@openokr/adapters";
import { ACCESS_LEVELS, isCloudEnabled, readUpdateCheck } from "@openokr/core";
import { RUNNING_VERSION } from "./app-version.ts";
import { getPool } from "./pool";
import { getTranslations } from "./translations";
import { createUpdateChecker, isBehind } from "./update-check.ts";

/**
 * The sidebar footer: the running version, and the newest release when this
 * instance is behind it (docs/design/version-footer.md §3).
 *
 * **Administrators only.** A version string is reconnaissance, which is why
 * `/api/app-version` sits behind a session; here it sits behind `full` as
 * well, the admin screens' own gate, because only an administrator can act
 * on it.
 *
 * **One checker per process**, so the cache is shared by every request.
 */
const checker = createUpdateChecker({
  fetch: (url, options) => outboundFetch(url, options),
  now: () => Date.now(),
});

export async function VersionFooter({ level }: { readonly level: number }) {
  if (level < ACCESS_LEVELS.full) {
    return null;
  }
  const { t } = await getTranslations();
  const pool = getPool();

  // A managed cloud is upgraded by its operator, so it never asks; a read
  // that fails is treated as off, which sends nothing.
  const cloud = await isCloudEnabled(pool).catch(() => true);
  const enabled =
    !cloud && (await readUpdateCheck(pool).catch(() => null))?.value === true;
  const latest = enabled ? checker.latest() : null;
  const newer =
    latest && isBehind(RUNNING_VERSION, latest.version) ? latest : null;

  const running = t("shell.version.running", { version: RUNNING_VERSION });
  const available = newer
    ? t("shell.version.available", { version: newer.version })
    : null;

  return (
    <div data-testid="version-footer" className="px-2 pb-1 text-xs text-ink-4">
      {/* Labelled from 1280 px, as the sidebar's rows are. */}
      <div className="hidden xl:block">
        <div>{running}</div>
        {newer && available ? (
          <a
            href={newer.url}
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-brand-text underline"
          >
            {available}
          </a>
        ) : null}
      </div>
      {newer && available ? (
        <a
          href={newer.url}
          target="_blank"
          rel="noreferrer"
          title={`${running}. ${available}`}
          className="mx-auto block size-2 rounded-full bg-brand xl:hidden"
        >
          <span className="sr-only">{`${running}. ${available}`}</span>
        </a>
      ) : null}
    </div>
  );
}
