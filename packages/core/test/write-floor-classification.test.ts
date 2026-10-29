import { describe, expect, it } from "vitest";
import { ACCESS_LEVELS } from "../src/access/levels.ts";
import { ACTIONS } from "../src/actions/registry.ts";

/**
 * Every write below `full` says how its floor is measured
 * (docs/design/workspace-roles.md §11).
 *
 * A write that names no subject is measured on the workspace's own context,
 * where every member holds `edit` for self-service, so the role is never read
 * unless the action declares a domain. This walk makes a new write choose one
 * of three answers instead of inheriting the self-service binding by silence.
 */

/** Self-service on the workspace: the member's own profile, inbox, tokens. */
const SELF_SERVICE = new Set([
  "ai.removePersonalCredential",
  "ai.setPersonalCredential",
  "channels.linkIdentity",
  "channels.startLink",
  "channels.unlinkIdentity",
  "connections.revoke",
  "copilot.applyProposal",
  "copilot.ask",
  "copilot.completeRun",
  "copilot.dismissProposal",
  "copilot.recordAnswer",
  "copilot.recordProposal",
  "copilot.undoProposal",
  "invitations.acceptLink",
  "invitations.joinByTrustedDomain",
  "notifications.markRead",
  "notifications.snooze",
  "notifications.updateSettings",
  "nudges.snooze",
  "people.finishOwnTour",
  "people.setLeave",
  "people.updateOwnProfile",
  "subscriptions.toggle",
  "tokens.approveDevice",
  "tokens.create",
  "tokens.revoke",
]);

/**
 * Measured by a check of their own on a goal, space, session, task, cycle,
 * document or the author's own row, where the role already applies.
 */
const OWN_CHECK = new Set([
  "blockers.raise",
  "alignment.applyFinding",
  "alignment.dismissFinding",
  "attachments.attach",
  "attachments.detach",
  "blobs.claimUpload",
  "blobs.prepareUpload",
  "comments.delete",
  "cycles.ensureCurrent",
  "cycles.feedForward",
  "cycles.snapshot",
  "documents.create",
  "documents.publish",
  "documents.update",
  "exports.list",
  "goals.acknowledgeCheckIn",
  "goals.addDependency",
  "goals.addKeyResult",
  "goals.addKeyResultDependency",
  "goals.approveDraft",
  "goals.changeTarget",
  "goals.close",
  "goals.confirmDependency",
  "goals.create",
  "goals.deleteCheckIn",
  "goals.editCheckIn",
  "goals.escalateDependency",
  "goals.linkKpi",
  "goals.moveToCycle",
  "goals.moveToSpace",
  "goals.patch",
  "goals.patchKeyResult",
  "goals.place",
  "goals.placeKeyResult",
  "goals.publishCheckIn",
  "goals.publishDraft",
  "goals.publishDraftedCheckIn",
  "goals.recordValue",
  "goals.removeDependency",
  "goals.removeKeyResultDependency",
  "goals.reopen",
  "goals.revealVotes",
  "goals.setDependencyRiskOwner",
  "goals.setKind",
  "goals.startCheckIn",
  "goals.stop",
  "goals.unlinkKpi",
  "goals.update",
  "goals.updateKeyResult",
  "goals.vote",
  "initiatives.update",
  "proposals.apply",
  "proposals.dismiss",
  "reactions.remove",
  "sessions.addAction",
  "sessions.addMinute",
  "sessions.addRetroNote",
  "sessions.advanceStage",
  "sessions.bookCycle",
  "sessions.captureLearning",
  "sessions.castRetroVote",
  "sessions.castVote",
  "sessions.close",
  "sessions.closeCommitments",
  "sessions.completeAction",
  "sessions.confirmConfidence",
  "sessions.create",
  "sessions.createBlocker",
  "sessions.decideObjective",
  "sessions.giveKudos",
  "sessions.givePulse",
  "sessions.open",
  "sessions.passMic",
  "sessions.postDigest",
  "sessions.reassignBlocker",
  "sessions.recordDecision",
  "sessions.recordDiagnostic",
  "sessions.removeRetroNote",
  "sessions.resolveBlocker",
  "sessions.revealObjectiveScore",
  "sessions.revealVotes",
  "sessions.scoreKeyResult",
  "sessions.setCommitments",
  "sessions.setCoordinatorNote",
  "sessions.setManagementAnswer",
  "sessions.setNarrative",
  "sessions.setNextAction",
  "sessions.setRootCause",
  "sessions.setShifts",
  "sessions.setStageNote",
  "sessions.setTrend",
  "sessions.setWins",
  "sessions.skip",
  "sessions.submitProcessHealth",
  "spaces.addMember",
  "spaces.join",
  "spaces.leave",
  "spaces.removeMember",
  "spaces.setHolidays",
  "spaces.setMemberRole",
  "spaces.update",
  "spaces.updateSettings",
  "tasks.addChecklistItem",
  "tasks.assign",
  "tasks.create",
  "tasks.move",
  "tasks.removeChecklistItem",
  "tasks.setChecklistItem",
  "tasks.unassign",
  "tasks.update",
  "workflow.addIssue",
  "workflow.addPriority",
  "workflow.distributePack",
  "workflow.setBaselineHealth",
  "workflow.setCapacityNotes",
  "workflow.setFocusKeyResults",
  "workflow.setIssueImpact",
  "workflow.setPackItem",
  "workflow.setRevalidation",
]);

const writesBelowFull = ACTIONS.filter(
  (action) => action.safety !== "read" && action.access < ACCESS_LEVELS.full,
);

describe("writes below full", () => {
  it("each declares a domain, is self-service, or checks its own subject", () => {
    const unclassified = writesBelowFull
      .filter((action) => !action.domain)
      .map((action) => action.name)
      .filter((name) => !SELF_SERVICE.has(name) && !OWN_CHECK.has(name));
    expect(unclassified).toEqual([]);
  });

  it("a declared domain is not also listed as self-service or own-check", () => {
    const both = writesBelowFull
      .filter((action) => action.domain)
      .map((action) => action.name)
      .filter((name) => SELF_SERVICE.has(name) || OWN_CHECK.has(name));
    expect(both).toEqual([]);
  });

  it("names no action that is not a write below full", () => {
    const known = new Set(writesBelowFull.map((action) => action.name));
    const stale = [...SELF_SERVICE, ...OWN_CHECK].filter(
      (name) => !known.has(name),
    );
    expect(stale).toEqual([]);
  });

  it("the comment, KPI and initiative writes measure their domain", () => {
    const declared = Object.fromEntries(
      writesBelowFull
        .filter((action) => action.domain)
        .map((action) => [action.name, action.domain]),
    );
    expect(declared).toEqual({
      "comments.create": "comment",
      "comments.update": "comment",
      "initiatives.create": "initiative",
      "initiatives.linkKeyResult": "initiative",
      "initiatives.unlinkKeyResult": "initiative",
      "kpis.create": "kpi",
      "kpis.createCategory": "kpi",
      "kpis.createTree": "kpi",
      "kpis.launchRecovery": "kpi",
      "kpis.record": "kpi",
      "kpis.recordResponse": "kpi",
      "kpis.setFormula": "kpi",
      "kpis.update": "kpi",
      "reactions.add": "comment",
    });
  });
});
