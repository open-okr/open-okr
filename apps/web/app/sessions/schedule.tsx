import { ACCESS_LEVELS, callAction } from "@openokr/core";
import {
  Card,
  CardBody,
  CardHeader,
  DateTimeInput,
  EntityPicker,
  SelectInput,
  TextInput,
  TimeInput,
} from "@openokr/ui";
import { resolveAccessLevelFor } from "../../lib/access";
import { memberOption, namedOption } from "../../lib/entity-options.ts";
import { searchPeople } from "../../lib/member-search.ts";
import { getPool } from "../../lib/pool";
import { getTranslations } from "../../lib/translations";
import { requireWorkspace } from "../../lib/workspace";
import { bookCycleAction, scheduleSessionAction } from "./schedule-actions.ts";
import { ScheduleForm } from "./schedule-form.tsx";

/**
 * Booking sessions (METHOD.md §7.1, completeness review H-08).
 *
 * Two controls, because §7.1 describes two jobs. "Book all of them for the
 * whole cycle before the cycle starts" is one press that fills every week,
 * month and the close around whatever is already booked. One session on its
 * own is for a planning session, or a ritual moved off its usual day.
 *
 * Drawn on the session list and on a space home. On a space home the space is
 * fixed, because that is the room the reader is standing in.
 *
 * Shown to members who can edit. `sessions.bookCycle` and `sessions.create`
 * both check edit on the space itself and refuse in words, so a member who
 * can edit the workspace but not this space reads why.
 */

const KINDS = [
  { id: "weekly", key: "sessions.schedule.kind.weekly" },
  { id: "monthly", key: "sessions.schedule.kind.monthly" },
  { id: "quarterly", key: "sessions.schedule.kind.quarterly" },
  { id: "planning", key: "sessions.schedule.kind.planning" },
] as const;

const WEEKDAYS = [
  { id: 1, key: "sessions.schedule.weekday.monday" },
  { id: 2, key: "sessions.schedule.weekday.tuesday" },
  { id: 3, key: "sessions.schedule.weekday.wednesday" },
  { id: 4, key: "sessions.schedule.weekday.thursday" },
  { id: 5, key: "sessions.schedule.weekday.friday" },
] as const;

