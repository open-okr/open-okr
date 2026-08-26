/**
 * The action contract registry (TECHNICAL-PLAN §14).
 *
 * Every read and write in the product is declared here once: a name, its
 * input and output schemas, the access level it requires, and its safety
 * class. The internal typed client below is the first projection. REST,
 * OpenAPI, the MCP tool catalogue, the command line and the chat command
 * router are the rest, and they arrive in P5-T07 onwards generated from this
 * list rather than written again.
 *
 * One permission decision, everywhere: a surface cannot reach a capability
 * that is not in here, and cannot reach one on easier terms than it declares.
 */

import { workspaceFeed } from "./activities.ts";
import {
  bindAgentScope,
  bulkApplyProposedChanges,
  bulkDismissProposedChanges,
  cancelAgentRun,
  createAgent,
  listAgentRuns,
  listProposedChanges,
  readAgentRun,
  readAgents,
  runChampion,
  runCoach,
  setAgentEnabled,
  startAgentRun,
} from "./agents.ts";
import {
  readOwnCredentialStatus,
  readProviderConfig,
  removePersonalCredential,
  removeWorkspaceCredential,
  rotateCredentials,
  setPersonalCredential,
  setWorkspaceCredential,
  updateProviderConfig,
} from "./ai.ts";
import {
  addCustomModel,
  readFeatureSettings,
  readModelCatalog,
  readPrompt,
  readTierRouting,
  removeCustomModel,
  removeTierPolicy,
  restorePrompt,
  setTierPolicy,
  updateCustomModel,
  updateFeatureSetting,
  updatePrompt,
} from "./ai-models.ts";
import {
  readBudgets,
  readUsageSummary,
  removeBudget,
  setBudget,
} from "./ai-usage.ts";
import {
  addGoalDependency,
  addKeyResultDependency,
  applyAlignmentFinding,
  confirmKeyResultDependency,
  dismissAlignmentFinding,
  readAlignment,
  readAlignmentGraph,
  removeGoalDependency,
  removeKeyResultDependency,
  setDependencyRiskOwner,
} from "./alignment.ts";
import { claimUpload, getBlobForDownload, prepareUpload } from "./blobs.ts";
import {
  acknowledgeCheckIn,
  castConfidenceVote,
  deleteCheckIn,
  editCheckIn,
  listCheckIns,
  publishCheckIn,
  publishDraftedCheckIn,
  readConfidenceVotes,
  revealConfidenceVotes,
  startCheckIn,
} from "./check-ins.ts";
import {
  addReactionAction,
  createCommentAction,
  deleteCommentAction,
  listCommentsAction,
  listReactionsAction,
  previewNotifyAction,
  removeReactionAction,
  updateCommentAction,
} from "./comments.ts";
import {
  addIssue,
  addPriority,
  calibrateCycle,
  distributePack,
  publishCycle,
  readWorkflow,
  setBaselineHealth,
  setCapacityNotes,
  setIssueImpact,
  setPackItem,
  setRevalidation,
} from "./cycle-workflow.ts";
import {
  archiveCycle,
  createCycle,
  ensureCurrentCycle,
  feedForwardCycle,
  listCycles,
  readAnnualFrame,
  readCurrentCycle,
  readRhythmSettings,
  readScorecard,
  setAnnualFrame,
  snapshotCycle,
  updateCycle,
  updateRhythmSettings,
} from "./cycles.ts";
import type { ActionCallContext, ActionDefinition } from "./define.ts";
import { readGoalRelations } from "./goal-relations.ts";
import {
  closeGoal,
  createGoal,
  createKeyResult,
  goalReviewDecision,
  listDueGoals,
  listGoals,
  moveGoalToCycle,
  readGoal,
  readKeyResultHistory,
  reassignGoalRole,
  recordKeyResultValue,
  reopenGoal,
  rewriteKeyResult,
  unlinkKeyResultKpi,
  updateGoal,
  updateKeyResult,
} from "./goals.ts";
import {
  acceptLink,
  createPersonalLink,
  createWorkspaceLink,
  joinByTrustedDomain,
  revokeLink,
} from "./invitations.ts";
import {
  createKpi,
  createKpiCategory,
  createKpiTree,
  launchKpiRecovery,
  readKpiDetail,
  readKpiGrid,
  readKpiTree,
  readRecoveryBoard,
  readRecoveryDraft,
  recordKpiValue,
  setKpiFormulaAction,
  updateKpi,
} from "./kpis.ts";
import {
  getNotificationSettings,
  listNotifications,
  markNotificationRead,
  snoozeNotification,
  toggleSubscription,
  updateOwnNotificationSettings,
} from "./notifications.ts";
import { listNudges, nudgeVolume, runNudges, snoozeNudge } from "./nudges.ts";
import { workspaceOverview } from "./overview.ts";
import {
  convertToGuest,
  directory,
  eraseMember,
  orgChart,
  possibleManagersFor,
  restoreMember,
  suspendMember,
  updateMember,
  updateOwnProfile,
} from "./people.ts";
import { reviewInbox } from "./review.ts";
import {
  addRetroNote,
  addReviewAction,
  addStageMinute,
  advanceStage,
  captureLearning,
  castRetroVote,
  castSessionVote,
  closeSession,
  closeSessionCommitments,
  completeReviewAction,
  confirmSessionConfidence,
  createSession,
  createSessionBlocker,
  decideObjective,
  decisionsForCycle,
  decisionsForGoal,
  draftNextCycle,
  giveKudos,
  givePulse,
  listParticipants,
  listSessionCommitments,
  listSessions,
  openSession,
  passMic,
  readDiagnostic,
  readForward,
  readManagementRetro,
  readMonthlyRecord,
  readNarratives,
  readProcessHealth,
  readRecognition,
  readReset,
  readRetro,
  readRoomPulse,
  readRootCauses,
  readScoringStatus,
  readSession,
  readStreak,
  recordDecision,
  recordDiagnostic,
  removeRetroNote,
  resolveSessionBlocker,
  revealObjectiveScore,
  revealSessionVotes,
  scoreKeyResult,
  sessionBlockerStatus,
  sessionConfidenceStatus,
  sessionVotes,
  setCoordinatorNote,
  setManagementAnswer,
  setNarrative,
  setRootCause,
  setSessionCommitments,
  setShifts,
  setStageNote,
  setTrend,
  skipSession,
  submitProcessHealth,
} from "./sessions.ts";
import {
  readWorkspaceSettings,
  resetWorkspaceSettings,
  updateWorkspaceBranding,
  updateWorkspaceGeneralSettings,
} from "./settings.ts";
import {
  addSpaceMember,
  archiveSpace,
  createSpace,
  joinSpace,
  leaveSpace,
  listSpaces,
  readSpace,
  removeSpaceMember,
  setSpaceMemberRole,
  updateSpace,
} from "./spaces.ts";
import {
  provisionWorkspace,
  renameWorkspace,
  setWorkspaceState,
} from "./workspace.ts";

