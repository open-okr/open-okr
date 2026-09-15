import { createSiteMessage } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { requireOperator } from "../../../lib/operator";
import { getPool } from "../../../lib/pool";
import { getTranslations } from "../../../lib/translations";

/**
 * Writing a site message, on S-47 (P8-T03c).
 *
 * **The window is two required fields rather than an optional end date**, and
 * the form says why in one line rather than leaving somebody to discover the
 * refusal. A message with no end is a banner everybody learns to ignore, and
 * the next one is ignored with it.
 *
 * The grant is re-checked here rather than trusted from the page that
 * rendered the form, for the same reason the lifecycle control re-checks it: a
 * page rendered ten minutes ago is not evidence that the person is still an
 * operator.
 */
async function publish(formData: FormData): Promise<void> {
  "use server";
  const operator = await requireOperator();

  const targets = formData
    .getAll("target")
    .map(String)
    .filter((one) => one.length > 0);

  try {
    await createSiteMessage(getPool(), operator.userId, {
      body: String(formData.get("body") ?? ""),
      level: String(formData.get("level") ?? "info") as "info" | "warn" | "bad",
      startsAt: String(formData.get("startsAt") ?? ""),
      endsAt: String(formData.get("endsAt") ?? ""),
      targetWorkspaceIds: targets,
      dismissible: formData.get("dismissible") !== null,
    });
  } catch (error) {
    // A refusal is not a crash. An empty body or a backwards window reaches
    // here as a ZodError; the form re-renders with nothing written, which is
    // the honest result.
    if (error instanceof Error) {
      return;
    }
    throw error;
  }
  revalidatePath("/operator/instance");
}

export async function SiteMessageForm({
  workspaces,
}: {
  readonly workspaces: readonly {
    readonly id: string;
    readonly name: string;
  }[];
}) {
  const { t } = await getTranslations();

  return (
    <form
      action={publish}
      className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-4"
    >
      <div className="flex flex-col gap-1.5">
        <label className="font-medium text-ink text-sm" htmlFor="body">
          {t("operator.siteMessage.message")}
        </label>
        <textarea
          className="rounded-md border border-line bg-bg px-3 py-2 text-ink text-sm"
          id="body"
          maxLength={1000}
          name="body"
          placeholder={t("operator.siteMessage.placeholder")}
          required
          rows={3}
        />
        <p className="text-ink-3 text-xs">
          {t("operator.siteMessage.plainText")}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <label className="font-medium text-ink text-sm" htmlFor="level">
            {t("operator.siteMessage.tone")}
          </label>
          <select
            className="rounded-md border border-line bg-bg px-3 py-2 text-ink text-sm"
            defaultValue="info"
            id="level"
            name="level"
          >
            <option value="info">
              {t("operator.siteMessage.toneInformation")}
            </option>
            <option value="warn">
              {t("operator.siteMessage.toneWarning")}
            </option>
            <option value="bad">
              {t("operator.siteMessage.toneIncident")}
            </option>
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="font-medium text-ink text-sm" htmlFor="startsAt">
            {t("operator.siteMessage.showsFrom")}
          </label>
          <input
            className="rounded-md border border-line bg-bg px-3 py-2 text-ink text-sm"
            id="startsAt"
            name="startsAt"
            required
            type="datetime-local"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="font-medium text-ink text-sm" htmlFor="endsAt">
            {t("operator.siteMessage.stopsAt")}
          </label>
          <input
            className="rounded-md border border-line bg-bg px-3 py-2 text-ink text-sm"
            id="endsAt"
            name="endsAt"
            required
            type="datetime-local"
          />
          {/* Said once, here, rather than left for somebody to meet as a
           * refusal after typing everything else. */}
          <p className="text-ink-3 text-xs">
            {t("operator.siteMessage.endRequired")}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="font-medium text-ink text-sm">
          {t("operator.siteMessage.whoSeesIt")}
        </span>
        <p className="text-ink-3 text-xs">
          {t("operator.siteMessage.everybodyUnlessNamed")}
        </p>
        {workspaces.length > 0 ? (
          <div className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-md border border-line p-2">
            {workspaces.map((workspace) => (
              <label
                className="flex items-center gap-2 text-ink text-sm"
                htmlFor={`target-${workspace.id}`}
                key={workspace.id}
              >
                <input
                  id={`target-${workspace.id}`}
                  name="target"
                  type="checkbox"
                  value={workspace.id}
                />
                {workspace.name}
              </label>
            ))}
          </div>
        ) : null}
      </div>

      <label
        className="flex items-center gap-2 text-ink text-sm"
        htmlFor="dismissible"
      >
        <input
          defaultChecked
          id="dismissible"
          name="dismissible"
          type="checkbox"
        />
        {t("operator.siteMessage.canDismiss")}
      </label>

      <button
        className="self-start rounded-md bg-brand px-4 py-2 font-medium text-on-brand text-sm hover:bg-brand-strong"
        type="submit"
      >
        {t("operator.siteMessage.submit")}
      </button>
    </form>
  );
}
