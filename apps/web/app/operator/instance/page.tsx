import {
  INSTANCE_SETTINGS,
  listSiteMessages,
  listTenantsAsOperator,
  readInstanceFlags,
} from "@openokr/core";
import { Chip, type ChipProps } from "@openokr/ui";
import Link from "next/link";
import { requireOperator } from "../../../lib/operator";
import { getPool } from "../../../lib/pool";
import { getTranslations } from "../../../lib/translations";
import { SiteMessageForm } from "./site-message-form";

/**
 * S-47 Operator instance: what is true of the deployment rather than of one
 * customer (P8-T03c).
 *
 * Two things live here and they are different in kind, so they read
 * differently. **Flags are what the instance is**, and they are read-only on
 * this screen: every one is declared in `INSTANCE_SETTINGS` with a default
 * and a summary, and changing a mail host or a root key from a console is a
 * different task with a different blast radius. **Site messages are what the
 * vendor is saying**, and those are written here, because saying something is
 * the whole point of the screen.
 *
 * The flags list is derived from the registry rather than typed out, so a
 * setting added next month appears without anybody remembering, and one
 * removed stops appearing. A screen that lists settings by hand is a screen
 * that is wrong within a release.
 */
export const dynamic = "force-dynamic";

const LEVEL_TONE: Record<string, ChipProps["tone"]> = {
  info: "info",
  warn: "warn",
  bad: "bad",
};

function when(value: Date | string): string {
  return new Date(value).toISOString().replace("T", " ").slice(0, 16);
}

export default async function OperatorInstancePage() {
  const operator = await requireOperator();
  const pool = getPool();

  const [flags, messages, tenants] = await Promise.all([
    readInstanceFlags(pool),
    listSiteMessages(pool),
    listTenantsAsOperator(pool, operator.userId),
  ]);

  const now = Date.now();
  const { t } = await getTranslations();

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-8 sm:px-6">
      <Link
        className="w-fit text-ink-2 text-sm hover:text-ink hover:underline"
        href="/operator"
      >
        {t("operator.instance.back")}
      </Link>

      <header className="flex flex-col gap-1">
        <h1 className="font-bold text-ink text-xl">
          {t("operator.instance.title")}
        </h1>
        <p className="text-ink-2 text-sm">{t("operator.instance.intro")}</p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold text-ink text-sm">
          {t("operator.instance.saySomething")}
        </h2>
        <SiteMessageForm
          workspaces={tenants.map((tenant) => ({
            id: tenant.workspaceId,
            name: tenant.name,
          }))}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold text-ink text-sm">
          {t("operator.instance.messages")}
        </h2>
        {messages.length === 0 ? (
          // An empty screen is an invitation, not an error.
          <p className="rounded-lg border border-line bg-surface px-4 py-3 text-ink-2 text-sm">
            {t("operator.instance.noMessages")}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {messages.map((message) => {
              const live =
                new Date(message.startsAt).getTime() <= now &&
                new Date(message.endsAt).getTime() > now;
              const past = new Date(message.endsAt).getTime() <= now;
              return (
                <li
                  className="flex flex-col gap-2 rounded-lg border border-line bg-surface px-4 py-3"
                  key={message.id}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Chip tone={LEVEL_TONE[message.level] ?? "neutral"}>
                      {message.level}
                    </Chip>
                    {/* Live, over, or not yet. Three states an operator
                     * reads differently, and a date range alone makes
                     * somebody work them out. */}
                    <span className="text-ink-3 text-xs">
                      {live ? "showing now" : past ? "finished" : "scheduled"}
                    </span>
                    {message.targetWorkspaceIds ? (
                      <span className="text-ink-3 text-xs">
                        {message.targetWorkspaceIds.length === 1
                          ? "1 workspace"
                          : `${message.targetWorkspaceIds.length} workspaces`}
                      </span>
                    ) : (
                      <span className="text-ink-3 text-xs">
                        {t("operator.instance.everybody")}
                      </span>
                    )}
                  </div>
                  <p className={`text-sm ${past ? "text-ink-3" : "text-ink"}`}>
                    {message.body}
                  </p>
                  <p className="text-ink-3 text-xs">
                    {t("operator.instance.to", {
                      startsAt: when(message.startsAt),
                      endsAt: when(message.endsAt),
                      dismissible: message.dismissible
                        ? ""
                        : ", not dismissible",
                    })}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold text-ink text-sm">
          {t("operator.instance.flags")}
        </h2>
        {/* Read-only, deliberately. Every row is declared in the settings
         * registry with a default, and changing a mail host or a root key
         * from here is a different task with a different blast radius. */}
        <div className="overflow-hidden rounded-lg border border-line bg-surface">
          <table className="w-full border-collapse text-sm">
            <tbody>
              {flags.map((flag) => (
                <tr
                  className="border-line border-b last:border-b-0"
                  key={flag.key}
                >
                  <td className="px-4 py-2.5 align-top">
                    <span className="text-ink">{flag.key}</span>
                    <span className="block text-ink-3 text-xs">
                      {INSTANCE_SETTINGS.find((one) => one.key === flag.key)
                        ?.summary ?? ""}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right align-top">
                    <Chip tone={flag.value ? "ok" : "neutral"}>
                      {flag.value ? "on" : "off"}
                    </Chip>
                    <span className="block text-ink-3 text-xs">
                      {t("operator.instance.fromThe", { source: flag.source })}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-ink-3 text-xs">{t("operator.instance.readOnly")}</p>
      </section>
    </div>
  );
}
