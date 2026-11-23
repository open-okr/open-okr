/**
 * The most-seen sentences the domain refuses with, and the catalogue key that
 * says each in the reader's language.
 *
 * The domain throws these as English literals at hundreds of sites and the
 * REST bodies keep them as they are, so the screens translate by exact
 * sentence instead of every site changing. A message not listed here is shown
 * as written. `error-messages.test.ts` fails when a sentence no longer
 * occurs in `packages/core`, so a renamed message cannot fall back silently.
 */
export const ERROR_MESSAGE_KEYS: ReadonlyMap<string, string> = new Map([
  ["No such workspace.", "error.noSuchWorkspace"],
  ["No such member.", "error.noSuchMember"],
  ["No such key result.", "error.noSuchKeyResult"],
  ["No such session.", "error.noSuchSession"],
  ["No such cycle.", "error.noSuchCycle"],
  ["No such goal.", "error.noSuchGoal"],
  ["No such space.", "error.noSuchSpace"],
  ["No such KPI.", "error.noSuchKpi"],
  ["No such document.", "error.noSuchDocument"],
  ["No such dependency.", "error.noSuchDependency"],
  ["No such task.", "error.noSuchTask"],
  ["No such agent.", "error.noSuchAgent"],
  ["No such notification.", "error.noSuchNotification"],
  ["No such initiative.", "error.noSuchInitiative"],
  ["No such file.", "error.noSuchFile"],
  ["No such check-in.", "error.noSuchCheckIn"],
  ["No such role.", "error.noSuchRole"],
  ["No such page.", "error.noSuchPage"],
  ["No such conversation.", "error.noSuchConversation"],
  [
    "No such space, or you do not have access to it.",
    "error.noSuchSpaceOrNoAccess",
  ],
  [
    "No such KPI, or you do not have access to it.",
    "error.noSuchKpiOrNoAccess",
  ],
  [
    "No such task, or you do not have access to it.",
    "error.noSuchTaskOrNoAccess",
  ],
  [
    "No such initiative, or you do not have access to it.",
    "error.noSuchInitiativeOrNoAccess",
  ],
  [
    "No such workspace, or you are not a member of it.",
    "error.noSuchWorkspaceOrNotMember",
  ],
  ["That did not save.", "error.thatDidNotSave"],
  ["A system actor cannot do this.", "error.systemActorCannot"],
  ["That would make the alignment circular.", "error.alignmentCircular"],
  ["That proposal has already been decided.", "error.proposalAlreadyDecided"],
  ["This cycle is already closed.", "error.cycleAlreadyClosed"],
  [
    "This space would have no manager. Appoint another one first.",
    "error.spaceWouldHaveNoManager",
  ],
  ["The end of the range is before its start.", "error.rangeEndBeforeStart"],
  [
    "No such single sign-on connection in this workspace.",
    "error.noSuchSsoConnection",
  ],
  ["No member to update.", "error.noMemberToUpdate"],
  ["No such objective.", "error.noSuchObjective"],
  ["No such custom model.", "error.noSuchCustomModel"],
  ["There is no such run.", "error.noSuchRun"],
  ["There is no such goal.", "error.noSuchGoalThere"],
  ["No such webhook.", "error.noSuchWebhook"],
  ["No such subject.", "error.noSuchSubject"],
  ["No such setting.", "error.noSuchSetting"],
  ["No such proposal.", "error.noSuchProposal"],
  ["No such note.", "error.noSuchNote"],
  ["No such finding.", "error.noSuchFinding"],
  ["No such blocker.", "error.noSuchBlocker"],
  ["No such account.", "error.noSuchAccount"],
  ["No such KPI value.", "error.noSuchKpiValue"],
  [
    "No such blob, or you do not have access to it.",
    "error.noSuchBlobOrNoAccess",
  ],
  ["That objective is not in this review.", "error.objectiveNotInReview"],
  [
    "The watch threshold cannot sit above the healthy threshold. Both bands are read from below.",
    "error.watchAboveHealthy",
  ],
  [
    "The publication deadline falls on or after the cycle starts. Publish before day one.",
    "error.publicationDeadlineAfterStart",
  ],
  ["That member is not in this space.", "error.memberNotInSpace"],
  ["No digest exists for this session yet.", "error.noDigestYet"],
  [
    "This cycle is closed. Its record does not change after the archive.",
    "error.cycleClosedRecordFixed",
  ],
  ["This goal is already closed.", "error.goalAlreadyClosed"],
  ["This goal is not closed.", "error.goalNotClosed"],
  ["This cycle is not closing.", "error.cycleNotClosing"],
  ["This cycle is already published.", "error.cycleAlreadyPublished"],
  ["This cycle is already closing.", "error.cycleAlreadyClosing"],
  ["You are not in this space.", "error.notInSpace"],
  [
    "You are this space's only manager. Appoint another one first.",
    "error.onlyManagerOfSpace",
  ],
  ["The Coach is turned off.", "error.coachOff"],
  ["This agent is turned off.", "error.agentOff"],
  ["This file has no preview.", "error.fileNoPreview"],
  ["This check-in can no longer be edited.", "error.checkInNotEditable"],
  ["Your role does not grant enough access on KPIs.", "error.roleNotEnoughKpi"],
  ["You can only remove your own reaction.", "error.ownReactionOnly"],
  ["This objective is already in that space.", "error.objectiveAlreadyInSpace"],
  [
    "This KPI is calculated from a formula, so its values cannot be typed in.",
    "error.kpiFormulaNoTyping",
  ],
  [
    "This KPI is calculated from a formula, so its values cannot be removed.",
    "error.kpiFormulaNoRemoval",
  ],
  [
    "Your email domain is not trusted by this workspace.",
    "error.domainNotTrusted",
  ],
  [
    "This invitation was issued to a different email address.",
    "error.invitationDifferentEmail",
  ],
  [
    "Your email domain is not allowed to use this invitation.",
    "error.invitationDomainNotAllowed",
  ],
  [
    "This webhook is off. Turn it on before sending anything again.",
    "error.webhookOff",
  ],
  [
    "Agents cannot be granted individual KPI shares.",
    "error.agentsNoKpiShares",
  ],
]);

/**
 * Translates an error's sentence by exact match, for the screens that hold a
 * caught `Error` rather than an `OperationError`: a client component sees a
 * server action's failure as a plain `Error` carrying the same message. Any
 * other sentence is shown as it was written. Imports nothing from the domain,
 * so a client component may use it.
 */
export function translateErrorMessage(
  message: string,
  t: ((key: string) => string) | undefined,
): string {
  if (!t) {
    return message;
  }
  if (/\bneeds a higher access level than you hold\.$/.test(message)) {
    return t("refusal.forbidden");
  }
  const key = ERROR_MESSAGE_KEYS.get(message);
  return key === undefined ? message : t(key);
}