/**
 * The registry, keyed by name so the typed client can infer an action's input
 * and output from the name alone.
 */
export const ACTION_MAP = {
  "workspace.overview": workspaceOverview,
  "workspace.rename": renameWorkspace,
  "workspace.setState": setWorkspaceState,
  "workspace.provision": provisionWorkspace,
  "people.updateOwnProfile": updateOwnProfile,
  "people.updateMember": updateMember,
  "people.suspend": suspendMember,
  "people.restore": restoreMember,
  "people.convertToGuest": convertToGuest,
  "people.erase": eraseMember,
  "people.directory": directory,
  "people.orgChart": orgChart,
  "people.possibleManagers": possibleManagersFor,
  "invitations.createWorkspaceLink": createWorkspaceLink,
  "invitations.createPersonalLink": createPersonalLink,
  "invitations.revokeLink": revokeLink,
  "invitations.acceptLink": acceptLink,
  "invitations.joinByTrustedDomain": joinByTrustedDomain,
  "blobs.prepareUpload": prepareUpload,
  "blobs.claimUpload": claimUpload,
  "blobs.getForDownload": getBlobForDownload,
  "notifications.list": listNotifications,
  "notifications.markRead": markNotificationRead,
  "notifications.snooze": snoozeNotification,
  "notifications.getSettings": getNotificationSettings,
  "notifications.updateSettings": updateOwnNotificationSettings,
  "subscriptions.toggle": toggleSubscription,
  "activities.workspaceFeed": workspaceFeed,
  "settings.readWorkspaceSettings": readWorkspaceSettings,
  "settings.updateWorkspaceGeneral": updateWorkspaceGeneralSettings,
  "settings.updateWorkspaceBranding": updateWorkspaceBranding,
  "settings.resetWorkspaceSettings": resetWorkspaceSettings,
  "ai.readProviderConfig": readProviderConfig,
  "ai.updateProviderConfig": updateProviderConfig,
  "ai.setWorkspaceCredential": setWorkspaceCredential,
  "ai.removeWorkspaceCredential": removeWorkspaceCredential,
  "ai.setPersonalCredential": setPersonalCredential,
  "ai.removePersonalCredential": removePersonalCredential,
  "ai.readOwnCredentialStatus": readOwnCredentialStatus,
  "ai.rotateCredentials": rotateCredentials,
  "ai.readModelCatalog": readModelCatalog,
  "ai.addCustomModel": addCustomModel,
  "ai.updateCustomModel": updateCustomModel,
  "ai.removeCustomModel": removeCustomModel,
  "ai.readTierRouting": readTierRouting,
  "ai.setTierPolicy": setTierPolicy,
  "ai.removeTierPolicy": removeTierPolicy,
  "ai.readFeatureSettings": readFeatureSettings,
  "ai.updateFeatureSetting": updateFeatureSetting,
  "ai.readPrompt": readPrompt,
  "ai.updatePrompt": updatePrompt,
  "ai.restorePrompt": restorePrompt,
  "ai.readBudgets": readBudgets,
  "ai.setBudget": setBudget,
  "ai.removeBudget": removeBudget,
  "ai.readUsageSummary": readUsageSummary,
  "agents.list": readAgents,
  "agents.create": createAgent,
  "agents.setEnabled": setAgentEnabled,
  "agents.bindScope": bindAgentScope,
  "agents.startRun": startAgentRun,
  "agents.readRun": readAgentRun,
  "agents.cancelRun": cancelAgentRun,
  "agents.runChampion": runChampion,
  "agents.runCoach": runCoach,
  "agents.listRuns": listAgentRuns,
  "proposals.list": listProposedChanges,
  "proposals.bulkApply": bulkApplyProposedChanges,
  "proposals.bulkDismiss": bulkDismissProposedChanges,
  "spaces.list": listSpaces,
  "spaces.read": readSpace,
  "spaces.create": createSpace,
  "spaces.update": updateSpace,
  "spaces.archive": archiveSpace,
  "spaces.addMember": addSpaceMember,
  "spaces.setMemberRole": setSpaceMemberRole,
  "spaces.removeMember": removeSpaceMember,
  "spaces.join": joinSpace,
  "spaces.leave": leaveSpace,
  "cycles.list": listCycles,
  "cycles.current": readCurrentCycle,
  "cycles.ensureCurrent": ensureCurrentCycle,
  "cycles.create": createCycle,
  "cycles.update": updateCycle,
  "cycles.archive": archiveCycle,
  "cycles.snapshot": snapshotCycle,
  "cycles.feedForward": feedForwardCycle,
  "cycles.scorecard": readScorecard,
  "rhythm.read": readRhythmSettings,
  "rhythm.update": updateRhythmSettings,
  "frame.read": readAnnualFrame,
  "frame.set": setAnnualFrame,
  "workflow.read": readWorkflow,
  "workflow.setPackItem": setPackItem,
  "workflow.distributePack": distributePack,
  "workflow.addIssue": addIssue,
  "workflow.setIssueImpact": setIssueImpact,
  "workflow.addPriority": addPriority,
  "workflow.setRevalidation": setRevalidation,
  "workflow.setBaselineHealth": setBaselineHealth,
  "workflow.setCapacityNotes": setCapacityNotes,
  "workflow.calibrate": calibrateCycle,
  "workflow.publish": publishCycle,
  "goals.list": listGoals,
  "goals.read": readGoal,
  "goals.create": createGoal,
  "goals.update": updateGoal,
  "goals.close": closeGoal,
  "goals.reviewDecision": goalReviewDecision,
  "goals.reopen": reopenGoal,
  "goals.reassignRole": reassignGoalRole,
  "goals.moveToCycle": moveGoalToCycle,
  "goals.addKeyResult": createKeyResult,
  "goals.updateKeyResult": updateKeyResult,
  "goals.recordValue": recordKeyResultValue,
  "goals.unlinkKpi": unlinkKeyResultKpi,
  "goals.keyResultHistory": readKeyResultHistory,
  "goals.due": listDueGoals,
  "goals.checkIns": listCheckIns,
  "goals.rewriteKeyResult": rewriteKeyResult,
  "goals.startCheckIn": startCheckIn,
  "goals.publishCheckIn": publishCheckIn,
  "goals.publishDraftedCheckIn": publishDraftedCheckIn,
  "goals.editCheckIn": editCheckIn,
  "goals.deleteCheckIn": deleteCheckIn,
  "goals.acknowledgeCheckIn": acknowledgeCheckIn,
  "goals.vote": castConfidenceVote,
  "goals.revealVotes": revealConfidenceVotes,
  "goals.readVotes": readConfidenceVotes,
  "goals.addDependency": addGoalDependency,
  "goals.removeDependency": removeGoalDependency,
  "goals.addKeyResultDependency": addKeyResultDependency,
  "goals.confirmDependency": confirmKeyResultDependency,
  "goals.setDependencyRiskOwner": setDependencyRiskOwner,
  "goals.removeKeyResultDependency": removeKeyResultDependency,
  "alignment.read": readAlignment,
  "alignment.graph": readAlignmentGraph,
  "goals.relations": readGoalRelations,
  "kpis.createCategory": createKpiCategory,
  "kpis.create": createKpi,
  "kpis.record": recordKpiValue,
  "kpis.grid": readKpiGrid,
  "kpis.setFormula": setKpiFormulaAction,
  "kpis.createTree": createKpiTree,
  "kpis.launchRecovery": launchKpiRecovery,
  "kpis.recoveryDraft": readRecoveryDraft,
  "kpis.recoveryBoard": readRecoveryBoard,
  "kpis.tree": readKpiTree,
  "kpis.detail": readKpiDetail,
  "kpis.update": updateKpi,
  "alignment.dismissFinding": dismissAlignmentFinding,
  "alignment.applyFinding": applyAlignmentFinding,
  "review.inbox": reviewInbox,
  // Comments and reactions (P3-T16)
  "comments.list": listCommentsAction,
  "comments.create": createCommentAction,
  "comments.update": updateCommentAction,
  "comments.delete": deleteCommentAction,
  "comments.previewNotify": previewNotifyAction,
  "nudges.run": runNudges,
  "nudges.list": listNudges,
  "nudges.snooze": snoozeNudge,
  "nudges.volume": nudgeVolume,
  "reactions.list": listReactionsAction,
  "reactions.add": addReactionAction,
  "reactions.remove": removeReactionAction,
  // Sessions (P4-T07a)
  "sessions.create": createSession,
  "sessions.open": openSession,
  "sessions.advanceStage": advanceStage,
  "sessions.skip": skipSession,
  "sessions.close": closeSession,
  "sessions.read": readSession,
  "sessions.list": listSessions,
  "sessions.participants": listParticipants,
  // Confidence round (P4-T07b)
  "sessions.castVote": castSessionVote,
  "sessions.revealVotes": revealSessionVotes,
  "sessions.confirmConfidence": confirmSessionConfidence,
  "sessions.votes": sessionVotes,
  "sessions.confidenceStatus": sessionConfidenceStatus,
  // Blockers (P4-T07c)
  "sessions.createBlocker": createSessionBlocker,
  "sessions.resolveBlocker": resolveSessionBlocker,
  "sessions.blockerStatus": sessionBlockerStatus,
  // Commitments, digest, streaks (P4-T08)
  "sessions.setCommitments": setSessionCommitments,
  "sessions.closeCommitments": closeSessionCommitments,
  "sessions.listCommitments": listSessionCommitments,
  "sessions.setCoordinatorNote": setCoordinatorNote,
  "sessions.readStreak": readStreak,

  "sessions.addMinute": addStageMinute,
  "sessions.givePulse": givePulse,
  "sessions.scoreKeyResult": scoreKeyResult,
  "sessions.revealObjectiveScore": revealObjectiveScore,
  "sessions.passMic": passMic,
  "sessions.setNarrative": setNarrative,
  "sessions.narratives": readNarratives,
  "sessions.giveKudos": giveKudos,
  "sessions.recognition": readRecognition,
  "sessions.addRetroNote": addRetroNote,
  "sessions.removeRetroNote": removeRetroNote,
  "sessions.castRetroVote": castRetroVote,
  "sessions.retro": readRetro,
  "sessions.setManagementAnswer": setManagementAnswer,
  "sessions.managementRetro": readManagementRetro,
  "sessions.setRootCause": setRootCause,
  "sessions.rootCauses": readRootCauses,
  "sessions.submitProcessHealth": submitProcessHealth,
  "sessions.processHealth": readProcessHealth,
  "sessions.recordDiagnostic": recordDiagnostic,
  "sessions.diagnostic": readDiagnostic,
  "sessions.decideObjective": decideObjective,
  "sessions.reset": readReset,
  "sessions.captureLearning": captureLearning,
  "sessions.draftNextCycle": draftNextCycle,
  "sessions.addAction": addReviewAction,
  "sessions.completeAction": completeReviewAction,
  "sessions.forward": readForward,
  "sessions.scoringStatus": readScoringStatus,
  "sessions.roomPulse": readRoomPulse,
  "sessions.setStageNote": setStageNote,

  "sessions.setTrend": setTrend,
  "sessions.setShifts": setShifts,
  "sessions.recordDecision": recordDecision,
  "sessions.monthlyRecord": readMonthlyRecord,
  "decisions.forGoal": decisionsForGoal,
  "decisions.forCycle": decisionsForCycle,
} as const;

