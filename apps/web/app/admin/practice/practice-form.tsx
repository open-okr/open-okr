"use client";

import type { callAction } from "@openokr/core";
import type { ProfileSwitch } from "@openokr/method";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  cn,
  useFormDirty,
  useKeyboardRegistry,
  useSubmitShortcut,
  useToast,
  useTranslations,
  useUnsavedGuard,
} from "@openokr/ui";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  useActionState,
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { applyProfile, resetPractice, savePractice } from "./practice-actions";
import { NOTHING_SAVED, type PracticeState } from "./practice-state.ts";

/**
 * Choosing and changing the METHOD.md §12 practice (S-36, P9-T05).
 *
 * **Generated from the registry**, like the rhythm card: every setting is a
 * select of its own options in §12.1's words, grouped by the registry's own
 * groups, and nothing here names a setting key. A setting added to §12 appears
 * with no change to this file.
 *
 * **One form per card, each with its own save**, which is the pattern the
 * rhythm card arrived at (P8-G11) after one save at the bottom of a long page
 * left edits uncommitted ten screens away. The profile is a card of its own,
 * above the rest, because choosing one changes many settings at once and the
 * reader should see which before saying yes.
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

/** One status line per card, announced as a toast, whichever action wrote it. */
function useOutcomeToast(
  outcome: PracticeState,
  title: string,
  source: string,
): void {
  const toast = useToast();
  const last = useRef<PracticeState>(NOTHING_SAVED);
  useEffect(() => {
    if (last.current === outcome) {
      return;
    }
    last.current = outcome;
    if (outcome.error !== null) {
      toast.show({ tone: "bad", title, message: outcome.error, source });
    } else if (outcome.saved !== null) {
      toast.show({ tone: "ok", title, message: outcome.saved, source });
    }
  }, [outcome, title, source, toast]);
}

/** The name a person reads for one setting, with its item where it has one. */
function useSettingName(
  checkTitles: Readonly<Record<string, string>>,
  gateTitles: readonly string[],
): (setting: Setting) => string {
  return useCallback(
    (setting: Setting) => {
      if (setting.item === null) {
        return setting.label;
      }
      if (setting.group === "checks" && checkTitles[setting.item]) {
        return `${setting.item} ${checkTitles[setting.item]}`;
      }
      if (setting.group === "gates") {
        const gate = Number(setting.item.replace(/\D/g, ""));
        const title = gateTitles[gate - 1];
        return title ? `${setting.item}: ${title}` : setting.item;
      }
      return `${setting.label}: ${setting.item}`;
    },
    [checkTitles, gateTitles],
  );
}

/** The profile card: the five §12.2 profiles, and what choosing one changes. */
function ProfileCard({
  practice,
  previews,
  thresholdLabels,
  nameOf,
  canManage,
}: {
  readonly practice: Practice;
  readonly previews: Readonly<Record<string, ProfileSwitch>>;
  readonly thresholdLabels: Readonly<Record<string, string>>;
  readonly nameOf: (setting: Setting) => string;
  readonly canManage: boolean;
}) {
  const { t } = useTranslations();
  const [state, submit, pending] = useActionState(applyProfile, NOTHING_SAVED);
  const [chosen, setChosen] = useState<string>(practice.profile);
  const title = t("admin.practice.profile.title");
  useOutcomeToast(state, title, "practice-profile");

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
        <CardHeader className="flex-wrap justify-between">
          <div className="flex flex-col gap-0.5">
            <h2 className="font-semibold text-ink">{title}</h2>
            <p className="text-sm text-ink-3">
              {t("admin.practice.profile.description")}
            </p>
          </div>
          {canManage ? (
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={pending || chosen === practice.profile}
            >
              {pending
                ? t("admin.practice.profile.applying")
                : t("admin.practice.profile.use")}
            </Button>
          ) : null}
        </CardHeader>
        <CardBody className="flex flex-col gap-3">
          <fieldset className="flex flex-col gap-1.5">
            <legend className="sr-only">{title}</legend>
            {practice.profiles.map((profile) => (
              <label
                key={profile.key}
                className={cn(
                  "flex items-start gap-2.5 rounded-control border px-3 py-2 text-sm",
                  chosen === profile.key
                    ? "border-brand bg-brand-weak"
                    : "border-line",
                )}
              >
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
            ))}
          </fieldset>

          {preview ? (
            <section
              aria-live="polite"
              data-testid="practice-profile-preview"
              className="flex flex-col gap-1.5 rounded-control bg-ink/[0.03] px-3 py-2.5 text-sm"
            >
              <h3 className="font-semibold text-ink-2">
                {t("admin.practice.profile.changes", { profile: chosenLabel })}
              </h3>
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
      </Card>
    </form>
  );
}

/** "Reset to profile", for one card's settings. */
function ResetCard({
  keys,
  disabled,
  onOutcome,
}: {
  readonly keys: readonly string[];
  readonly disabled: boolean;
  readonly onOutcome: (outcome: PracticeState) => void;
}) {
  const { t } = useTranslations();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={disabled || pending}
      onClick={() => {
        if (!window.confirm(t("admin.practice.resetConfirm"))) {
          return;
        }
        start(async () => {
          onOutcome(await resetPractice(keys));
        });
      }}
      className="rounded-md border border-line px-2 py-1 text-xs font-semibold text-ink-2 disabled:opacity-60"
    >
      {pending ? t("admin.practice.resetting") : t("admin.practice.resetCard")}
    </button>
  );
}

