"use client";

import type { callAction } from "@openokr/core";
import type { ProfileComparisonRow, ProfileSwitch } from "@openokr/method";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  cn,
  MethodHint,
  SelectInput,
  SettingsSaveBar,
  useKeyboardRegistry,
  useSubmitShortcut,
  useTranslations,
  useUnsavedGuard,
} from "@openokr/ui";
import Link from "next/link";
import type { FormEvent, ReactNode } from "react";
import {
  useActionState,
  useCallback,
  useEffect,
  useState,
  useTransition,
} from "react";
import { applyProfile, savePractice } from "./practice-actions";
import { NOTHING_SAVED } from "./practice-state.ts";
import { ProfileComparison } from "./profile-comparison";

/**
 * Choosing and changing the METHOD.md §12 practice (S-36, P9-T05).
 *
 * **Generated from the registry**, like the rhythm card: every setting is a
 * select of its own options in §12.1's words, grouped by the registry's own
 * groups, and nothing here names a setting key. A setting added to §12 appears
 * with no change to this file.
 *
 * **One form for the nine settings cards, one sticky save bar** (docs/design/
 * settings-page-layout.md, "long page, one settings object"). The bar names
 * the cards that changed. The profile is a card of its own, above the rest and
 * outside that form, because choosing one changes many settings at once and
 * the reader should see which before saying yes: it applies at once, with its
 * own button, and is held off while the form has unsaved changes.
 */

type Practice = Awaited<ReturnType<typeof callAction<"practice.read">>>;
type Setting = Practice["registry"][number];

/** Catalogue keys for each §12.1 group's card title. */
const GROUP_TITLES: Record<string, string> = {
  writing: "admin.practice.groups.writing",
  model: "admin.practice.groups.model",
  checks: "admin.practice.groups.checks",
  gates: "admin.practice.groups.gates",
  levels: "admin.practice.groups.levels",
  scoring: "admin.practice.groups.scoring",
  rhythm: "admin.practice.groups.rhythm",
  review: "admin.practice.groups.review",
  kpi: "admin.practice.groups.kpi",
};

/** Catalogue keys for each group's one-line description under its title. */
const GROUP_DESCRIPTIONS: Record<string, string> = {
  writing: "admin.practice.groupDescription.writing",
  model: "admin.practice.groupDescription.model",
  checks: "admin.practice.groupDescription.checks",
  gates: "admin.practice.groupDescription.gates",
  levels: "admin.practice.groupDescription.levels",
  scoring: "admin.practice.groupDescription.scoring",
  rhythm: "admin.practice.groupDescription.rhythm",
  review: "admin.practice.groupDescription.review",
  kpi: "admin.practice.groupDescription.kpi",
};

/** Catalogue keys for each section heading and the tag beside it. */
const SECTION_TITLES: Record<string, string> = {
  start: "admin.practice.section.start.title",
  writing: "admin.practice.section.writing.title",
  checks: "admin.practice.section.checks.title",
  levels: "admin.practice.section.levels.title",
  review: "admin.practice.section.review.title",
};
const SECTION_TAGS: Record<string, string> = {
  start: "admin.practice.section.start.tag",
  saved: "admin.practice.section.saved.tag",
};

/** A threshold value for a sentence: a number, a word, or its parts. */
function shown(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map(shown).join(", ");
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([part, inner]) => `${part} ${shown(inner)}`)
      .join(", ");
  }
  return String(value);
}

/**
 * The name a person reads for one setting, with its item where it has one.
 * `practiceSettingName`'s, so a card and the comparison name a row alike.
 */
function useSettingName(
  settingNames: Readonly<Record<string, string>>,
): (setting: Setting) => string {
  return useCallback(
    (setting: Setting) => settingNames[setting.key] ?? setting.label,
    [settingNames],
  );
}