export async function ScheduleSessions({
  spaceId,
}: {
  /** Fixes the space, on a space home. */
  readonly spaceId?: string;
}) {
  const { t } = await getTranslations();
  const { session, workspace } = await requireWorkspace();
  const level = await resolveAccessLevelFor(
    workspace.workspaceId,
    workspace.memberId,
  );
  if (level < ACCESS_LEVELS.edit) {
    return null;
  }

  const actor = {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };
  const [spaces, directory, cycle, settings] = await Promise.all([
    callAction(actor, "spaces.list", {}),
    callAction(actor, "people.directory", {}),
    callAction(actor, "cycles.current", { mode: "quarterly" }),
    callAction(actor, "settings.readForMember", {}),
  ]);
  const choices = spaceId
    ? spaces.filter((space) => space.id === spaceId)
    : spaces;
  if (choices.length === 0) {
    return null;
  }
  const people = directory.filter(
    (member) => member.kind === "human" || member.kind === "guest",
  );
  const openCycle = cycle && cycle.status !== "closed" ? cycle : null;
  const timezone = String(settings.settings.timezone ?? "UTC");

  const spaceField = spaceId ? (
    <input type="hidden" name="spaceId" value={spaceId} />
  ) : (
    // Opens on the first space, as the select it replaced did. That space's
    // review grades every objective in the cycle, the workspace's own
    // included, so it says so (UAT M18-03).
    <EntityPicker
      label={t("sessions.schedule.space")}
      name="spaceId"
      required
      defaultValue={choices[0]?.id ?? null}
      options={choices.map((space) =>
        namedOption({
          id: space.id,
          name: space.isCompany
            ? t("sessions.schedule.companySpace", { name: space.name })
            : space.name,
        }),
      )}
    />
  );
  const facilitatorField = (
    <EntityPicker
      label={t("sessions.schedule.facilitator")}
      name="facilitatorId"
      required
      defaultValue={workspace.memberId}
      options={people.map((member) => memberOption(member, t("common.agent")))}
      search={searchPeople}
    />
  );

  return (
    <Card id="schedule">
      <CardHeader>
        <div className="flex min-w-0 flex-col">
          <h2 className="text-sm font-bold text-ink">
            {t("sessions.schedule.title")}
          </h2>
          <p className="text-xs text-ink-3">{t("sessions.schedule.intro")}</p>
        </div>
      </CardHeader>
      <CardBody className="grid gap-5 md:grid-cols-2">
        <section
          aria-labelledby="book-cycle-heading"
          className="flex flex-col gap-2"
        >
          <h3 id="book-cycle-heading" className="text-xs font-bold text-ink-2">
            {t("sessions.schedule.bookCycle")}
          </h3>
          {openCycle ? (
            <ScheduleForm
              action={bookCycleAction}
              className="flex flex-col gap-2"
            >
              <p className="text-xs text-ink-3">
                {t("sessions.schedule.bookCycleHint", {
                  cycle: openCycle.name,
                  startsOn: openCycle.startsOn,
                  endsOn: openCycle.endsOn,
                })}
              </p>
              <input type="hidden" name="cycleId" value={openCycle.id} />
              {spaceField}
              <div className="flex flex-wrap gap-2">
                <SelectInput
                  label={t("sessions.schedule.weekday")}
                  name="weekday"
                  defaultValue="1"
                >
                  {WEEKDAYS.map((day) => (
                    <option key={day.id} value={day.id}>
                      {t(day.key)}
                    </option>
                  ))}
                </SelectInput>
                <TimeInput
                  label={t("sessions.schedule.time")}
                  name="time"
                  required
                  defaultValue="09:00"
                  description={t("sessions.schedule.inTimezone", { timezone })}
                />
              </div>
              {facilitatorField}
              <button
                type="submit"
                className="self-start rounded-md bg-brand px-2.5 py-1.5 text-xs font-semibold text-on-brand"
              >
                {t("sessions.schedule.bookButton")}
              </button>
            </ScheduleForm>
          ) : (
            <p className="text-xs text-ink-3">
              {t("sessions.schedule.noOpenCycle")}
            </p>
          )}
        </section>

        <section
          aria-labelledby="schedule-one-heading"
          className="flex flex-col gap-2"
        >
          <h3
            id="schedule-one-heading"
            className="text-xs font-bold text-ink-2"
          >
            {t("sessions.schedule.one")}
          </h3>
          <ScheduleForm
            action={scheduleSessionAction}
            className="flex flex-col gap-2"
          >
            <p className="text-xs text-ink-3">
              {t("sessions.schedule.oneHint")}
            </p>
            {openCycle ? (
              <input type="hidden" name="cycleId" value={openCycle.id} />
            ) : null}
            {spaceField}
            <SelectInput
              label={t("sessions.schedule.kind")}
              name="kind"
              defaultValue="weekly"
            >
              {KINDS.map((kind) => (
                <option key={kind.id} value={kind.id}>
                  {t(kind.key)}
                </option>
              ))}
            </SelectInput>
            <TextInput
              label={t("sessions.schedule.titleLabel")}
              name="title"
              maxLength={200}
              placeholder={t("sessions.schedule.titlePlaceholder")}
            />
            {/* The local time alone: the action reads a time with no offset
                in the workspace's zone, which is the one named here. */}
            <DateTimeInput
              label={t("sessions.schedule.when")}
              name="scheduledFor"
              required
              timeZone={timezone}
            />
            {facilitatorField}
            <button
              type="submit"
              className="self-start rounded-md bg-brand px-2.5 py-1.5 text-xs font-semibold text-on-brand"
            >
              {t("sessions.schedule.scheduleButton")}
            </button>
          </ScheduleForm>
        </section>
      </CardBody>
    </Card>
  );
}
