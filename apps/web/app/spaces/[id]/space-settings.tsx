"use client";

import { CHECK_IN_FREQUENCIES, COACH_STRICTNESS } from "@openokr/method";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  useTranslations,
} from "@openokr/ui";
import { useActionState } from "react";
import { updateSpaceSettings } from "../actions.ts";
import { NO_SPACE_ERROR } from "../write-state.ts";

/**
 * §4.14's space scope, on the space it belongs to (P6-G18b, GAP-AUDIT B-09).
 *
 * **The scope existed in the map and nowhere else.** `spaces.settings` has
 * been a jsonb column since P3-T01 with a type saying "team voting, strictness
 * override and space defaults", and nothing declared those three, nothing
 * defaulted them and nothing wrote them. A space could be renamed and its
 * membership changed; it could not decide anything about how it works.
 *
 * **Empty means the workspace's, and the copy says so.** Both overrides are
 * nullable, and a space that has decided nothing inherits. Showing the
 * workspace's current value as a pre-selected option would be a lie that
 * hardens into a stored one the moment somebody presses save.
 *
 * **Behind the space manager's own level**, which is what §4.14's row asks
 * for. The action refuses independently: the interface never hides an
 * authorisation, it only avoids offering what will be refused.
 */

export interface SpaceSettings {
  readonly teamVoting: boolean;
  readonly coachStrictness: string | null;
  readonly defaultCheckInFrequency: string | null;
  /** The channel this space posts its digest to, per provider (M-23). */
  readonly slackChannel: string | null;
  readonly teamsChannel: string | null;
}

/** The two providers a space can post to, as AI-NATIVE-PLAN §5.2 names them. */
type PostProvider = "slack" | "teams";

const CHANNEL_FIELDS: readonly {
  readonly provider: PostProvider;
  readonly name: "slackChannel" | "teamsChannel";
  readonly label: string;
  readonly placeholder: string;
}[] = [
  {
    provider: "slack",
    name: "slackChannel",
    label: "spaces.detail.spaceSettings.slackChannel",
    placeholder: "C0123ABCD",
  },
  {
    provider: "teams",
    name: "teamsChannel",
    label: "spaces.detail.spaceSettings.teamsChannel",
    placeholder: "19:…@thread.tacv2",
  },
];

/**
 * Where this space's digest is posted (AI-NATIVE-PLAN §5.2, completeness
 * review M-23).
 *
 * **A field only for a provider the workspace has connected.** A channel id on
 * a provider nobody connected is a link that never posts, and the field would
 * invite it. With neither connected the card says who can change that, rather
 * than drawing two inputs that do nothing.
 */
function ChannelFields({
  settings,
  connected,
}: {
  readonly settings: SpaceSettings;
  readonly connected: readonly string[];
}) {
  const { t } = useTranslations();
  const offered = CHANNEL_FIELDS.filter((field) =>
    connected.includes(field.provider),
  );

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-ink">
        {t("spaces.detail.spaceSettings.whereTheDigestIsPosted")}
      </legend>
      {offered.length === 0 ? (
        <span className="text-xs text-ink-3">
          {t("spaces.detail.spaceSettings.noChannelConnected")}
        </span>
      ) : (
        <>
          {offered.map((field) => (
            <label key={field.name} className="flex flex-col gap-1">
              <span className="text-sm text-ink-2">{t(field.label)}</span>
              <input
                name={field.name}
                defaultValue={settings[field.name] ?? ""}
                placeholder={field.placeholder}
                spellCheck={false}
                autoComplete="off"
                className="w-72 rounded-md border border-line bg-bg px-2 py-1 font-mono text-xs"
              />
            </label>
          ))}
          <span className="text-xs text-ink-3">
            {t("spaces.detail.spaceSettings.channelHint")}
          </span>
        </>
      )}
    </fieldset>
  );
}

/** What a reader who cannot change it sees: where it posts, or that it does not. */
function channelSummary(
  settings: SpaceSettings,
  t: (key: string, values?: Record<string, string>) => string,
): string {
  const linked = [
    settings.slackChannel ? `Slack (${settings.slackChannel})` : null,
    settings.teamsChannel ? `Teams (${settings.teamsChannel})` : null,
  ].filter((one): one is string => one !== null);
  return linked.length > 0
    ? t("spaces.detail.spaceSettings.postsItsDigestTo", {
        channels: linked.join(", "),
      })
    : t("spaces.detail.spaceSettings.postsItsDigestNowhere");
}

/** What each strictness does, rather than three words to guess between. */
function strictnessMeaning(option: string, t: (key: string) => string): string {
  switch (option) {
    case "advisory":
      return t("spaces.detail.spaceSettings.strictnessAdvisory");
    case "warn":
      return t("spaces.detail.spaceSettings.strictnessWarn");
    case "strict":
      return t("spaces.detail.spaceSettings.strictnessStrict");
    default:
      return "";
  }
}