export type ActionName = keyof typeof ACTION_MAP;

export const ACTIONS: readonly ActionDefinition[] = Object.values(
  ACTION_MAP,
) as unknown as readonly ActionDefinition[];

export function actionNames(): ActionName[] {
  return Object.keys(ACTION_MAP) as ActionName[];
}

export function getAction(name: string): ActionDefinition | undefined {
  return (ACTION_MAP as Record<string, ActionDefinition | undefined>)[name];
}

type ActionInput<K extends ActionName> = (typeof ACTION_MAP)[K] extends {
  input: { parse(value: unknown): infer I };
}
  ? I
  : never;

type ActionOutput<K extends ActionName> = Awaited<
  ReturnType<(typeof ACTION_MAP)[K]["handler"]>
>;

/**
 * The internal typed projection: call an action by name and get its own input
 * and output types, not `unknown`.
 *
 * This is what the web app uses. It is deliberately the same entry point the
 * generated surfaces will use, so a bug in permission handling shows up
 * everywhere at once rather than on five surfaces independently.
 */
export async function callAction<K extends ActionName>(
  context: ActionCallContext,
  name: K,
  input: ActionInput<K>,
): Promise<ActionOutput<K>> {
  const action = ACTION_MAP[name];
  // The cast is the one place the registry's heterogeneous shapes meet a
  // single call signature; the public types above keep callers honest.
  return (action as ActionDefinition).handler(context, input) as Promise<
    ActionOutput<K>
  >;
}