/** The profile card: the five §12.2 profiles, and what choosing one changes. */
function ProfileCard({
  practice,
  previews,
  thresholdLabels,
  nameOf,
  comparison,
  methodLinks,
  profileSources,
  canManage,
  dirty,
}: {
  readonly practice: Practice;
  readonly previews: Readonly<Record<string, ProfileSwitch>>;
  readonly thresholdLabels: Readonly<Record<string, string>>;
  readonly nameOf: (setting: Setting) => string;
  readonly comparison: readonly ProfileComparisonRow[];
  readonly methodLinks: Readonly<Record<string, string>>;
  /** The work a profile follows, for the profiles §12.2 links to one. */
  readonly profileSources?: Readonly<
    Record<string, { readonly title: string; readonly url: string }>
  >;
  readonly canManage: boolean;
  /** The settings form has unsaved changes, which a switch would discard. */
  readonly dirty: boolean;
}) {
  const { t } = useTranslations();
  const [state, submit, pending] = useActionState(applyProfile, NOTHING_SAVED);
  const [chosen, setChosen] = useState<string>(practice.profile);
  const title = t("admin.practice.profile.title");

  // Back to the profile in use once a switch has landed, so the preview is
  // not left describing a change that has already happened.
  useEffect(() => {
    setChosen(practice.profile);
  }, [practice.profile]);

  const byKey = new Map(practice.registry.map((entry) => [entry.key, entry]));
  const optionWords = (key: string, value: string) =>
    byKey.get(key)?.optionLabels[value] ?? value;
  const preview = chosen === practice.profile ? null : previews[chosen];
  const chosenLabel =
    practice.profiles.find((profile) => profile.key === chosen)?.label ??
    chosen;

  return (
    <form action={submit} aria-busy={pending} data-testid="practice-profile">
      <Card>
        <CardHeader className="flex-wrap items-start justify-between">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h3 className="text-sm font-semibold text-ink">{title}</h3>
            <p className="text-xs text-ink-3">
              {t("admin.practice.profile.description")}
            </p>
          </div>
          <ProfileComparison
            rows={comparison}
            profiles={practice.profiles}
            inUse={practice.profile}
            methodLinks={methodLinks}
          />
        </CardHeader>
        <CardBody className="flex flex-col gap-4">
          <fieldset className="grid grid-cols-12 gap-3">
            <legend className="sr-only">{title}</legend>
            {practice.profiles.map((profile, index) => {
              const sets = comparison.filter((row) =>
                row.differs.includes(profile.key),
              );
              return (
                // The hint sits beside the label rather than in it, so opening
                // it does not choose the profile.
                <div
                  key={profile.key}
                  className={cn(
                    "col-span-12 flex items-start gap-1 rounded-control border py-2 pr-2 pl-3 text-sm",
                    index < 3 ? "md:col-span-4" : "md:col-span-6",
                    chosen === profile.key
                      ? "border-brand bg-brand-weak"
                      : "border-line",
                  )}
                >
                  <div className="flex flex-1 flex-col gap-1">
                    <label className="flex items-start gap-2.5">
                      <input
                        type="radio"
                        name="profile"
                        value={profile.key}
                        checked={chosen === profile.key}
                        disabled={!canManage}
                        onChange={() => setChosen(profile.key)}
                        className="mt-1"
                      />
                      <span className="flex flex-col gap-0.5">
                        <span className="flex items-center gap-2 font-medium text-ink">
                          {profile.label}
                          {profile.key === practice.profile ? (
                            <Chip tone="brand">
                              {t("admin.practice.profile.inUse")}
                            </Chip>
                          ) : null}
                        </span>
                        <span className="text-ink-3">{profile.for}</span>
                      </span>
                    </label>
                    {profileSources?.[profile.key] ? (
                      <a
                        href={profileSources[profile.key]?.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        data-testid={`practice-profile-source-${profile.key}`}
                        className="pl-6 text-xs font-semibold text-brand-text underline"
                      >
                        {t("admin.practice.profile.source", {
                          title: profileSources[profile.key]?.title ?? "",
                        })}
                        <span className="sr-only">
                          {" "}
                          {t("admin.practice.opensInNewTab")}
                        </span>
                      </a>
                    ) : null}
                  </div>
                  <MethodHint name={profile.label} href={methodLinks["12.2"]}>
                    {sets.length === 0 ? (
                      <p>{t("admin.practice.hint.recommended")}</p>
                    ) : (
                      <>
                        <p>{t("admin.practice.hint.changes")}</p>
                        <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-4">
                          {sets.map((row) => (
                            <li key={row.key}>
                              {row.name}: {row.values[profile.key]}
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </MethodHint>
                </div>
              );
            })}
          </fieldset>

          {preview ? (
            <section
              aria-live="polite"
              data-testid="practice-profile-preview"
              className="flex flex-col gap-1.5 rounded-control bg-ink/[0.03] px-3 py-2.5 text-sm"
            >
              <h4 className="font-semibold text-ink-2">
                {t("admin.practice.profile.changes", { profile: chosenLabel })}
              </h4>
              {preview.practice.length === 0 &&
              preview.thresholds.length === 0 ? (
                <p className="text-ink-3">
                  {t("admin.practice.profile.nothingChanges")}
                </p>
              ) : (
                <ul className="flex list-disc flex-col gap-0.5 pl-5 text-ink-2">
                  {preview.practice.map((change) => {
                    const setting = byKey.get(change.key);
                    return (
                      <li key={change.key}>
                        {t("admin.practice.profile.fromTo", {
                          name: setting ? nameOf(setting) : change.key,
                          from: optionWords(change.key, change.from),
                          to: optionWords(change.key, change.to),
                        })}
                      </li>
                    );
                  })}
                  {preview.thresholds.map((change) => (
                    <li key={change.key}>
                      {t("admin.practice.profile.fromTo", {
                        name: thresholdLabels[change.key] ?? change.key,
                        from: shown(change.from),
                        to: shown(change.to),
                      })}
                    </li>
                  ))}
                </ul>
              )}
              {preview.keptPractice.length > 0 ||
              preview.keptThresholds.length > 0 ? (
                <p className="text-ink-3">
                  {t("admin.practice.profile.keeps", {
                    names: [
                      ...preview.keptPractice.map((key) => {
                        const setting = byKey.get(key);
                        return setting ? nameOf(setting) : key;
                      }),
                      ...preview.keptThresholds.map(
                        (key) => thresholdLabels[key] ?? key,
                      ),
                    ].join(", "),
                  })}
                </p>
              ) : null}
            </section>
          ) : null}
        </CardBody>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-3.5 py-2.5">
          <div className="flex min-w-0 flex-col gap-0.5 text-sm">
            {state.error === null && state.saved === null ? (
              <p className="text-ink-3">
                {t("admin.practice.profile.appliesAtOnce")}
              </p>
            ) : null}
            {state.saved === null ? null : (
              <p role="status" className="text-ink-2">
                {state.saved}
              </p>
            )}
            {state.error === null ? null : (
              <p role="alert" className="text-bad">
                {state.error}
              </p>
            )}
            {canManage && dirty ? (
              <p
                className="text-ink-2"
                data-testid="practice-profile-save-first"
              >
                {t("admin.practice.profile.saveFirst")}
              </p>
            ) : null}
          </div>
          {canManage ? (
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={pending || chosen === practice.profile || dirty}
            >
              {pending
                ? t("admin.practice.profile.applying")
                : t("admin.practice.profile.use")}
            </Button>
          ) : null}
        </div>
      </Card>
    </form>
  );
}

const FORM_ID = "practice-form";

/**
 * Columns each setting takes on a desktop row of twelve, per group, in the
 * registry's order. A group or a setting this table does not reach takes half
 * a row, so a setting added to §12 still appears. Phones take the full row.
 */
const SPANS: Record<string, readonly string[]> = {
  writing: [
    "md:col-span-6",
    "md:col-span-6",
    "md:col-span-6",
    "md:col-span-6",
    "md:col-span-12",
  ],
  model: Array(6).fill("md:col-span-4"),
  checks: Array(27).fill("md:col-span-4"),
  gates: [
    "md:col-span-6",
    "md:col-span-6",
    "md:col-span-6",
    "md:col-span-6",
    "md:col-span-6",
    "md:col-span-6",
    "md:col-span-12",
  ],
  levels: Array(4).fill("md:col-span-3"),
  scoring: [
    "md:col-span-4",
    "md:col-span-4",
    "md:col-span-4",
    "md:col-span-6",
    "md:col-span-6",
  ],
  rhythm: Array(3).fill("md:col-span-4"),
  review: Array(3).fill("md:col-span-4"),
  kpi: ["md:col-span-12"],
};

/** The page's sections, in order: catalogue id and the groups each holds. */
const SECTIONS: readonly { id: string; groups: readonly string[] }[] = [
  { id: "writing", groups: ["writing", "model"] },
  { id: "checks", groups: ["checks", "gates"] },
  { id: "levels", groups: ["levels", "scoring", "rhythm"] },
  { id: "review", groups: ["review", "kpi"] },
];

function SectionHeading({ id, tag }: { id: string; tag: string }) {
  const { t } = useTranslations();
  const title = SECTION_TITLES[id];
  return (
    <h2 className="mt-2 -mb-1 flex flex-wrap items-center gap-2 text-xs font-semibold tracking-wide text-ink-4 uppercase">
      {title ? t(title) : id}
      <span className="rounded-full bg-raised px-2 py-px text-[11px] font-semibold tracking-normal text-ink-3 normal-case">
        {tag}
      </span>
    </h2>
  );
}

/** One §12.1 group: a card of selects, on the page's one form. */
function GroupCard({
  id,
  title,
  settings,
  practice,
  values,
  onChange,
  nameOf,
  methodLinks,
  canManage,
}: {
  readonly id: string;
  readonly title: string;
  readonly settings: readonly Setting[];
  readonly practice: Practice;
  readonly values: Readonly<Record<string, string>>;
  readonly onChange: (key: string, value: string) => void;
  readonly nameOf: (setting: Setting) => string;
  readonly methodLinks: Readonly<Record<string, string>>;
  readonly canManage: boolean;
}) {
  const { t } = useTranslations();
  const profile = practice.profiles.find(
    (entry) => entry.key === practice.profile,
  );
  const profileValueOf = (setting: Setting): string =>
    (profile?.practice[setting.key] as string | undefined) ?? setting.default;

  // A refill, not a write: the change joins "Not saved yet" and Discard
  // undoes it. `savePractice` turns a value equal to the profile's on an
  // overridden key into a cleared override.
  const canReset = settings.some(
    (setting) => values[setting.key] !== profileValueOf(setting),
  );

  return (
    <Card data-testid={`practice-card-${id}`}>
      <CardHeader className="flex-wrap items-start justify-between">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 className="text-sm font-semibold text-ink">{title}</h3>
          <p className="text-xs text-ink-3">
            {GROUP_DESCRIPTIONS[id] ? t(GROUP_DESCRIPTIONS[id]) : null}
          </p>
        </div>
        {canReset && canManage ? (
          <Button
            type="button"
            size="sm"
            onClick={() => {
              for (const setting of settings) {
                onChange(setting.key, profileValueOf(setting));
              }
            }}
          >
            {t("admin.practice.resetCard")}
          </Button>
        ) : null}
      </CardHeader>
      <CardBody className="grid grid-cols-12 gap-x-6 gap-y-4">
        {settings.map((setting, index) => {
          const differs = practice.differsFromProfile.includes(setting.key);
          const profileValue = profileValueOf(setting);
          const fieldId = `practice-${setting.key}`;
          return (
            <div
              key={setting.key}
              className={cn(
                "col-span-12 flex min-w-0 flex-col gap-1",
                SPANS[id]?.[index] ?? "md:col-span-6",
              )}
            >
              <div className="flex min-h-5 items-start justify-between gap-2">
                <span className="flex items-start gap-0.5">
                  <label
                    htmlFor={fieldId}
                    className="text-sm font-medium text-ink-2"
                  >
                    {nameOf(setting)}
                  </label>
                  <MethodHint
                    name={nameOf(setting)}
                    href={methodLinks[setting.section]}
                  >
                    <p>{setting.summary}</p>
                  </MethodHint>
                </span>
                {differs ? (
                  <Chip tone="brand">{t("admin.practice.differs")}</Chip>
                ) : null}
              </div>
              <SelectInput
                label={nameOf(setting)}
                hideLabel
                id={fieldId}
                name={`practice:${setting.key}`}
                disabled={!canManage}
                value={values[setting.key]}
                onChange={(event) =>
                  onChange(setting.key, event.currentTarget.value)
                }
              >
                {setting.options.map((option) => (
                  <option key={option} value={option}>
                    {setting.optionLabels[option] ?? option}
                  </option>
                ))}
              </SelectInput>
              {differs ? (
                <span className="text-xs text-ink-3">
                  {t("admin.practice.profileValue", {
                    value: setting.optionLabels[profileValue] ?? profileValue,
                  })}
                </span>
              ) : null}
            </div>
          );
        })}
      </CardBody>
    </Card>
  );
}

export function PracticeForm({
  practice,
  previews,
  thresholdLabels,
  settingNames,
  comparison,
  methodLinks,
  profileSources,
  canManage,
}: {
  readonly practice: Practice;
  /** What choosing each other profile would change, from `switchProfile`. */
  readonly previews: Readonly<Record<string, ProfileSwitch>>;
  /** §11's own labels, for the thresholds a profile moves. */
  readonly thresholdLabels: Readonly<Record<string, string>>;
  /** Each setting's name from `practiceSettingName`, keyed by setting. */
  readonly settingNames: Readonly<Record<string, string>>;
  /** The five profiles side by side, from `compareProfiles`. */
  readonly comparison: readonly ProfileComparisonRow[];
  /** METHOD.md's address for each section a setting or row cites. */
  readonly methodLinks: Readonly<Record<string, string>>;
  /** The work two profiles follow, from §12.2. Optional: absent shows no link. */
  readonly profileSources?: Readonly<
    Record<string, { readonly title: string; readonly url: string }>
  >;
  /**
   * `full`, which every practice write requires. The server refuses either
   * way; this says so before somebody fills a card in.
   */
  readonly canManage: boolean;
}) {
  const { t } = useTranslations();
  const nameOf = useSettingName(settingNames);
  const { register, unregister } = useKeyboardRegistry();
  const [state, formAction, pending] = useActionState(
    savePractice,
    NOTHING_SAVED,
  );
  const [, startTransition] = useTransition();
  // Controlled, so "Reset to profile" can refill a card and Discard can put
  // every select back. What is saved is `practice.practice`, so a value that
  // equals it is no change.
  const stored = practice.practice;
  const [values, setValues] = useState<Record<string, string>>(() => ({
    ...stored,
  }));
  // A profile switch starts the settings from the new profile's values. It is
  // held off while anything is unsaved, so nothing is lost here.
  const [seenProfile, setSeenProfile] = useState(practice.profile);
  if (seenProfile !== practice.profile) {
    setSeenProfile(practice.profile);
    setValues({ ...stored });
  }
  const onChange = useCallback(
    (key: string, value: string) =>
      setValues((now) => ({ ...now, [key]: value })),
    [],
  );
  const onKeyDown = useSubmitShortcut(canManage);

  const settingsOf = (group: string) =>
    practice.registry.filter((entry) => entry.group === group);
  const knownGroups = SECTIONS.flatMap((section) => section.groups);
  const groups = [
    ...knownGroups,
    ...new Set(
      practice.registry
        .map((entry) => entry.group)
        .filter((group) => !knownGroups.includes(group)),
    ),
  ].filter((group) => settingsOf(group).length > 0);
  const titleOf = (group: string) =>
    GROUP_TITLES[group] ? t(GROUP_TITLES[group]) : group;

  // The cards with a change, by title: sixty-one settings do not fit a line.
  const unsaved = groups
    .filter((group) =>
      settingsOf(group).some(
        (entry) => values[entry.key] !== stored[entry.key],
      ),
    )
    .map(titleOf);
  const dirty = unsaved.length > 0;
  useUnsavedGuard("practice", dirty);

  useEffect(() => {
    register({
      id: "form.save",
      keys: "⌘⏎",
      description: t("admin.rhythm.rhythmForm.saveTheCardShortcut"),
      group: "forms",
    });
    return () => unregister("form.save");
  }, [register, unregister, t]);

  // A transition and no form `action`: React resets a form once its action
  // resolves, which would put every controlled select back to what it was
  // before the save landed.
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const data = new FormData(event.currentTarget, submitter);
    startTransition(() => formAction(data));
  };

  let notice: ReactNode = null;
  if (!canManage) {
    notice = (
      <Card>
        <CardBody>
          <p className="text-sm text-ink-2">{t("admin.practice.readOnly")}</p>
        </CardBody>
      </Card>
    );
  }

  const sectionTag = (id: string) => t(SECTION_TAGS[id] ?? id);

  return (
    <div className="flex flex-col gap-4">
      {notice}
      <SectionHeading id="start" tag={sectionTag("start")} />
      <ProfileCard
        practice={practice}
        previews={previews}
        thresholdLabels={thresholdLabels}
        nameOf={nameOf}
        comparison={comparison}
        methodLinks={methodLinks}
        profileSources={profileSources}
        canManage={canManage}
        dirty={dirty}
      />
      <form
        id={FORM_ID}
        onSubmit={submit}
        onReset={() => setValues({ ...stored })}
        onKeyDown={onKeyDown}
        aria-busy={pending}
        className="flex flex-col gap-4"
      >
        {SECTIONS.map((section) => (
          <div key={section.id} className="flex flex-col gap-4">
            <SectionHeading id={section.id} tag={sectionTag("saved")} />
            {section.groups
              .filter((group) => settingsOf(group).length > 0)
              .map((group) => (
                <GroupCard
                  key={group}
                  id={group}
                  title={titleOf(group)}
                  settings={settingsOf(group)}
                  practice={practice}
                  values={values}
                  onChange={onChange}
                  nameOf={nameOf}
                  methodLinks={methodLinks}
                  canManage={canManage}
                />
              ))}
          </div>
        ))}
        {groups
          .filter((group) => !knownGroups.includes(group))
          .map((group) => (
            <GroupCard
              key={group}
              id={group}
              title={titleOf(group)}
              settings={settingsOf(group)}
              practice={practice}
              values={values}
              onChange={onChange}
              nameOf={nameOf}
              methodLinks={methodLinks}
              canManage={canManage}
            />
          ))}
      </form>
      <p className="text-sm text-ink-3">
        {t("admin.practice.thresholdsLiveElsewhere")}{" "}
        <Link href="/admin/rhythm" className="text-brand-text underline">
          {t("admin.rhythm.rhythmAndThresholds")}
        </Link>
      </p>
      {canManage ? (
        <SettingsSaveBar
          mode="sticky"
          formId={FORM_ID}
          data-testid="practice-save-bar"
          unsavedTestId="practice-unsaved"
          unsaved={unsaved}
          saved={dirty ? null : state.saved}
          error={state.error}
          pending={pending}
        />
      ) : null}
    </div>
  );
}