export function SpaceSettingsCard({
  spaceId,
  settings,
  workspaceStrictness,
  workspaceFrequency,
  canManage,
  connectedProviders = [],
}: {
  readonly spaceId: string;
  readonly settings: SpaceSettings;
  /** What this space inherits today, so "the workspace's" names a value. */
  readonly workspaceStrictness: string;
  readonly workspaceFrequency: string;
  readonly canManage: boolean;
  /** Providers the workspace has connected, so only those are offered. */
  readonly connectedProviders?: readonly string[];
}) {
  const { t } = useTranslations();

  const [state, submit, pending] = useActionState(
    updateSpaceSettings,
    NO_SPACE_ERROR,
  );

  if (!canManage) {
    return (
      <Card>
        <CardHeader className="justify-between">
          <h2 className="font-semibold text-ink">
            {t("spaces.detail.spaceSettings.spaceSettings")}
          </h2>
          <Chip tone={settings.teamVoting ? "ok" : "neutral"}>
            {settings.teamVoting
              ? t("spaces.detail.spaceSettings.teamVotingOn")
              : t("spaces.detail.spaceSettings.teamVotingOff")}
          </Chip>
        </CardHeader>
        <CardBody className="flex flex-col gap-1 text-sm text-ink-2">
          <p>
            {settings.coachStrictness !== null
              ? t("spaces.detail.spaceSettings.coachingStrictness3", {
                  workspaceStrictness: settings.coachStrictness,
                })
              : t("spaces.detail.spaceSettings.coachingStrictnessInherited", {
                  workspaceStrictness,
                })}
          </p>
          <p>
            {settings.defaultCheckInFrequency !== null
              ? t("spaces.detail.spaceSettings.defaultCheckInFrequency3", {
                  workspaceFrequency: settings.defaultCheckInFrequency,
                })
              : t(
                  "spaces.detail.spaceSettings.defaultCheckInFrequencyInherited",
                  { workspaceFrequency },
                )}
          </p>
          <p>{channelSummary(settings, t)}</p>
          <p className="text-xs text-ink-3">
            {t("spaces.detail.spaceSettings.changingTheseIsThe")}
          </p>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <h2 className="font-semibold text-ink">
          {t("spaces.detail.spaceSettings.spaceSettings")}
        </h2>
        <p className="text-sm text-ink-3">
          {t("spaces.detail.spaceSettings.whatThisTeamDoes")}
        </p>
      </CardHeader>
      <CardBody>
        <form
          action={submit}
          aria-busy={pending}
          className="flex flex-col gap-3.5 text-sm"
        >
          <input type="hidden" name="id" value={spaceId} />

          <label className="flex items-start gap-2.5">
            <input
              type="checkbox"
              name="teamVoting"
              defaultChecked={settings.teamVoting}
              className="mt-0.5 size-4"
            />
            <span className="flex flex-col">
              <span className="text-ink">
                {t("spaces.detail.spaceSettings.teamVoting")}
              </span>
              <span className="text-xs text-ink-3">
                {t("spaces.detail.spaceSettings.theRetroSVoting")}
              </span>
            </span>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-ink">
              {t("spaces.detail.spaceSettings.coachingStrictness")}
            </span>
            <select
              name="coachStrictness"
              defaultValue={settings.coachStrictness ?? ""}
              className="w-72 rounded-md border border-line bg-bg px-2 py-1"
            >
              <option value="">
                {t("spaces.detail.spaceSettings.theWorkspaceS", {
                  workspaceStrictness,
                })}
              </option>
              {COACH_STRICTNESS.map((option) => (
                <option key={option} value={option}>
                  {option}: {strictnessMeaning(option, t)}
                </option>
              ))}
            </select>
            <span className="text-xs text-ink-3">
              {t("spaces.detail.spaceSettings.appliesToThisSpace")}
            </span>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-ink">
              {t("spaces.detail.spaceSettings.defaultCheckInFrequency")}
            </span>
            <select
              name="defaultCheckInFrequency"
              defaultValue={settings.defaultCheckInFrequency ?? ""}
              className="w-72 rounded-md border border-line bg-bg px-2 py-1"
            >
              <option value="">
                {t("spaces.detail.spaceSettings.theWorkspaceS3", {
                  workspaceFrequency,
                })}
              </option>
              {CHECK_IN_FREQUENCIES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <span className="text-xs text-ink-3">
              {t("spaces.detail.spaceSettings.aTeamShippingDaily")}
            </span>
          </label>

          <ChannelFields settings={settings} connected={connectedProviders} />

          <div className="flex flex-col gap-1">
            <Button type="submit" disabled={pending} className="self-start">
              {pending
                ? t("spaces.detail.spaceSettings.saving")
                : t("spaces.detail.spaceSettings.saveSpaceSettings")}
            </Button>
            {state.error ? (
              <p
                role="alert"
                data-testid="space-settings-error"
                className="text-xs text-bad"
              >
                {state.error}
              </p>
            ) : state.saved ? (
              <p
                role="status"
                data-testid="space-settings-saved"
                className="text-xs text-ok"
              >
                {t("spaces.detail.spaceSettings.savedAnythingLeftAs")}
              </p>
            ) : null}
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
