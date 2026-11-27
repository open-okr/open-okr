/**
 * Every word the FlowyTeam flow refuses or finishes with, and the catalogue
 * key that says it in the reader's language (flowyteam-connect §4.5, card C5).
 *
 * The domain refuses with an English sentence and a `reason` word in the
 * error's details; the callback route lands on Import with the same word in
 * `?flowyteam=`; a failed import run stores it as `report.failure`. The card
 * translates by the word, so a sentence reworded in `packages/core` cannot
 * leave a reader with English. `flowyteam-messages.test.ts` fails when a
 * reason the domain can give has no key here.
 */
export const FLOWYTEAM_REASON_KEYS: ReadonlyMap<string, string> = new Map([
  // The callback's own outcomes.
  ["connected", "admin.imports.flowyteam.reason.connected"],
  ["denied", "admin.imports.flowyteam.reason.denied"],
  // Connecting (C3).
  ["not_configured", "admin.imports.flowyteam.reason.notConfigured"],
  ["wrong_scope", "admin.imports.flowyteam.reason.wrongScope"],
  ["state_missing", "admin.imports.flowyteam.reason.stateMissing"],
  ["state_invalid", "admin.imports.flowyteam.reason.stateInvalid"],
  ["state_expired", "admin.imports.flowyteam.reason.stateExpired"],
  ["state_mismatch", "admin.imports.flowyteam.reason.stateMismatch"],
  [
    "state_other_workspace",
    "admin.imports.flowyteam.reason.stateOtherWorkspace",
  ],
  ["state_other_member", "admin.imports.flowyteam.reason.stateOtherMember"],
  // FlowyTeam's answers (C3, C4).
  ["version_mismatch", "admin.imports.flowyteam.reason.versionMismatch"],
  ["unauthorised", "admin.imports.flowyteam.reason.unauthorised"],
  ["refused", "admin.imports.flowyteam.reason.refused"],
  ["unreachable", "admin.imports.flowyteam.reason.unreachable"],
  ["bad_answer", "admin.imports.flowyteam.reason.badAnswer"],
  // Preview and import (C4).
  ["background_off", "admin.imports.flowyteam.reason.backgroundOff"],
  ["not_connected", "admin.imports.flowyteam.reason.notConnected"],
  ["revoked", "admin.imports.flowyteam.reason.revoked"],
  ["other_company", "admin.imports.flowyteam.reason.otherCompany"],
  ["already_running", "admin.imports.flowyteam.reason.alreadyRunning"],
  [
    "visibility_not_accepted",
    "admin.imports.flowyteam.reason.visibilityNotAccepted",
  ],
  // An operation's code when it gave no reason: below `full`, or gone.
  ["forbidden", "admin.imports.flowyteam.reason.forbidden"],
  ["not_found", "admin.imports.flowyteam.reason.notConnected"],
  ["error", "admin.imports.flowyteam.reason.error"],
]);

/** The key for a reason word, or the generic one for a word nobody listed. */
export function flowyteamReasonKey(reason: string): string {
  return (
    FLOWYTEAM_REASON_KEYS.get(reason) ?? "admin.imports.flowyteam.reason.error"
  );
}

/** Outcomes that are good news rather than a refusal. */
export function isFlowyteamSuccess(reason: string): boolean {
  return reason === "connected";
}

/**
 * The catalogue keys whose message has a `{source}` hole: the name the
 * workspace's instance gives the system an import comes from (default
 * OKRI.io, setting `imports.flowyteam.displayName`). A message passed a value
 * it has no hole for throws, so the keys are listed and
 * `flowyteam-messages.test.ts` fails when the list and the catalogue differ.
 */
export const FLOWYTEAM_SOURCE_KEYS: ReadonlySet<string> = new Set([
  "admin.imports.flowyteam.kpiShares.rowsRead",
  "admin.imports.flowyteam.col.inFlowyteam",
  "admin.imports.flowyteam.connect",
  "admin.imports.flowyteam.connectHint",
  "admin.imports.flowyteam.connectIntro",
  "admin.imports.flowyteam.description",
  "admin.imports.flowyteam.disconnectConfirm",
  "admin.imports.flowyteam.importNewDataBody",
  "admin.imports.flowyteam.inviteEveryone",
  "admin.imports.flowyteam.nothingToBring",
  "admin.imports.flowyteam.notBroughtFoot",
  "admin.imports.flowyteam.previewHint",
  "admin.imports.flowyteam.previewingTitle",
  "admin.imports.flowyteam.reason.alreadyRunning",
  "admin.imports.flowyteam.reason.backgroundOff",
  "admin.imports.flowyteam.reason.badAnswer",
  "admin.imports.flowyteam.reason.connected",
  "admin.imports.flowyteam.reason.denied",
  "admin.imports.flowyteam.reason.error",
  "admin.imports.flowyteam.reason.notConfigured",
  "admin.imports.flowyteam.reason.notConnected",
  "admin.imports.flowyteam.reason.otherCompany",
  "admin.imports.flowyteam.reason.refused",
  "admin.imports.flowyteam.reason.revoked",
  "admin.imports.flowyteam.reason.stateExpired",
  "admin.imports.flowyteam.reason.stateInvalid",
  "admin.imports.flowyteam.reason.stateMismatch",
  "admin.imports.flowyteam.reason.stateMissing",
  "admin.imports.flowyteam.reason.stateOtherMember",
  "admin.imports.flowyteam.reason.stateOtherWorkspace",
  "admin.imports.flowyteam.reason.unauthorised",
  "admin.imports.flowyteam.reason.unreachable",
  "admin.imports.flowyteam.reason.versionMismatch",
  "admin.imports.flowyteam.reason.wrongScope",
  "admin.imports.flowyteam.restrictedBody",
  "admin.imports.flowyteam.revokedBody",
  "admin.imports.flowyteam.sourceFlowyteam",
  "admin.imports.flowyteam.title",
  "admin.imports.flowyteam.unavailable",
]);

type Translate = (
  key: string,
  values?: Record<string, string | number>,
) => string;

/** `t`, with `{source}` filled on the messages that name the source system. */
export function withFlowyteamSource<T extends Translate>(
  t: T,
  source: string,
): Translate {
  return (key, values) =>
    FLOWYTEAM_SOURCE_KEYS.has(key)
      ? t(key, { ...values, source })
      : t(key, values);
}