/** One §12.1 group: a form of selects with its own save and reset. */
function GroupCard({
  id,
  title,
  settings,
  practice,
  nameOf,
  canManage,
}: {
  readonly id: string;
  readonly title: string;
  readonly settings: readonly Setting[];
  readonly practice: Practice;
  readonly nameOf: (setting: Setting) => string;
  readonly canManage: boolean;
}) {
  const { t } = useTranslations();
  const form = useRef<HTMLFormElement>(null);
  const [state, submit, pending] = useActionState(savePractice, NOTHING_SAVED);
  const [reset, setReset] = useState<PracticeState>(NOTHING_SAVED);
  // Whichever happened last is the one on screen, so a refused save does not
  // stay above a reset that then succeeded.
  const [showingReset, setShowingReset] = useState(false);
  const { dirty, markSaved } = useFormDirty(form);
  const onKeyDown = useSubmitShortcut(canManage);
  useUnsavedGuard(`practice:${id}`, dirty);

  const profile = practice.profiles.find(
    (entry) => entry.key === practice.profile,
  );
  const profileValueOf = (setting: Setting): string =>
    (profile?.practice[setting.key] as string | undefined) ?? setting.default;

  // **React resets a form with an `action` once the action resolves, and a
  // select goes back to the option it was first rendered with**, not to the
  // value the revalidated page now holds: a select's `defaultValue` is read
  // once. So the values sent are put back afterwards, which on a save is what
  // the server now holds and on a refusal is what somebody chose and has not
  // finished with. The rhythm card does the same for the same reason.
  const submitted = useRef<ReadonlyMap<string, string> | null>(null);
  const onSubmit = useCallback(() => {
    const element = form.current;
    if (element === null) {
      return;
    }
    const held = new Map<string, string>();
    for (const select of element.querySelectorAll("select")) {
      held.set(select.name, select.value);
    }
    submitted.current = held;
  }, []);

  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !pending) {
      setShowingReset(false);
      for (const [name, value] of submitted.current ?? []) {
        const field = form.current?.elements.namedItem(name);
        if (field instanceof HTMLSelectElement) {
          field.value = value;
        }
      }
      if (state.error === null) {
        markSaved();
      }
    }
    wasPending.current = pending;
  }, [pending, state, markSaved]);

  const outcome = showingReset ? reset : state;
  useOutcomeToast(outcome, title, `practice-${id}`);

  const changed = settings.filter((setting) =>
    practice.differsFromProfile.includes(setting.key),
  );

  // A reset is a button, not the form's action, so nothing resets the form;
  // the selects it returned are set to the profile's values here instead.
  const afterReset = (next: PracticeState) => {
    setReset(next);
    setShowingReset(true);
    if (next.error !== null) {
      return;
    }
    for (const setting of changed) {
      const field = form.current?.elements.namedItem(`practice:${setting.key}`);
      if (field instanceof HTMLSelectElement) {
        field.value = profileValueOf(setting);
      }
    }
    markSaved();
  };

  return (
    <form
      ref={form}
      action={submit}
      aria-busy={pending}
      onSubmit={onSubmit}
      onKeyDown={onKeyDown}
      data-testid={`practice-card-${id}`}
    >
      <Card>
        <CardHeader className="sticky top-0 z-10 flex-wrap justify-between rounded-t-lg bg-surface">
          <h2 className="font-semibold text-ink">{title}</h2>
          <div className="flex items-center gap-2">
            {dirty && canManage ? (
              <Chip tone="brand">{t("common.unsaved")}</Chip>
            ) : null}
            {changed.length > 0 ? (
              <ResetCard
                keys={changed.map((setting) => setting.key)}
                disabled={!canManage}
                onOutcome={afterReset}
              />
            ) : null}
            {canManage ? (
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={pending}
              >
                {pending
                  ? t("admin.rhythm.rhythmForm.saving")
                  : t("common.save")}
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardBody className="flex flex-col gap-3">
          {settings.map((setting) => {
            const differs = practice.differsFromProfile.includes(setting.key);
            const profileValue = profileValueOf(setting);
            const fieldId = `practice-${setting.key}`;
            return (
              <div
                key={setting.key}
                className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <label htmlFor={fieldId} className="font-medium text-ink">
                    {nameOf(setting)}
                  </label>
                  <span className="text-xs text-ink-4">
                    {t("admin.practice.section", {
                      section: setting.section,
                      source: setting.source,
                    })}
                  </span>
                  {differs ? (
                    <span className="text-xs text-ink-3">
                      {t("admin.practice.profileValue", {
                        value:
                          setting.optionLabels[profileValue] ?? profileValue,
                      })}
                    </span>
                  ) : null}
                </div>
                <div className="flex flex-none items-center gap-2">
                  {differs ? (
                    <Chip tone="brand">{t("admin.practice.differs")}</Chip>
                  ) : null}
                  <select
                    id={fieldId}
                    name={`practice:${setting.key}`}
                    disabled={!canManage}
                    defaultValue={practice.practice[setting.key]}
                    className="rounded-md border border-line bg-bg px-2 py-1 text-sm"
                  >
                    {setting.options.map((option) => (
                      <option key={option} value={option}>
                        {setting.optionLabels[option] ?? option}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            );
          })}
        </CardBody>
      </Card>
    </form>
  );
}

export function PracticeForm({
  practice,
  previews,
  thresholdLabels,
  checkTitles,
  gateTitles,
  canManage,
}: {
  readonly practice: Practice;
  /** What choosing each other profile would change, from `switchProfile`. */
  readonly previews: Readonly<Record<string, ProfileSwitch>>;
  /** §11's own labels, for the thresholds a profile moves. */
  readonly thresholdLabels: Readonly<Record<string, string>>;
  /** §4's title for each check, so a check reads as more than its id. */
  readonly checkTitles: Readonly<Record<string, string>>;
  readonly gateTitles: readonly string[];
  /**
   * `full`, which every practice write requires. The server refuses either
   * way; this says so before somebody fills a card in.
   */
  readonly canManage: boolean;
}) {
  const { t } = useTranslations();
  const nameOf = useSettingName(checkTitles, gateTitles);
  const groups = [...new Set(practice.registry.map((entry) => entry.group))];
  const { register, unregister } = useKeyboardRegistry();

  useEffect(() => {
    register({
      id: "form.save",
      keys: "⌘⏎",
      description: t("admin.rhythm.rhythmForm.saveTheCardShortcut"),
      group: "Detail",
    });
    return () => unregister("form.save");
  }, [register, unregister, t]);

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

  return (
    <div className="flex flex-col gap-4.5">
      {notice}
      <ProfileCard
        practice={practice}
        previews={previews}
        thresholdLabels={thresholdLabels}
        nameOf={nameOf}
        canManage={canManage}
      />
      {groups.map((group) => (
        // Keyed on the profile as well, so a switch mounts every card afresh
        // with the new profile's values: a select reads its default once.
        <GroupCard
          key={`${group}:${practice.profile}`}
          id={group}
          title={GROUP_TITLES[group] ? t(GROUP_TITLES[group]) : group}
          settings={practice.registry.filter((entry) => entry.group === group)}
          practice={practice}
          nameOf={nameOf}
          canManage={canManage}
        />
      ))}
      <p className="text-sm text-ink-3">
        {t("admin.practice.thresholdsLiveElsewhere")}{" "}
        <Link href="/admin/rhythm" className="text-brand-text underline">
          {t("admin.rhythm.rhythmAndThresholds")}
        </Link>
      </p>
    </div>
  );
}
