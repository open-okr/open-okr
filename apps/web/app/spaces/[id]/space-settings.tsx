"use client";

import { CHECK_IN_FREQUENCIES, COACH_STRICTNESS } from "@openokr/method";
import { Button, Card, CardBody, CardHeader, Chip } from "@openokr/ui";
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
}

/** What each strictness does, rather than three words to guess between. */
const STRICTNESS_MEANING: Record<string, string> = {
  advisory: "the Coach comments and refuses nothing",
  warn: "the Coach warns, and the six publish gates still refuse",
  strict: "the Coach refuses what it warns about",
};

export function SpaceSettingsCard({
  spaceId,
  settings,
  workspaceStrictness,
  workspaceFrequency,
  canManage,
}: {
  readonly spaceId: string;
  readonly settings: SpaceSettings;
  /** What this space inherits today, so "the workspace's" names a value. */
  readonly workspaceStrictness: string;
  readonly workspaceFrequency: string;
  readonly canManage: boolean;
}) {
  const [state, submit, pending] = useActionState(
    updateSpaceSettings,
    NO_SPACE_ERROR,
  );

  if (!canManage) {
    return (
      <Card>
        <CardHeader className="justify-between">
          <h2 className="font-semibold text-ink">Space settings</h2>
          <Chip tone={settings.teamVoting ? "ok" : "neutral"}>
            {settings.teamVoting ? "team voting on" : "team voting off"}
          </Chip>
        </CardHeader>
        <CardBody className="flex flex-col gap-1 text-sm text-ink-2">
          <p>
            Coaching strictness:{" "}
            {settings.coachStrictness ??
              `the workspace's (${workspaceStrictness})`}
          </p>
          <p>
            Default check-in frequency:{" "}
            {settings.defaultCheckInFrequency ??
              `the workspace's (${workspaceFrequency})`}
          </p>
          <p className="text-xs text-ink-3">
            Changing these is the space manager's.
          </p>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <h2 className="font-semibold text-ink">Space settings</h2>
        <p className="text-sm text-ink-3">
          What this team does differently. Everything left as the workspace's
          follows the workspace, including when the workspace changes it.
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
              <span className="text-ink">Team voting</span>
              <span className="text-xs text-ink-3">
                The retro's voting stage, which METHOD.md §8.1 gives every
                space. Turned off here, a vote is refused rather than merely
                hidden.
              </span>
            </span>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-ink">Coaching strictness</span>
            <select
              name="coachStrictness"
              defaultValue={settings.coachStrictness ?? ""}
              className="w-72 rounded-md border border-line bg-bg px-2 py-1"
            >
              <option value="">The workspace's ({workspaceStrictness})</option>
              {COACH_STRICTNESS.map((option) => (
                <option key={option} value={option}>
                  {option}: {STRICTNESS_MEANING[option] ?? ""}
                </option>
              ))}
            </select>
            <span className="text-xs text-ink-3">
              Applies to this space's goals and to no others. The six publish
              gates stay hard whatever this says.
            </span>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-ink">Default check-in frequency</span>
            <select
              name="defaultCheckInFrequency"
              defaultValue={settings.defaultCheckInFrequency ?? ""}
              className="w-72 rounded-md border border-line bg-bg px-2 py-1"
            >
              <option value="">The workspace's ({workspaceFrequency})</option>
              {CHECK_IN_FREQUENCIES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <span className="text-xs text-ink-3">
              A team shipping daily and a team shipping quarterly are the same
              workspace.
            </span>
          </label>

          <div className="flex flex-col gap-1">
            <Button type="submit" disabled={pending} className="self-start">
              {pending ? "Saving…" : "Save space settings"}
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
                Saved. Anything left as the workspace's still follows it.
              </p>
            ) : null}
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
