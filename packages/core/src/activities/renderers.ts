/**
 * Per-kind feed renderers (TECHNICAL-PLAN §4.11, screen S-31, P2-T07).
 *
 * One function per registered kind, turning its payload into the sentence a
 * feed row reads. Plain strings rather than the rich-text renderer: a feed
 * line is generated from data the product already trusts (a name it stored
 * itself), never from a member's own written content, so there is nothing
 * here for the sanitising allow-list to do.
 *
 * Every sentence comes from the server catalogue (`activity.*` keys) in the
 * reader's language, with named holes for the values. Nothing is stored: the
 * sentence is built at read time from the kind and the payload. A value that
 * is user content (a title, a comment excerpt) is passed through as written.
 */
import type { MessageValues } from "@openokr/formats";
import { getServerCatalogue, serverTranslate } from "../i18n/catalogue.ts";
import type { ActivityKind } from "./catalogue.ts";

/** Resolves one catalogue key in the reader's language. */
type ActivityTranslate = (key: string, values?: MessageValues) => string;

/**
 * Names a payload token (a level, a role, a status) in the reader's language
 * when the catalogue has a word for it, and leaves the token as it is when
 * it does not.
 */
type ActivityWord = (
  prefix: string,
  value: string,
  fallback?: string,
) => string;

export type ActivityRenderer = (
  payload: Record<string, unknown>,
  t: ActivityTranslate,
  w: ActivityWord,
) => string;

const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

/** A count the payload carries as a number, or the fallback. */
const asCount = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

