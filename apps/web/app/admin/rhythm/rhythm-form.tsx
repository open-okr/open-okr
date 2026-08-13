import { callAction, OperationError } from "@openokr/core";
import { Button, Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import { revalidatePath } from "next/cache";
import { getPool } from "../../../lib/auth";
import { requireWorkspace } from "../../../lib/workspace";

/**
 * Editing the §11 registry for one workspace (P3-T02).
 *
 * Two things this form deliberately does not do. It does not invent a field for
 * a parameter the registry does not declare, because it is generated from the
 * registry. And it does not offer inline editing for a composite parameter (a
 * ladder, a band set, a bounds pair): those are edited as a whole object, no
 * screen in UIUX-PLAN.md §4 specifies how yet, and a half-set ladder is worse
 * than an unset one. They render read-only with their resolved value, so an
 * admin can at least see what is in force.
 */

type Rhythm = Awaited<ReturnType<typeof callAction<"rhythm.read">>>;

const GROUP_TITLES: Record<string, string> = {
  cadence: "Cadence and escalation",
  scoring: "Confidence and scoring",
  quality: "Quality and planning",
  alignment: "Alignment",
  kpi: "KPIs and recovery",
  sessions: "Sessions",
};

async function save(formData: FormData): Promise<void> {
  "use server";

  const { session, workspace } = await requireWorkspace();

  const overrides: Record<string, unknown> = {};
  const labels: Record<string, { singular: string; plural: string }> = {};

  for (const [field, raw] of formData.entries()) {
    const value = String(raw);

    if (field.startsWith("threshold:")) {
      const key = field.slice("threshold:".length);
      // Empty means "return this one to the canon", which the action reads as
      // null. A blank field is the only way to un-set a threshold.
      overrides[key] = value.trim() === "" ? null : Number(value);
      continue;
    }
    if (field.startsWith("label:")) {
      const [, term, form] = field.split(":");
      if (!term || !form) {
        continue;
      }
      const existing = labels[term] ?? { singular: "", plural: "" };
      labels[term] = { ...existing, [form]: value.trim() };
    }
  }

  // Only send a rename where both forms were filled in. A partial one is
  // refused by the action anyway, and sending it would fail the whole save for
  // a row the admin never meant to touch.
  const renames = Object.fromEntries(
    Object.entries(labels).filter(
      ([, label]) => label.singular !== "" && label.plural !== "",
    ),
  );

  try {
    await callAction(
      {
        pool: getPool(),
        workspaceId: workspace.workspaceId,
        actor: { kind: "human", userId: session.user.id },
      },
      "rhythm.update",
      {
        defaultCheckInFrequency: formData.get("defaultCheckInFrequency") as
          | "daily"
          | "weekly"
          | "biweekly"
          | "monthly"
          | "quarterly",
        checkInAnchorDay: Number(formData.get("checkInAnchorDay")),
        coachStrictness: formData.get("coachStrictness") as
          | "advisory"
          | "warn"
          | "strict",
        overrides,
        labels: renames,
      },
    );
  } catch (error) {
    if (!(error instanceof OperationError)) {
      throw error;
    }
    return;
  }

  revalidatePath("/admin/rhythm");
}

const WEEKDAYS = [
  [1, "Monday"],
  [2, "Tuesday"],
  [3, "Wednesday"],
  [4, "Thursday"],
  [5, "Friday"],
  [6, "Saturday"],
  [7, "Sunday"],
] as const;

export function RhythmForm({ rhythm }: { readonly rhythm: Rhythm }) {
  const groups = [...new Set(rhythm.registry.map((entry) => entry.group))];

  return (
    <form action={save} className="flex flex-col gap-4.5">
      <Card>
        <CardHeader>
          <h2 className="font-semibold text-ink">The check-in rhythm</h2>
          <p className="text-sm text-ink-3">
            These three have their own home rather than living in the override
            map, so they are set here and nowhere else.
          </p>
        </CardHeader>
        <CardBody className="flex flex-col gap-3 text-sm">
          <label className="flex items-center justify-between gap-3">
            <span className="text-ink-2">Check-in frequency</span>
            <select
              name="defaultCheckInFrequency"
              defaultValue={rhythm.defaultCheckInFrequency}
              className="rounded-md border border-line bg-bg px-2 py-1"
            >
              {["daily", "weekly", "biweekly", "monthly", "quarterly"].map(
                (option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ),
              )}
            </select>
          </label>
          <label className="flex items-center justify-between gap-3">
            <span className="text-ink-2">Anchor day</span>
            <select
              name="checkInAnchorDay"
              defaultValue={String(rhythm.checkInAnchorDay)}
              className="rounded-md border border-line bg-bg px-2 py-1"
            >
              {WEEKDAYS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center justify-between gap-3">
            <span className="text-ink-2">Coach strictness</span>
            <select
              name="coachStrictness"
              defaultValue={rhythm.coachStrictness}
              className="rounded-md border border-line bg-bg px-2 py-1"
            >
              {["advisory", "warn", "strict"].map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <p className="text-sm text-ink-3">
            The six publish gates stay hard whatever strictness says.
          </p>
        </CardBody>
      </Card>

      {groups.map((group) => (
        <Card key={group}>
          <CardHeader>
            <h2 className="font-semibold text-ink">
              {GROUP_TITLES[group] ?? group}
            </h2>
          </CardHeader>
          <CardBody className="flex flex-col gap-3.5">
            {rhythm.registry
              .filter((entry) => entry.group === group && !entry.columnBacked)
              .map((entry) => {
                const resolved = rhythm.thresholds[entry.key];
                const override = rhythm.overrides[entry.key];
                const scalar =
                  typeof resolved === "number" || typeof resolved === "string";
                return (
                  <div key={entry.key} className="flex flex-col gap-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-medium text-ink">
                        {entry.label}
                      </span>
                      <span className="flex items-center gap-2">
                        <Chip tone="neutral">METHOD {entry.section}</Chip>
                        {override === undefined ? null : (
                          <Chip tone="brand">changed</Chip>
                        )}
                      </span>
                    </div>
                    <p className="text-sm text-ink-3">{entry.why}</p>
                    {scalar && typeof resolved === "number" ? (
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="number"
                          step="any"
                          name={`threshold:${entry.key}`}
                          defaultValue={
                            override === undefined ? "" : String(override)
                          }
                          placeholder={String(resolved)}
                          className="w-28 rounded-md border border-line bg-bg px-2 py-1 tabular"
                        />
                        <span className="text-ink-3">
                          in force: {String(resolved)}. Leave blank for the
                          canon.
                        </span>
                      </label>
                    ) : (
                      <p className="tabular text-sm text-ink-3">
                        in force: {JSON.stringify(resolved)}
                      </p>
                    )}
                  </div>
                );
              })}
          </CardBody>
        </Card>
      ))}

      <Card>
        <CardHeader>
          <h2 className="font-semibold text-ink">Terminology</h2>
          <p className="text-sm text-ink-3">
            Rename a concept the method already has. Both forms are needed, or
            the rename is left alone.
          </p>
        </CardHeader>
        <CardBody className="flex flex-col gap-2 text-sm">
          {Object.entries(rhythm.terminology).map(([term, label]) => {
            const value = label as { singular: string; plural: string };
            return (
              <div key={term} className="flex items-center gap-2">
                <span className="w-32 text-ink-3">{term}</span>
                <input
                  name={`label:${term}:singular`}
                  defaultValue={value.singular}
                  className="w-40 rounded-md border border-line bg-bg px-2 py-1"
                />
                <input
                  name={`label:${term}:plural`}
                  defaultValue={value.plural}
                  className="w-40 rounded-md border border-line bg-bg px-2 py-1"
                />
              </div>
            );
          })}
        </CardBody>
      </Card>

      <div>
        <Button type="submit">Save</Button>
      </div>
    </form>
  );
}
