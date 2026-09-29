import { Button, Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import { getTranslations } from "../../lib/translations";
import { ActionForm } from "./action-form.tsx";
import {
  saveBaselineHealth,
  saveCapacityCuts,
  saveCycleSetup,
  saveFocusKeyResults,
  saveRevalidation,
} from "./setup-actions.ts";

/**
 * The controls phases 1, 2, 3 and 5 were missing (completeness review H-09).
 *
 * Each phase computed its completion from rows no screen could write: the
 * sponsor and facilitator, the planning session dates, baseline health, the
 * quarterly revalidation and its focus, and what was cut. So none of those
 * phases could go green from the browser, and every publish needed the
 * override. One card per missing piece, beside the phase that reads it.
 */

const FIELD =
  "rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink";
const LABEL = "flex flex-col gap-1 text-xs text-ink-3";

type Person = { readonly id: string; readonly name: string };

const SESSIONS = [
  { key: "diagnose", label: "cycle.setup.session.diagnose" },
  { key: "set-direction", label: "cycle.setup.session.setDirection" },
  { key: "draft", label: "cycle.setup.session.draft" },
  { key: "align-and-commit", label: "cycle.setup.session.alignAndCommit" },
] as const;

/** Phase 1: who sponsors and facilitates, and when the planning sessions are. */
export async function CycleSetup({
  cycleId,
  people,
  sponsorId,
  facilitatorId,
  firstCycle,
  sessionDates,
}: {
  readonly cycleId: string;
  readonly people: readonly Person[];
  readonly sponsorId: string | null;
  readonly facilitatorId: string | null;
  readonly firstCycle: boolean;
  readonly sessionDates: readonly { key: string; on: string }[];
}) {
  const { t } = await getTranslations();
  const dateOf = (key: string) =>
    sessionDates.find((entry) => entry.key === key)?.on ?? "";
  const picker = (name: string, label: string, value: string | null) => (
    <label className={LABEL}>
      {label}
      <select name={name} defaultValue={value ?? ""} className={FIELD}>
        <option value="">{t("cycle.setup.nobody")}</option>
        {people.map((person) => (
          <option key={person.id} value={person.id}>
            {person.name}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex min-w-0 flex-col">
          <h2 className="text-sm font-bold text-ink">
            {t("cycle.setup.title")}
          </h2>
          <p className="text-xs text-ink-3">{t("cycle.setup.sessionsHint")}</p>
        </div>
      </CardHeader>
      <CardBody>
        <ActionForm action={saveCycleSetup} className="flex flex-col gap-3">
          <input type="hidden" name="cycleId" value={cycleId} />
          <div className="grid gap-2 sm:grid-cols-2">
            {picker("sponsorId", t("cycle.setup.sponsor"), sponsorId)}
            {picker(
              "facilitatorId",
              t("cycle.setup.facilitator"),
              facilitatorId,
            )}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {SESSIONS.map((session) => (
              <label key={session.key} className={LABEL}>
                {t(session.label)}
                <input
                  type="date"
                  name={`session-${session.key}`}
                  defaultValue={dateOf(session.key)}
                  className={FIELD}
                />
              </label>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm text-ink-2">
            <input
              type="checkbox"
              name="firstCycle"
              defaultChecked={firstCycle}
            />
            {t("cycle.setup.firstCycle")}
          </label>
          <Button type="submit" className="self-start">
            {t("common.save")}
          </Button>
        </ActionForm>
      </CardBody>
    </Card>
  );
}

/** Phase 2: the KPI reading in §8.5's three columns. */
export async function BaselineHealth({
  cycleId,
  saved,
  canEdit,
}: {
  readonly cycleId: string;
  readonly saved: {
    readonly stable: string | null;
    readonly declining: string | null;
    readonly businessAsUsual: string | null;
  } | null;
  readonly canEdit: boolean;
}) {
  const { t } = await getTranslations();
  const columns = [
    { name: "stable", label: t("cycle.baseline.stable") },
    { name: "declining", label: t("cycle.baseline.declining") },
    { name: "businessAsUsual", label: t("cycle.baseline.businessAsUsual") },
  ] as const;

  return (
    <Card>
      <CardHeader className="justify-between">
        <div className="flex min-w-0 flex-col">
          <h2 className="text-sm font-bold text-ink">
            {t("cycle.baseline.title")}
          </h2>
          <p className="text-xs text-ink-3">{t("cycle.baseline.hint")}</p>
        </div>
        <Chip tone={saved ? "ok" : "warn"}>
          {saved ? t("cycle.baseline.recorded") : t("cycle.baseline.missing")}
        </Chip>
      </CardHeader>
      <CardBody>
        {canEdit ? (
          <ActionForm
            action={saveBaselineHealth}
            className="flex flex-col gap-2.5"
          >
            <input type="hidden" name="cycleId" value={cycleId} />
            <div className="grid gap-2 md:grid-cols-3">
              {columns.map((column) => (
                <label key={column.name} className={LABEL}>
                  {column.label}
                  <textarea
                    name={column.name}
                    rows={4}
                    maxLength={4000}
                    defaultValue={saved?.[column.name] ?? ""}
                    className={FIELD}
                  />
                </label>
              ))}
            </div>
            <Button type="submit" className="self-start">
              {t("common.save")}
            </Button>
          </ActionForm>
        ) : (
          <dl className="grid gap-2 text-sm md:grid-cols-3">
            {columns.map((column) => (
              <div key={column.name} className="flex flex-col gap-0.5">
                <dt className="text-xs font-bold text-ink-3">{column.label}</dt>
                <dd className="whitespace-pre-line text-ink-2">
                  {saved?.[column.name] ?? t("cycle.baseline.notRecorded")}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </CardBody>
    </Card>
  );
}

/** Phase 3, quarterly: the frame revalidated, and what this quarter focuses on. */
export async function Revalidation({
  cycleId,
  saved,
  focus,
  canEdit,
}: {
  readonly cycleId: string;
  readonly saved: {
    readonly holds: boolean;
    readonly changed: boolean;
    readonly changeNote: string | null;
    readonly focusNote: string | null;
  } | null;
  readonly focus: {
    readonly chosen: readonly string[];
    readonly candidates: readonly {
      readonly id: string;
      readonly title: string;
      readonly goalTitle: string;
    }[];
  };
  readonly canEdit: boolean;
}) {
  const { t } = await getTranslations();
  const chosen = new Set(focus.chosen);

  return (
    <div className="flex flex-col gap-4.5">
      <Card>
        <CardHeader>
          <div className="flex min-w-0 flex-col">
            <h2 className="text-sm font-bold text-ink">
              {t("cycle.revalidation.title")}
            </h2>
            <p className="text-xs text-ink-3">{t("cycle.revalidation.hint")}</p>
          </div>
        </CardHeader>
        <CardBody>
          <ActionForm
            action={saveRevalidation}
            className="flex flex-col gap-2.5"
          >
            <input type="hidden" name="cycleId" value={cycleId} />
            <label className={LABEL}>
              {t("cycle.revalidation.verdict")}
              <select
                name="verdict"
                disabled={!canEdit}
                defaultValue={saved?.changed ? "changed" : "holds"}
                className={FIELD}
              >
                <option value="holds">{t("cycle.revalidation.holds")}</option>
                <option value="changed">
                  {t("cycle.revalidation.changed")}
                </option>
              </select>
            </label>
            <label className={LABEL}>
              {t("cycle.revalidation.changeNote")}
              <textarea
                name="changeNote"
                rows={2}
                maxLength={2000}
                disabled={!canEdit}
                defaultValue={saved?.changeNote ?? ""}
                className={FIELD}
              />
            </label>
            <label className={LABEL}>
              {t("cycle.revalidation.focusNote")}
              <textarea
                name="focusNote"
                rows={2}
                maxLength={2000}
                disabled={!canEdit}
                defaultValue={saved?.focusNote ?? ""}
                className={FIELD}
              />
              <span className="text-ink-4">
                {t("cycle.revalidation.focusNoteHint")}
              </span>
            </label>
            {canEdit ? (
              <Button type="submit" className="self-start">
                {t("common.save")}
              </Button>
            ) : null}
          </ActionForm>
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="justify-between">
          <div className="flex min-w-0 flex-col">
            <h2 className="text-sm font-bold text-ink">
              {t("cycle.focus.title")}
            </h2>
            <p className="text-xs text-ink-3">{t("cycle.focus.hint")}</p>
          </div>
          <Chip tone={chosen.size > 0 ? "ok" : "neutral"}>
            {t("cycle.focus.count", { count: chosen.size })}
          </Chip>
        </CardHeader>
        <CardBody>
          {focus.candidates.length === 0 ? (
            <p className="text-sm text-ink-3">{t("cycle.focus.none")}</p>
          ) : (
            <ActionForm
              action={saveFocusKeyResults}
              className="flex flex-col gap-2"
            >
              <input type="hidden" name="cycleId" value={cycleId} />
              <ul className="flex flex-col gap-1.5">
                {focus.candidates.map((candidate) => (
                  <li key={candidate.id}>
                    <label className="flex items-start gap-2 text-sm text-ink-2">
                      <input
                        type="checkbox"
                        name="keyResultId"
                        value={candidate.id}
                        disabled={!canEdit}
                        defaultChecked={chosen.has(candidate.id)}
                        className="mt-1"
                      />
                      <span className="flex flex-col">
                        <span className="text-ink">{candidate.title}</span>
                        <span className="text-xs text-ink-3">
                          {candidate.goalTitle}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              {canEdit ? (
                <Button type="submit" className="self-start">
                  {t("common.save")}
                </Button>
              ) : null}
            </ActionForm>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

/** Phase 5: §5.5's "the facilitator must record what was cut". */
export async function CapacityCuts({
  cycleId,
  saved,
  canEdit,
}: {
  readonly cycleId: string;
  readonly saved: string | null;
  readonly canEdit: boolean;
}) {
  const { t } = await getTranslations();
  return (
    <Card>
      <CardHeader className="justify-between">
        <div className="flex min-w-0 flex-col">
          <h2 className="text-sm font-bold text-ink">
            {t("cycle.cuts.title")}
          </h2>
          <p className="text-xs text-ink-3">{t("cycle.cuts.hint")}</p>
        </div>
        <Chip tone={saved ? "ok" : "warn"}>
          {saved ? t("cycle.cuts.recorded") : t("cycle.cuts.missing")}
        </Chip>
      </CardHeader>
      <CardBody>
        {canEdit ? (
          <ActionForm action={saveCapacityCuts} className="flex flex-col gap-2">
            <input type="hidden" name="cycleId" value={cycleId} />
            <label className={LABEL}>
              {t("cycle.cuts.label")}
              <textarea
                name="cuts"
                rows={3}
                maxLength={4000}
                defaultValue={saved ?? ""}
                placeholder={t("cycle.cuts.placeholder")}
                className={FIELD}
              />
            </label>
            <Button type="submit" className="self-start">
              {t("common.save")}
            </Button>
          </ActionForm>
        ) : (
          <p className="whitespace-pre-line text-sm text-ink-2">
            {saved ?? t("cycle.cuts.missing")}
          </p>
        )}
      </CardBody>
    </Card>
  );
}