export const ACTIVITY_RENDERERS: Record<ActivityKind, ActivityRenderer> = {
  "workspace.provisioned": (p, t) =>
    t("activity.workspace.provisioned", { name: asString(p.name) }),
  "workspace.adopted": (_p, t) => t("activity.workspace.adopted"),
  "workspace.renamed": (p, t) =>
    t("activity.workspace.renamed", {
      from: asString(p.from),
      to: asString(p.to),
    }),
  "workspace.onboarded": (_p, t) => t("activity.workspace.onboarded"),
  "workspace.onboarding_reopened": (_p, t) =>
    t("activity.workspace.onboarding_reopened"),
  "workspace.state_changed": (p, t) =>
    t("activity.workspace.state_changed", {
      from: asString(p.from),
      to: asString(p.to),
    }),
  "support.granted": (p, t) =>
    t("activity.support.granted", { hours: asCount(p.hours) }),
  "support.ended": (p, t, w) =>
    t("activity.support.ended", {
      reason: w("activity.word.supportEnd", asString(p.reason)),
    }),
  "support.requested": (_p, t) => t("activity.support.requested"),
  "workspace.limits_updated": (_p, t) => t("activity.workspace.limits_updated"),
  "workspace.erasure_reminded": (p, t) =>
    t("activity.workspace.erasure_reminded", {
      date: asString(p.eraseOn).slice(0, 10),
    }),
  "workspace.trial_set": (p, t) =>
    p.endsAt === null
      ? t("activity.workspace.trial_set.ended")
      : p.plan
        ? t("activity.workspace.trial_set.plan", {
            plan: asString(p.plan),
            date: asString(p.endsAt).slice(0, 10),
          })
        : t("activity.workspace.trial_set.until", {
            date: asString(p.endsAt).slice(0, 10),
          }),
  "workspace.trial_reminded": (p, t) =>
    t("activity.workspace.trial_reminded", {
      date: asString(p.endsAt).slice(0, 10),
    }),
  "workspace.trial_ended": (p, t) =>
    p.outcome === "moved"
      ? t("activity.workspace.trial_ended.moved", {
          plan: asString(p.plan, t("activity.fb.free")),
        })
      : p.outcome === "suspended"
        ? t("activity.workspace.trial_ended.suspended")
        : t("activity.workspace.trial_ended.kept"),
  "workspace.lifecycle_changed": (p, t) =>
    t("activity.workspace.lifecycle_changed", { state: asString(p.state) }),
  "billing.requested": (_p, t) => t("activity.billing.requested"),
  "billing.credits_purchased": (p, t) =>
    t("activity.billing.credits_purchased", { credits: String(p.credits) }),
  "billing.subscription_changed": (p, t) =>
    t("activity.billing.subscription_changed", { status: asString(p.status) }),
  "workspace.plan_changed": (p, t) =>
    typeof p.seats === "number"
      ? t("activity.workspace.plan_changed.seats", {
          plan: asString(p.plan),
          seats: String(p.seats),
        })
      : t("activity.workspace.plan_changed.unlimited", {
          plan: asString(p.plan),
        }),
  "member.profile_updated": (p, t) =>
    t("activity.member.profile_updated", {
      name: asString(p.name, t("activity.fb.AMember")),
    }),
  "member.tour_finished": (_p, t) => t("activity.member.tour_finished"),
  "channel.templatesSynced": (p, t) =>
    t("activity.channel.templatesSynced", {
      recorded: asCount(p.recorded),
      withdrawn: asCount(p.withdrawn),
    }),
  "channel.templateMapped": (p, t) =>
    t("activity.channel.templateMapped", {
      rule: asString(p.ruleKey, t("activity.fb.unnamed")),
    }),
  "channel.templateUnmapped": (p, t) =>
    t("activity.channel.templateUnmapped", {
      rule: asString(p.ruleKey, t("activity.fb.unnamed")),
    }),
  "connection.revoked": (_p, t) => t("activity.connection.revoked"),
  "api_token.created": (p, t) =>
    t("activity.api_token.created", {
      name: asString(p.name, t("activity.fb.unnamed")),
      audience: asString(p.audience, t("activity.fb.rest")),
    }),
  "api_token.revoked": (p, t) =>
    t("activity.api_token.revoked", {
      name: asString(p.name, t("activity.fb.unnamed")),
    }),
  "device.approved": (p, t) =>
    t("activity.device.approved", {
      client: asString(p.clientName, t("activity.fb.ATerminal")),
    }),
  "device.denied": (p, t) =>
    t("activity.device.denied", {
      client: asString(p.clientName, t("activity.fb.ATerminal")),
    }),
  "member.updated": (p, t) =>
    t("activity.member.updated", {
      name: asString(p.name, t("activity.fb.AMember")),
    }),
  "member.leaveSet": (p, t) =>
    asCount(p.count) === 0
      ? t("activity.member.leaveSet.none", {
          name: asString(p.name, t("activity.fb.AMember")),
        })
      : t("activity.member.leaveSet.marked", {
          name: asString(p.name, t("activity.fb.AMember")),
        }),
  "member.suspended": (p, t) =>
    t("activity.member.suspended", {
      name: asString(p.name, t("activity.fb.AMember")),
    }),
  "member.restored": (p, t) =>
    t("activity.member.restored", {
      name: asString(p.name, t("activity.fb.AMember")),
    }),
  "role.created": (p, t) =>
    t("activity.role.created", {
      name: asString(p.name, t("activity.fb.aRole")),
    }),
  "role.deleted": (p, t) =>
    t("activity.role.deleted", {
      name: asString(p.name, t("activity.fb.aRole")),
    }),
  "role.permission_set": (p, t) =>
    t("activity.role.permission_set", {
      role: asString(p.role, t("activity.fb.aRole")),
      domain: asString(p.domain, t("activity.fb.aDomain")),
    }),
  "role.assigned": (_p, t) => t("activity.role.assigned"),
  "member.administrator_set": (p, t) =>
    p.administrator === true
      ? t("activity.member.administrator_set.on", {
          name: asString(p.name, t("activity.fb.AMember")),
        })
      : t("activity.member.administrator_set.off", {
          name: asString(p.name, t("activity.fb.AMember")),
        }),
  "member.converted_to_guest": (p, t) =>
    t("activity.member.converted_to_guest", {
      name: asString(p.name, t("activity.fb.AMember")),
    }),
  "member.erased": (_p, t) => t("activity.member.erased"),
  "member.self_deleted": (p, t) =>
    (() => {
      const parts = [
        asCount(p.goals) > 0
          ? t("activity.member.self_deleted.goals", { count: asCount(p.goals) })
          : null,
        asCount(p.keyResults) > 0
          ? t("activity.member.self_deleted.keyResults", {
              count: asCount(p.keyResults),
            })
          : null,
        asCount(p.reviews) > 0
          ? t("activity.member.self_deleted.reviews", {
              count: asCount(p.reviews),
            })
          : null,
      ].filter((part): part is string => part !== null);
      if (parts.length === 0) {
        return t("activity.member.self_deleted.none");
      }
      const list =
        parts.length === 1
          ? (parts[0] ?? "")
          : `${parts.slice(0, -1).join(", ")}${t("activity.joinAnd")}${parts[parts.length - 1]}`;
      return t("activity.member.self_deleted.owner", {
        count: asCount(p.goals) + asCount(p.keyResults) + asCount(p.reviews),
        list,
      });
    })(),
  "member.imported": (p, t) =>
    p.matched === undefined
      ? t("activity.member.imported.new", {
          name: asString(p.name, t("activity.fb.AMember")),
        })
      : t("activity.member.imported.matched", {
          name: asString(p.name, t("activity.fb.AMember")),
        }),
  "invitation.link_created": (_p, t) => t("activity.invitation.link_created"),
  "invitation.link_revoked": (_p, t) => t("activity.invitation.link_revoked"),
  "invitation.accepted": (_p, t) => t("activity.invitation.accepted"),
  "invitation.joined_by_trusted_domain": (_p, t) =>
    t("activity.invitation.joined_by_trusted_domain"),
  "member.joined_by_directory": (p, t) =>
    asString(p.via) === "sso"
      ? t("activity.member.joined_by_directory.sso")
      : t("activity.member.joined_by_directory.directory"),
  "sso.connection_created": (p, t) =>
    t("activity.sso.connection_created", {
      name: asString(p.name, t("activity.fb.aProvider")),
    }),
  "directory.token_created": (_p, t) => t("activity.directory.token_created"),
  "sso.connection_updated": (p, t) =>
    t("activity.sso.connection_updated", {
      name: asString(p.name, t("activity.fb.aProvider")),
    }),
  "sso.connection_switched": (p, t) =>
    p.enabled === true
      ? t("activity.sso.connection_switched.on", {
          name: asString(p.name, t("activity.fb.aProvider")),
        })
      : t("activity.sso.connection_switched.off", {
          name: asString(p.name, t("activity.fb.aProvider")),
        }),
  "sso.connection_removed": (p, t) =>
    t("activity.sso.connection_removed", {
      name: asString(p.name, t("activity.fb.aProvider")),
    }),
  "sso.domain_verification_started": (p, t) =>
    t("activity.sso.domain_verification_started", {
      domain: asString(p.domain, t("activity.fb.aDomain")),
    }),
  "sso.domain_checked": (p, t) =>
    t("activity.sso.domain_checked", {
      domain: asString(p.domain, t("activity.fb.aDomain")),
    }),
  "sso.domain_verified": (p, t) =>
    t("activity.sso.domain_verified", {
      domain: asString(p.domain, t("activity.fb.ADomain")),
    }),
  "sso.domain_check_failed": (p, t) =>
    t("activity.sso.domain_check_failed", {
      domain: asString(p.domain, t("activity.fb.aDomain")),
    }),
  "sso.domain_check_recovered": (p, t) =>
    t("activity.sso.domain_check_recovered", {
      domain: asString(p.domain, t("activity.fb.aDomain")),
    }),
  "sso.domain_unverified": (p, t) =>
    t("activity.sso.domain_unverified", {
      domain: asString(p.domain, t("activity.fb.ADomain")),
    }),
  "blob.prepared": (_p, t) => t("activity.blob.prepared"),
  "blob.claimed": (_p, t) => t("activity.blob.claimed"),
  "blob.scanned": (p, t) =>
    asString(p.verdict) === "clean"
      ? t("activity.blob.scanned.clean")
      : t("activity.blob.scanned.held"),
  "space.settingsChanged": (p, t) =>
    t("activity.space.settingsChanged", { name: asString(p.name) }),
  "space.holidaysChanged": (p, t) =>
    asCount(p.count) === 0
      ? t("activity.space.holidaysChanged.none", { name: asString(p.name) })
      : asCount(p.count) === 1
        ? t("activity.space.holidaysChanged.one", { name: asString(p.name) })
        : t("activity.space.holidaysChanged.many", {
            name: asString(p.name),
            n: asCount(p.count),
          }),
  "agent.autonomy_changed": (p, t) =>
    t("activity.agent.autonomy_changed", {
      from: asString(p.from).replace(/_/g, " "),
      to: asString(p.to).replace(/_/g, " "),
    }),
  "nudge.rule_changed": (p, t) =>
    p.configured
      ? t("activity.nudge.rule_changed.changed", { rule: asString(p.ruleKey) })
      : t("activity.nudge.rule_changed.reset", { rule: asString(p.ruleKey) }),
  "blob.reaped": (p, t) =>
    asCount(p.discarded) === 0
      ? t("activity.blob.reaped.none")
      : asCount(p.bytesLeft) === 0
        ? t("activity.blob.reaped.cleared", {
            files: t("activity.blob.reaped.files", {
              count: asCount(p.discarded),
            }),
          })
        : t("activity.blob.reaped.clearedLeft", {
            files: t("activity.blob.reaped.files", {
              count: asCount(p.discarded),
            }),
            bytes: asCount(p.bytesLeft),
          }),
  "channel.log_swept": (p, t) =>
    asCount(p.retentionDays) === 0
      ? t("activity.channel.log_swept.off")
      : asCount(p.deleted) === 0
        ? t("activity.channel.log_swept.none", {
            days: asCount(p.retentionDays),
          })
        : t("activity.channel.log_swept.cleared", {
            count: asCount(p.deleted),
            days: asCount(p.retentionDays),
          }),
  "notification.read": (_p, t) => t("activity.notification.read"),
  "notification.snoozed": (_p, t) => t("activity.notification.snoozed"),
  "notification_settings.updated": (_p, t) =>
    t("activity.notification_settings.updated"),
  "subscription.added": (_p, t) => t("activity.subscription.added"),
  "subscription.canceled": (_p, t) => t("activity.subscription.canceled"),
  "workspace.general_settings_updated": (p, t) =>
    t("activity.workspace.general_settings_updated", {
      keys: Array.isArray(p.keys) ? p.keys.join(", ") : "general",
    }),
  "workspace.branding_updated": (_p, t) =>
    t("activity.workspace.branding_updated"),
  "workspace.settings_reset": (p, t) =>
    t("activity.workspace.settings_reset", {
      keys: Array.isArray(p.keys) ? p.keys.join(", ") : "general",
    }),
  "ai.provider_config_updated": (p, t) =>
    t("activity.ai.provider_config_updated", {
      provider: asString(p.provider, t("activity.fb.AProvider")),
    }),
  "ai.workspace_credential_set": (p, t) =>
    t("activity.ai.workspace_credential_set", {
      provider: asString(p.provider, t("activity.fb.aProvider")),
    }),
  "ai.workspace_credential_removed": (p, t) =>
    t("activity.ai.workspace_credential_removed", {
      provider: asString(p.provider, t("activity.fb.aProvider")),
    }),
  "ai.workspace_credential_checked": (p, t) =>
    t("activity.ai.workspace_credential_checked", {
      provider: asString(p.provider, t("activity.fb.aProvider")),
      status: asString(p.status, t("activity.fb.unknown")),
    }),
  "ai.personal_credential_set": (p, t) =>
    t("activity.ai.personal_credential_set", {
      provider: asString(p.provider, t("activity.fb.aProvider")),
    }),
  "ai.personal_credential_removed": (p, t) =>
    t("activity.ai.personal_credential_removed", {
      provider: asString(p.provider, t("activity.fb.aProvider")),
    }),
  "ai.credentials_rotated": (p, t) =>
    t("activity.ai.credentials_rotated", {
      rewrapped: Number(p.rewrapped ?? 0),
      examined: Number(p.examined ?? 0),
    }),
  "ai.custom_model_added": (_p, t) => t("activity.ai.custom_model_added"),
  "ai.custom_model_updated": (_p, t) => t("activity.ai.custom_model_updated"),
  "ai.custom_model_removed": (_p, t) => t("activity.ai.custom_model_removed"),
  "ai.tier_policy_set": (p, t) =>
    t("activity.ai.tier_policy_set", {
      tier: asString(p.tier, t("activity.fb.a")),
      provider: asString(p.provider),
      model: asString(p.modelId),
    }),
  "ai.tier_policy_removed": (p, t) =>
    t("activity.ai.tier_policy_removed", {
      tier: asString(p.tier, t("activity.fb.a")),
    }),
  "ai.feature_setting_updated": (p, t) =>
    t("activity.ai.feature_setting_updated", {
      feature: asString(p.featureKey, t("activity.fb.AFeature")),
    }),
  "ai.prompt_updated": (p, t) =>
    t("activity.ai.prompt_updated", {
      prompt: asString(p.promptKey, t("activity.fb.aPrompt")),
    }),
  "ai.prompt_restored": (p, t) =>
    t("activity.ai.prompt_restored", {
      prompt: asString(p.promptKey, t("activity.fb.APrompt")),
    }),
  "ai.usage_recorded": (p, t) =>
    t("activity.ai.usage_recorded", {
      provider: asString(p.provider, t("activity.fb.aProvider")),
      model: asString(p.modelId, t("activity.fb.aModel")),
    }),
  "ai.budget_set": (p, t) =>
    t("activity.ai.budget_set", {
      scope: asString(p.scope, t("activity.fb.workspace")),
    }),
  "ai.budget_removed": (_p, t) => t("activity.ai.budget_removed"),
  "ai.privacy_updated": (p, t) =>
    t("activity.ai.privacy_updated", {
      keys: Array.isArray(p.keys) ? p.keys.join(", ") : "privacy",
    }),
  "ai.egress_withheld": (p, t) =>
    p.outcome === "redacted"
      ? t("activity.ai.egress_withheld.redacted", {
          provider: asString(p.provider, t("activity.fb.aProvider")),
        })
      : t("activity.ai.egress_withheld.withheld", {
          provider: asString(p.provider, t("activity.fb.aProvider")),
        }),
  "connection.tool_calls_swept": (p, t) =>
    t("activity.connection.tool_calls_swept", {
      deleted: asCount(p.deleted),
      days: asCount(p.retentionDays),
    }),
  "connection.ended_by_admin": (_p, t) =>
    t("activity.connection.ended_by_admin"),
  "agent.scope_refused": (p, t) =>
    t("activity.agent.scope_refused", {
      tool: asString(p.tool, t("activity.fb.aTool")),
      needed: asString(p.needed, t("activity.fb.more")),
    }),
  "agent.created": (p, t) =>
    t("activity.agent.created", {
      name: asString(p.name, t("activity.fb.NewAgent")),
    }),
  "agent.enabled_changed": (p, t) =>
    p.enabled
      ? t("activity.agent.enabled_changed.on")
      : t("activity.agent.enabled_changed.off"),
  "agent.instructions_saved": (p, t) =>
    p.restoredFrom === undefined
      ? t("activity.agent.instructions_saved.saved", {
          stage: asString(p.stage, ""),
          version: String(p.version),
        })
      : t("activity.agent.instructions_saved.restored", {
          stage: asString(p.stage, ""),
          version: String(p.restoredFrom),
        }),
  "agent.scope_bound": (p, t) =>
    t("activity.agent.scope_bound", {
      resource: asString(p.resourceType, t("activity.fb.resource")),
    }),
  "agent.run_started": (_p, t) => t("activity.agent.run_started"),
  "agent.run_task_processed": (p, t) =>
    t("activity.agent.run_task_processed", {
      index: Number(p.taskIndex ?? 0) + 1,
      outcome: asString(p.outcome, t("activity.fb.processed")),
    }),
  "agent.run_cancelled": (_p, t) => t("activity.agent.run_cancelled"),
  "agent.run_completed": (_p, t) => t("activity.agent.run_completed"),
  "agent.run_failed": (p, t) =>
    p.error
      ? t("activity.agent.run_failed.reason", { error: asString(p.error) })
      : t("activity.agent.run_failed.plain"),
  "proposed_change.bulk_applied": (p, t) =>
    t("activity.proposed_change.bulk_applied", {
      n: Number(p.appliedCount ?? 0),
    }),
  "proposed_change.bulk_dismissed": (p, t) =>
    t("activity.proposed_change.bulk_dismissed", {
      n: Number(p.dismissedCount ?? 0),
    }),
  "proposed_change.applied": (_p, t) => t("activity.proposed_change.applied"),
  "proposed_change.dismissed": (_p, t) =>
    t("activity.proposed_change.dismissed"),
  "space.created": (p, t) =>
    t("activity.space.created", {
      name: asString(p.name, t("activity.fb.NewSpace")),
    }),
  "space.updated": (p, t) =>
    t("activity.space.updated", {
      name: asString(p.name, t("activity.fb.ASpace")),
    }),
  "space.archived": (p, t) =>
    t("activity.space.archived", {
      name: asString(p.name, t("activity.fb.ASpace")),
    }),
  "space.member_added": (p, t, w) =>
    t("activity.space.member_added", {
      name: asString(p.name, t("activity.fb.AMember")),
      role: w(
        "activity.word.spaceRole",
        asString(p.role, t("activity.fb.aMember")),
      ),
    }),
  "space.member_removed": (_p, t) => t("activity.space.member_removed"),
  "space.member_role_changed": (p, t, w) =>
    t("activity.space.member_role_changed", {
      from: w(
        "activity.word.spaceRole",
        asString(p.from, t("activity.fb.member")),
      ),
      to: w("activity.word.spaceRole", asString(p.to, t("activity.fb.member"))),
    }),
  "space.joined": (_p, t) => t("activity.space.joined"),
  "space.left": (_p, t) => t("activity.space.left"),
  "cycle.created": (p, t) =>
    p.inheritedFrom
      ? t("activity.cycle.created.inherited", {
          name: asString(p.name, t("activity.fb.aNewCycle")),
          from: asString(p.inheritedFrom, t("activity.fb.theCycleBefore")),
        })
      : t("activity.cycle.created.plain", {
          name: asString(p.name, t("activity.fb.aNewCycle")),
        }),
  "cycle.resolved": (p, t) =>
    t("activity.cycle.resolved", {
      name: asString(p.name, t("activity.fb.theCurrentCycle")),
    }),
  "cycle.closing_started": (p, t) =>
    p.by === "date"
      ? t("activity.cycle.closing_started.date", {
          name: asString(p.name, t("activity.fb.TheCycle")),
        })
      : t("activity.cycle.closing_started.early", {
          name: asString(p.name, t("activity.fb.TheCycle")),
        }),
  "cycle.closing_undone": (p, t) =>
    t("activity.cycle.closing_undone", {
      name: asString(p.name, t("activity.fb.TheCycle")),
    }),
  "cycle.updated": (p, t) =>
    t("activity.cycle.updated", {
      name: asString(p.name, t("activity.fb.aCycle")),
    }),
  "cycle.archived": (p, t) =>
    t("activity.cycle.archived", {
      name: asString(p.name, t("activity.fb.aCycle")),
    }),
  "rhythm.updated": (p, t) =>
    t("activity.rhythm.updated", {
      keys: Array.isArray(p.keys) ? p.keys.join(", ") : "thresholds",
    }),
  "practice.updated": (p, t) =>
    t("activity.practice.updated", {
      keys: Array.isArray(p.keys) ? p.keys.join(", ") : "settings",
    }),
  "practice.profile_applied": (p, t) =>
    t("activity.practice.profile_applied", {
      from: String(p.from ?? ""),
      to: String(p.to ?? ""),
    }),
  "cycle.pack_item_set": (p, t) =>
    p.gathered
      ? t("activity.cycle.pack_item_set.gathered", {
          item: Number(p.itemKey ?? 0),
        })
      : t("activity.cycle.pack_item_set.missing", {
          item: Number(p.itemKey ?? 0),
        }),
  "cycle.pack_distributed": (_p, t) => t("activity.cycle.pack_distributed"),
  "cycle.issue_added": (p, t) =>
    t("activity.cycle.issue_added", { impact: Number(p.impact ?? 0) }),
  "cycle.issue_reranked": (p, t) =>
    t("activity.cycle.issue_reranked", { impact: Number(p.impact ?? 0) }),
  "cycle.priority_added": (p, t) =>
    p.promoted
      ? t("activity.cycle.priority_added.promoted")
      : t("activity.cycle.priority_added.added"),
  "cycle.revalidated": (p, t) =>
    p.changed
      ? t("activity.cycle.revalidated.changed")
      : t("activity.cycle.revalidated.holds"),
  "cycle.baseline_health_set": (_p, t) =>
    t("activity.cycle.baseline_health_set"),
  "cycle.capacity_recorded": (_p, t) => t("activity.cycle.capacity_recorded"),
  "cycle.focus_set": (p, t) =>
    t("activity.cycle.focus_set", { n: Number(p.count ?? 0) }),
  "cycle.calibrated": (_p, t) => t("activity.cycle.calibrated"),
  "cycle.published": (p, t) =>
    p.published === "company"
      ? t("activity.cycle.published.company", {
          name: asString(p.name, t("activity.fb.aCycle")),
        })
      : t("activity.cycle.published.plain", {
          name: asString(p.name, t("activity.fb.aCycle")),
        }),
  "nudges.run": (p, t) =>
    t("activity.nudges.run", { recorded: String(p.recorded) }),
  "nudge.snoozed": (p, t) =>
    t("activity.nudge.snoozed", {
      until: asString(p.until, t("activity.fb.later")),
    }),
  "notifications.drained": (p, t) =>
    t("activity.notifications.drained", { claimed: String(p.claimed) }),
  "frame.set": (p, t) =>
    t("activity.frame.set", {
      year: asString(p.yearLabel, t("activity.fb.theYear")),
    }),
  "frame.revised": (p, t) =>
    t("activity.frame.revised", {
      year: asString(p.yearLabel, t("activity.fb.theYear")),
      reason: asString(p.reason, t("activity.fb.noReasonRecorded")),
    }),
  "goal.created": (p, t, w) =>
    p.addedMidCycle && typeof p.level === "string"
      ? t("activity.goal.created.midCycleLevel", {
          level: w("activity.word.level", asString(p.level)),
          title: asString(p.title, t("activity.fb.aGoal")),
        })
      : p.addedMidCycle
        ? t("activity.goal.created.midCycle", {
            title: asString(p.title, t("activity.fb.aGoal")),
          })
        : typeof p.level === "string"
          ? t("activity.goal.created.level", {
              level: w("activity.word.level", asString(p.level)),
              title: asString(p.title, t("activity.fb.aGoal")),
            })
          : t("activity.goal.created.plain", {
              title: asString(p.title, t("activity.fb.aGoal")),
            }),
  "goal.updated": (p, t) =>
    t("activity.goal.updated", {
      title: asString(p.title, t("activity.fb.aGoal")),
    }),
  "goal.draft_published": (p, t) =>
    p.awaitingApproval
      ? t("activity.goal.draft_published.awaiting", {
          title: asString(p.title, t("activity.fb.aGoal")),
        })
      : t("activity.goal.draft_published.live", {
          title: asString(p.title, t("activity.fb.aGoal")),
        }),
  "goal.draft_approved": (p, t) =>
    t("activity.goal.draft_approved", {
      title: asString(p.title, t("activity.fb.aGoal")),
    }),
  "goal.closed": (p, t, w) =>
    t("activity.goal.closed", {
      status: asString(p.successStatus, t("activity.fb.closed")),
      decision: w(
        "activity.word.closeDecision",
        asString(p.closeDecision, "keep"),
      ),
    }),
  "goal.reopened": (_p, t) => t("activity.goal.reopened"),
  "goal.moved_space": (p, t) =>
    t("activity.goal.moved_space", {
      from: asString(p.fromSpace, t("activity.fb.oneSpace")),
      to: asString(p.toSpace, t("activity.fb.another")),
    }),
  "goal.stopped": (p, t) =>
    t("activity.goal.stopped", {
      reason: asString(p.reason, t("activity.fb.noReasonGiven")),
    }),
  "goal.deleted": (p, t) =>
    t("activity.goal.deleted", { title: String(p.title) }),
  "goal.restored": (p, t) =>
    t("activity.goal.restored", {
      title: asString(p.title, t("activity.fb.aGoal")),
    }),
  "goal.role_reassigned": (p, t, w) =>
    t("activity.goal.role_reassigned", {
      role: w(
        "activity.word.goalRole",
        asString(p.role, t("activity.fb.role")),
      ),
    }),
  "goal.moved_to_cycle": (p, t) =>
    t("activity.goal.moved_to_cycle", {
      title: asString(p.title, t("activity.fb.aGoal")),
    }),
  "initiative.created": (p, t) =>
    t("activity.initiative.created", {
      title: asString(p.title, t("activity.fb.someWork")),
    }),
  "initiative.updated": (_p, t) => t("activity.initiative.updated"),
  "initiative.deleted": (p, t) =>
    t("activity.initiative.deleted", {
      title: asString(p.title, t("activity.fb.someWork")),
    }),
  "initiative.restored": (p, t) =>
    t("activity.initiative.restored", {
      title: asString(p.title, t("activity.fb.someWork")),
    }),
  "initiative.linked": (_p, t) => t("activity.initiative.linked"),
  "initiative.unlinked": (_p, t) => t("activity.initiative.unlinked"),
  "export.taken": (p, t) =>
    t("activity.export.taken", {
      n: Number(p.rowCount ?? 0),
      list: asString(p.list, t("activity.fb.rows")),
    }),
  "import.started": (p, t) =>
    p.mode === "dry_run"
      ? t("activity.import.started.dryRun", {
          source: asString(p.source, t("activity.fb.aFile")),
        })
      : t("activity.import.started.plain", {
          source: asString(p.source, t("activity.fb.aFile")),
        }),
  "import.finished": (p, t) =>
    p.status === "completed"
      ? t("activity.import.finished.completed", {
          written: Number(p.rowsWritten ?? 0),
          skipped: Number(p.rowsSkipped ?? 0),
        })
      : t("activity.import.finished.failed"),
  "import.archive": (p, t) =>
    p.mode === "dry_run"
      ? t("activity.import.archive.dryRun")
      : t("activity.import.archive.plain"),
  "document.drafted": (p, t) =>
    t("activity.document.drafted", {
      title: asString(p.title, t("activity.fb.untitled")),
    }),
  "document.edited": (_p, t) => t("activity.document.edited"),
  "document.published": (p, t) =>
    t("activity.document.published", {
      title: asString(p.title, t("activity.fb.untitled")),
      version: Number(p.version ?? 1),
    }),
  "document.deleted": (p, t) =>
    t("activity.document.deleted", {
      title: asString(p.title, t("activity.fb.untitled")),
    }),
  "document.restored": (p, t) =>
    t("activity.document.restored", {
      title: asString(p.title, t("activity.fb.untitled")),
    }),
  "attachment.added": (_p, t) => t("activity.attachment.added"),
  "attachment.removed": (_p, t) => t("activity.attachment.removed"),
  "task.created": (p, t) =>
    t("activity.task.created", {
      title: asString(p.title, t("activity.fb.aTask")),
    }),
  "task.updated": (_p, t) => t("activity.task.updated"),
  "task.moved": (p, t) =>
    t("activity.task.moved", {
      status: asString(p.status, t("activity.fb.anotherColumn")),
    }),
  "task.assigned": (_p, t) => t("activity.task.assigned"),
  "task.unassigned": (_p, t) => t("activity.task.unassigned"),
  "task.checklist_changed": (p, t) =>
    t("activity.task.checklist_changed", {
      change: asString(p.change, t("activity.fb.changed")),
    }),
  "task.deleted": (p, t) =>
    t("activity.task.deleted", {
      title: asString(p.title, t("activity.fb.aTask")),
    }),
  "task.restored": (p, t) =>
    t("activity.task.restored", {
      title: asString(p.title, t("activity.fb.aTask")),
    }),
  "key_result.created": (p, t) =>
    p.addedMidCycle
      ? t("activity.key_result.created.midCycle", {
          title: asString(p.title, t("activity.fb.aKeyResult")),
        })
      : t("activity.key_result.created.plain", {
          title: asString(p.title, t("activity.fb.aKeyResult")),
        }),
  "key_result.updated": (_p, t) => t("activity.key_result.updated"),
  "key_result.value_recorded": (p, t) =>
    t("activity.key_result.value_recorded", { value: Number(p.value ?? 0) }),
  "key_result.confidence_updated": (p, t) =>
    t("activity.key_result.confidence_updated", {
      value: Math.round(Number(p.to ?? 0) * 10),
    }),
  "key_result.removed": (p, t) =>
    t("activity.key_result.removed", {
      title: asString(p.title, t("activity.fb.aKeyResult")),
    }),
  "key_result.target_changed": (p, t) =>
    p.from === null
      ? t("activity.key_result.target_changed.set", { to: String(p.to) })
      : p.eased
        ? t("activity.key_result.target_changed.eased", {
            from: String(p.from),
            to: String(p.to),
          })
        : t("activity.key_result.target_changed.moved", {
            from: String(p.from),
            to: String(p.to),
          }),
  "key_result.placed": (_p, t) => t("activity.key_result.placed"),
  "goal.placed": (_p, t) => t("activity.goal.placed"),
  "goal.kind_changed": (p, t) =>
    t("activity.goal.kind_changed", {
      to: asString(p.to, t("activity.fb.aDifferentKind")),
      from: asString(p.from, t("activity.fb.anotherKind")),
    }),
  "key_result.restored": (p, t) =>
    t("activity.key_result.restored", {
      title: asString(p.title, t("activity.fb.aKeyResult")),
    }),
  "key_result.kpi_linked": (_p, t) => t("activity.key_result.kpi_linked"),
  "key_result.kpi_unlinked": (_p, t) => t("activity.key_result.kpi_unlinked"),
  "check_in.draft_opened": (p, t) =>
    p.reopened
      ? t("activity.check_in.draft_opened.reopened")
      : t("activity.check_in.draft_opened.started"),
  "check_in.published": (p, t, w) =>
    t("activity.check_in.published", {
      status: w(
        "activity.word.checkInStatus",
        asString(p.status, t("activity.word.checkInStatus.on_track")),
        asString(p.status, "on track").replace("_", " "),
      ),
    }),
  "check_in.edited": (_p, t) => t("activity.check_in.edited"),
  "check_in.deleted": (p, t) =>
    p.rolledBack
      ? t("activity.check_in.deleted.rolledBack")
      : t("activity.check_in.deleted.plain"),
  "check_in.acknowledged": (p, t) =>
    p.repeat
      ? t("activity.check_in.acknowledged.repeat")
      : typeof p.settledEarlier === "number" && p.settledEarlier === 1
        ? t("activity.check_in.acknowledged.earlierOne")
        : typeof p.settledEarlier === "number" && p.settledEarlier > 0
          ? t("activity.check_in.acknowledged.earlierMany", {
              n: String(p.settledEarlier),
            })
          : t("activity.check_in.acknowledged.plain"),
  "alignment.dependency_added": (p, t) =>
    p.note
      ? t("activity.alignment.dependency_added.note")
      : t("activity.alignment.dependency_added.plain"),
  "alignment.dependency_removed": (_p, t) =>
    t("activity.alignment.dependency_removed"),
  "alignment.register_added": (p, t) =>
    t("activity.alignment.register_added", {
      provider: String(p.provider ?? t("activity.fb.anotherTeam")),
    }),
  "alignment.register_confirmed": (_p, t) =>
    t("activity.alignment.register_confirmed"),
  "alignment.register_risk_owned": (_p, t) =>
    t("activity.alignment.register_risk_owned"),
  "alignment.register_escalated": (_p, t) =>
    t("activity.alignment.register_escalated"),
  "alignment.register_provider_named": (p, t) =>
    !p.named
      ? t("activity.alignment.register_provider_named.cleared")
      : p.confirmationCleared
        ? t("activity.alignment.register_provider_named.changed")
        : t("activity.alignment.register_provider_named.named"),
  "alignment.register_removed": (_p, t) =>
    t("activity.alignment.register_removed"),
  "alignment.finding_dismissed": (p, t) =>
    t("activity.alignment.finding_dismissed", {
      rule: String(p.ruleKey ?? t("activity.fb.noRule")),
    }),
  "alignment.finding_applied": (_p, t) =>
    t("activity.alignment.finding_applied"),
  "kpi.category_created": (p, t) =>
    t("activity.kpi.category_created", { name: String(p.name ?? "") }),
  "kpi.created": (p, t) =>
    t("activity.kpi.created", {
      frequency: String(p.frequency ?? ""),
      title: String(p.title ?? ""),
    }),
  "kpi.shared": (p, t, w) =>
    t("activity.kpi.shared", {
      level: w(
        "activity.word.shareLevel",
        asString(p.level, t("activity.fb.view")),
      ),
    }),
  "kpi.unshared": (_p, t) => t("activity.kpi.unshared"),
  "kpi.responded": (p, t) =>
    p.response === "fix_now"
      ? t("activity.kpi.responded.fixNow")
      : t("activity.kpi.responded.keyResult"),
  "kpi.value_recorded": (p, t) =>
    p.created
      ? t("activity.kpi.value_recorded.created", {
          start: String(p.periodStart ?? ""),
        })
      : t("activity.kpi.value_recorded.updated", {
          start: String(p.periodStart ?? ""),
        }),
  "kpi.value_removed": (p, t) =>
    t("activity.kpi.value_removed", { start: String(p.periodStart ?? "") }),
  "kpi.formula_set": (p, t) =>
    t("activity.kpi.formula_set", { n: Number(p.references ?? 0) }),
  "kpi.tree_created": (p, t) =>
    t("activity.kpi.tree_created", { name: String(p.name ?? "") }),
  "cycle.snapshotted": (p, t) =>
    p.verdict
      ? t("activity.cycle.snapshotted.verdict", {
          n: Number(p.snapshots ?? 0),
          verdict: String(p.verdict),
        })
      : t("activity.cycle.snapshotted.none", { n: Number(p.snapshots ?? 0) }),
  "cycle.fed_forward": (p, t) =>
    t("activity.cycle.fed_forward", {
      scores: Number(p.priorScores ?? 0),
      issues: Number(p.issues ?? 0),
    }),
  "cycle.closed": (p, t) =>
    (() => {
      const name = asString(p.name, t("activity.fb.aCycle"));
      const verdict = p.verdict ? String(p.verdict).replace(/_/g, " ") : null;
      const fed = p.fedInto ? String(p.fedInto) : null;
      if (verdict && fed) {
        return t("activity.cycle.closed.verdictFed", { name, verdict, fed });
      }
      if (verdict) {
        return t("activity.cycle.closed.verdict", { name, verdict });
      }
      if (fed) {
        return t("activity.cycle.closed.fed", { name, fed });
      }
      return t("activity.cycle.closed.plain", { name });
    })(),
  "kpi.updated": (p, t) =>
    t("activity.kpi.updated", {
      fields:
        (p.fields as string[] | undefined)?.join(", ") ??
        t("activity.fb.noFields"),
    }),
  "kpi.recovery_launched": (p, t) =>
    t("activity.kpi.recovery_launched", { n: Number(p.keyResults ?? 0) }),
  "check_in.vote_cast": (p, t) =>
    p.changed
      ? t("activity.check_in.vote_cast.changed")
      : t("activity.check_in.vote_cast.cast"),
  "check_in.votes_revealed": (p, t) =>
    t("activity.check_in.votes_revealed", { n: Number(p.revealed ?? 0) }),
  "cadence.staleness_swept": (p, t) =>
    t("activity.cadence.staleness_swept", { n: Number(p.flipped ?? 0) }),
  "comment.created": (p, t, w) =>
    t("activity.comment.created", {
      subject: w(
        "activity.word.subject",
        asString(p.subjectType, t("activity.fb.subject")),
      ),
      excerpt: asString(p.excerpt, t("activity.fb.empty1")),
    }),
  "comment.updated": (p, t, w) =>
    t("activity.comment.updated", {
      subject: w(
        "activity.word.subject",
        asString(p.subjectType, t("activity.fb.subject")),
      ),
    }),
  "comment.deleted": (p, t, w) =>
    t("activity.comment.deleted", {
      subject: w(
        "activity.word.subject",
        asString(p.subjectType, t("activity.fb.subject")),
      ),
    }),
  "comment.filesResolved": (p, t) =>
    t("activity.comment.filesResolved", { n: Number(p.attachments ?? 0) }),
  "reaction.added": (p, t, w) =>
    t("activity.reaction.added", {
      emoji: asString(p.emoji),
      subject: w(
        "activity.word.subject",
        asString(p.subjectType, t("activity.fb.subject")),
      ),
    }),
  "reaction.removed": (p, t, w) =>
    t("activity.reaction.removed", {
      emoji: asString(p.emoji),
      subject: w(
        "activity.word.subject",
        asString(p.subjectType, t("activity.fb.subject")),
      ),
    }),
  "session.created": (p, t) =>
    t("activity.session.created", {
      kind: asString(p.kind),
      title: asString(p.title),
    }),
  "session.cycleBooked": (p, t) =>
    t("activity.session.cycleBooked", { n: Number(p.booked ?? 0) }),
  "session.opened": (p, t) =>
    t("activity.session.opened", { kind: asString(p.kind) }),
  "session.stageAdvanced": (p, t) =>
    t("activity.session.stageAdvanced", {
      stage: asString(p.to, t("activity.fb.next")),
    }),
  "session.skipped": (p, t) =>
    t("activity.session.skipped", { kind: asString(p.kind) }),
  "session.closed": (p, t) =>
    t("activity.session.closed", { kind: asString(p.kind) }),
  "session.voteCast": (_p, t) => t("activity.session.voteCast"),
  "session.votesRevealed": (p, t) =>
    t("activity.session.votesRevealed", { n: asCount(p.count) }),
  "session.confidenceConfirmed": (p, t) =>
    t("activity.session.confidenceConfirmed", { value: asCount(p.confidence) }),
  "session.winsNamed": (p, t) =>
    asCount(p.count) === 1
      ? t("activity.session.winsNamed.one")
      : t("activity.session.winsNamed.many", { n: asCount(p.count) }),
  "session.nextActionSet": (_p, t) => t("activity.session.nextActionSet"),
  "session.blockerCreated": (p, t) =>
    t("activity.session.blockerCreated", { type: asString(p.type) }),
  "goal.blocker_raised": (p, t) =>
    t("activity.goal.blocker_raised", { type: asString(p.type) }),
  "session.blockerResolved": (p, t) =>
    t("activity.session.blockerResolved", { type: asString(p.type) }),
  "session.blockerReassigned": (p, t) =>
    t("activity.session.blockerReassigned", {
      type: asString(p.type, t("activity.fb.blocker")),
      owner: asString(p.ownerName, t("activity.fb.somebodyElse")),
    }),
  "session.commitmentsSet": (p, t) =>
    t("activity.session.commitmentsSet", { n: asCount(p.count) }),
  "session.commitmentsClosed": (p, t) =>
    t("activity.session.commitmentsClosed", { n: asCount(p.count) }),
  "session.coordinatorNoteSet": (_p, t) =>
    t("activity.session.coordinatorNoteSet"),
  "session.digestPosted": (p, t) =>
    (() => {
      const named = (Array.isArray(p.channels) ? p.channels : []).map(
        (channel) => (channel === "teams" ? "Teams" : "Slack"),
      );
      return named.length > 0
        ? t("activity.session.digestPosted.on", {
            channels: named.join(t("activity.joinAnd")),
          })
        : t("activity.session.digestPosted.plain");
    })(),
  "session.trendRecorded": (p, t) =>
    t("activity.session.trendRecorded", {
      trend: asString(p.trend, t("activity.fb.unknown")),
    }),
  "session.shiftsRecorded": (_p, t) => t("activity.session.shiftsRecorded"),
  "session.decisionRecorded": (_p, t) => t("activity.session.decisionRecorded"),
  "session.minuteAdded": (p, t) =>
    t("activity.session.minuteAdded", {
      stage: asString(p.stageKey, t("activity.fb.current")),
    }),
  "session.stageNoteSet": (p, t) =>
    t("activity.session.stageNoteSet", {
      stage: asString(p.stageKey, t("activity.fb.current")),
    }),
  "session.pulseGiven": (_p, t) => t("activity.session.pulseGiven"),
  "session.keyResultScored": (_p, t) => t("activity.session.keyResultScored"),
  "session.objectiveScoreRevealed": (_p, t) =>
    t("activity.session.objectiveScoreRevealed"),
  "session.micPassed": (_p, t) => t("activity.session.micPassed"),
  "session.narrativeWritten": (_p, t) => t("activity.session.narrativeWritten"),
  "session.kudosGiven": (_p, t) => t("activity.session.kudosGiven"),
  "session.retroNoteAdded": (_p, t) => t("activity.session.retroNoteAdded"),
  "session.retroNoteRemoved": (_p, t) => t("activity.session.retroNoteRemoved"),
  "session.retroVoteCast": (_p, t) => t("activity.session.retroVoteCast"),
  "session.managementAnswerRecorded": (_p, t) =>
    t("activity.session.managementAnswerRecorded"),
  "session.rootCauseNamed": (_p, t) => t("activity.session.rootCauseNamed"),
  "session.processHealthSubmitted": (_p, t) =>
    t("activity.session.processHealthSubmitted"),
  "session.diagnosticRead": (_p, t) => t("activity.session.diagnosticRead"),
  "session.objectiveDecided": (_p, t) => t("activity.session.objectiveDecided"),
  "session.learningCaptured": (_p, t) => t("activity.session.learningCaptured"),
  "session.nextCycleDrafted": (_p, t) => t("activity.session.nextCycleDrafted"),
  "session.actionAgreed": (_p, t) => t("activity.session.actionAgreed"),
  "session.actionCompleted": (_p, t) => t("activity.session.actionCompleted"),
  "copilot.asked": (_p, t) => t("activity.copilot.asked"),
  "copilot.answered": (_p, t) => t("activity.copilot.answered"),
  "copilot.stopped": (_p, t) => t("activity.copilot.stopped"),
  "copilot.proposed": (_p, t) => t("activity.copilot.proposed"),
  "copilot.proposalApplied": (_p, t) => t("activity.copilot.proposalApplied"),
  "copilot.proposalDismissed": (_p, t) =>
    t("activity.copilot.proposalDismissed"),
  "copilot.proposalUndone": (_p, t) => t("activity.copilot.proposalUndone"),
  "copilot.threadDeleted": (_p, t) => t("activity.copilot.threadDeleted"),
  "copilot.rated": (_p, t) => t("activity.copilot.rated"),
  "copilot.unrated": (_p, t) => t("activity.copilot.unrated"),
  "webhook.created": (p, t) =>
    t("activity.webhook.created", { name: asString(p.name) }),
  "webhook.updated": (p, t) =>
    t("activity.webhook.updated", { name: asString(p.name) }),
  "webhook.secret_rotated": (p, t) =>
    t("activity.webhook.secret_rotated", { name: asString(p.name) }),
  "webhook.removed": (p, t) =>
    t("activity.webhook.removed", { name: asString(p.name) }),
  "webhook.tested": (p, t) =>
    t("activity.webhook.tested", { name: asString(p.name) }),
  "webhook.redelivered": (p, t) =>
    t("activity.webhook.redelivered", {
      event: asString(p.event, t("activity.fb.anEvent")),
      name: asString(p.name),
    }),
  "webhook.turned_off": (p, t) =>
    t("activity.webhook.turned_off", {
      name: asString(p.name),
      n: asCount(p.failures),
    }),
  "channel.connected": (p, t) =>
    t("activity.channel.connected", { provider: String(p.provider) }),
  "channel.disconnected": (p, t) =>
    t("activity.channel.disconnected", { provider: String(p.provider) }),
  "channel.identity_linked": (p, t) =>
    t("activity.channel.identity_linked", { provider: String(p.provider) }),
  "channel.identity_unlinked": (p, t) =>
    t("activity.channel.identity_unlinked", { provider: String(p.provider) }),
  "channel.link_started": (p, t) =>
    t("activity.channel.link_started", { provider: String(p.provider) }),
  "channel.message_queued": (p, t) =>
    p.duplicate
      ? t("activity.channel.message_queued.duplicate", {
          provider: String(p.provider),
        })
      : t("activity.channel.message_queued.queued", {
          provider: String(p.provider),
        }),
};

/** Renders any registered kind; a kind without one is a build-time bug, not a runtime one, since the catalogue is exhaustive. */
export function renderActivity(
  kind: string,
  payload: Record<string, unknown>,
  locale = "en",
): string {
  const renderer = (
    ACTIVITY_RENDERERS as Record<string, ActivityRenderer | undefined>
  )[kind];
  if (!renderer) {
    return kind;
  }
  const catalogue = getServerCatalogue(locale);
  const t: ActivityTranslate = (key, values) =>
    serverTranslate(locale, key, values);
  const w: ActivityWord = (prefix, value, fallback) => {
    const key = `${prefix}.${value}`;
    return key in catalogue
      ? serverTranslate(locale, key)
      : (fallback ?? value);
  };
  return renderer(payload, t, w);
}
