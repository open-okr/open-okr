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
]);
