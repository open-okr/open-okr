/**
 * What a workspace archive holds, and what it must never hold
 * (TECHNICAL-PLAN §7.3, P6-T05a).
 *
 * **The list is the deliverable, not a detail of it.** There are 129 tables.
 * §7.3 says an archive carries every workspace row in dependency order with
 * "secrets, sessions, tokens, channel credentials and the audit chain excluded
 * by a policy list", and every one of those exclusions is there for a reason a
 * reader should be able to check:
 *
 * - a **session** or a **token** in the file is a credential somebody can
 *   carry to another instance and sign in with;
 * - a **channel credential** is somebody else's account, granted to this
 *   instance and to no other;
 * - the **audit chain** is hash-chained per workspace, so replaying it
 *   elsewhere would make that instance assert events that never happened
 *   there, which is the one thing an audit log must not do.
 *
 * Two more classes the plan does not name and this list does, because leaving
 * them out is a decision either way:
 *
 * - **derived rows are excluded and recomputed**, which is the same rule §7.2
 *   applies to an import: a search index, an embedding, a cache entry and an
 *   in-flight outbox row are facts about the instance that built them;
 * - **a run's own history is excluded**, because an import run or an export run
 *   records something that happened on one instance and did not happen on the
 *   next.
 *
 * **Nothing is exported by default.** A table absent from this list fails
 * `portability-policy.test.ts`, which reads the live database rather than the
 * TypeScript schema, so a table a migration created without a Drizzle
 * definition is caught too. A new table has to be classified by whoever adds
 * it, which is the only moment anybody knows what is in it.
 */

/** Why a table is in or out, in the words a reader should get. */
export interface TablePolicy {
  readonly table: string;
  readonly decision: "export" | "exclude";
  readonly reason: string;
}

/**
 * Columns whose value is written in a second pass.
 *
 * **The schema has circular foreign keys, so no single insert order exists.**
 * A goal points at its latest check-in and a check-in points at its goal; a
 * KPI points at its tree and a tree at its root KPI; a goal points at the key
 * result it aligns to and a key result at its goal. Measured on the live
 * schema: 43 tables sit in one cycle, and **every cycle is broken by a
 * nullable column**, which is what makes an order possible at all.
 *
 * So the archive is ordered as if these columns did not exist, and an import
 * writes them afterwards. `portability-policy.test.ts` proves the invariant
 * against the live foreign keys rather than trusting this list: a nullable
 * cycle-breaking column added later is found by the test, and a **NOT NULL**
 * circular reference fails it outright, because that would be a schema no
 * archive could load.
 */
export const DEFERRED_COLUMNS: readonly string[] = [
  "goals.last_check_in_id",
  "goals.parent_key_result_id",
  "kpis.tree_id",
  "kpis.recovery_goal_id",
  "check_ins.snapshot_id",
  "kpi_trees.root_kpi_id",
];

/**
 * Every table, in the order an import may write them.
 *
 * Derived from the live foreign keys with `DEFERRED_COLUMNS` removed, and a
 * test recomputes it: a table that moves ahead of something it references
 * fails rather than producing an archive that cannot be loaded.
 */
export const TABLE_POLICY: readonly TablePolicy[] = [
  // ── Not a workspace's data at all ────────────────────────────────────
  {
    table: "_data_changes",
    decision: "exclude",
    reason:
      "The data-change runner's own ledger. It records which backfills this instance has run, which is a fact about the instance and not about the workspace.",
  },
  {
    table: "_migrations",
    decision: "exclude",
    reason:
      "The schema's own bookkeeping. The receiving instance has its own, and the archive names its schema version in the manifest instead.",
  },
  {
    table: "system_settings",
    decision: "exclude",
    reason:
      "Instance-wide settings, including sealed secrets. Not scoped to a workspace and not the exporter's to hand over.",
  },
  {
    table: "cache_entries",
    decision: "exclude",
    reason: "A cache. Rebuilt on demand, and stale the moment it is copied.",
  },
  {
    table: "outbox",
    decision: "exclude",
    reason:
      "Side effects waiting to fire on this instance. Carrying them would send somebody else's notifications from a second place.",
  },
  {
    table: "instance_audit_events",
    decision: "exclude",
    reason:
      "The instance's own audit log, covering every workspace on it. Not this workspace's to export.",
  },
  {
    table: "search_documents",
    decision: "exclude",
    reason:
      "The search index. Derived from the rows beside it and rebuilt after load, so carrying it would only let it drift.",
  },
  {
    table: "embeddings",
    decision: "exclude",
    reason:
      "Vectors, derived from content and from a model this instance chose. The receiving instance may use another model, so they are recomputed.",
  },

  // ── Identity, sessions and credentials ───────────────────────────────
  {
    table: "users",
    decision: "exclude",
    reason:
      "The global identity row, shared across every workspace on an instance. A member is matched to a user by email address on import, so exporting the row would assert an account the receiving instance does not own.",
  },
  {
    table: "accounts",
    decision: "exclude",
    reason: "Better Auth credentials. §7.3 excludes secrets.",
  },
  {
    table: "sessions",
    decision: "exclude",
    reason:
      "Signed-in sessions. A session in a file is a credential somebody can carry to another instance.",
  },
  {
    table: "verifications",
    decision: "exclude",
    reason: "One-time verification tokens, in flight and short-lived.",
  },
  {
    table: "passkeys",
    decision: "exclude",
    reason:
      "Passkey credentials, bound to this instance's identifier. They would not work elsewhere and must not travel.",
  },
  {
    table: "two_factors",
    decision: "exclude",
    reason: "Second-factor secrets and backup codes.",
  },
  {
    table: "api_tokens",
    decision: "exclude",
    reason:
      "Tokens, hashed at rest and scoped to this instance. §7.3 excludes tokens.",
  },
  {
    table: "device_authorisations",
    decision: "exclude",
    reason: "A device login in progress. Short-lived and instance-bound.",
  },
  {
    table: "invite_links",
    decision: "exclude",
    reason:
      "An invitation is a credential that admits somebody to this workspace on this instance. The imported workspace issues its own.",
  },
  {
    table: "oauth_clients",
    decision: "exclude",
    reason: "Client secrets for applications registered against this instance.",
  },
  {
    table: "oauth_codes",
    decision: "exclude",
    reason: "Authorisation codes, single-use and in flight.",
  },
  {
    table: "oauth_grants",
    decision: "exclude",
    reason:
      "What a member granted an application on this instance. The grant names a client the receiving instance does not have.",
  },
  {
    table: "oauth_access_tokens",
    decision: "exclude",
    reason: "Tokens an application holds against this instance.",
  },
  {
    table: "oauth_refresh_tokens",
    decision: "exclude",
    reason:
      "Tokens, longer-lived than the access tokens above and worse to leak.",
  },
  {
    table: "mcp_sessions",
    decision: "exclude",
    reason: "Sessions held open for an external agent.",
  },

  // ── The audit chain ──────────────────────────────────────────────────
  {
    table: "audit_events",
    decision: "exclude",
    reason:
      "Hash-chained per workspace and append-only. Replaying it on another instance would make that instance assert events that never happened there, and the chain would verify, which is worse than not carrying it.",
  },

  // ── Provider and channel credentials ─────────────────────────────────
  {
    table: "ai_credentials",
    decision: "exclude",
    reason:
      "Provider keys, envelope-encrypted under this instance's root key. Neither decryptable nor the exporter's to hand over.",
  },
  {
    table: "channel_installations",
    decision: "exclude",
    reason:
      "A chat provider's installation, granted to this instance. §7.3 excludes channel credentials.",
  },
  {
    table: "channel_connections",
    decision: "exclude",
    reason:
      "Per-workspace channel credentials and webhook secrets. The imported workspace connects its own.",
  },
  {
    table: "channel_link_codes",
    decision: "exclude",
    reason: "Short-lived codes that link a chat account to a member.",
  },
  {
    table: "channel_identities",
    decision: "exclude",
    reason:
      "A member's identifier in somebody else's chat provider, established through a connection the archive does not carry.",
  },

  // ── Messages already delivered ───────────────────────────────────────
  {
    table: "channel_conversations",
    decision: "exclude",
    reason:
      "A conversation held in a chat provider this workspace will connect afresh. Its identifiers name channels the receiving instance cannot see.",
  },
  {
    table: "channel_messages",
    decision: "exclude",
    reason:
      "Messages already sent through a provider. Carrying them would list deliveries that never happened on the new instance.",
  },
  {
    table: "notifications",
    decision: "exclude",
    reason:
      "Notification rows, which §7.2 already refuses for an import: a notification is a message that was delivered, and re-delivering somebody's year of alerts is the opposite of a migration.",
  },
  {
    table: "notification_batches",
    decision: "exclude",
    reason: "The digest batching for those notifications.",
  },
  {
    table: "digests",
    decision: "exclude",
    reason: "Digests already built and sent.",
  },
  {
    table: "nudges",
    decision: "exclude",
    reason:
      "A nudge is a proactive message that was sent, with its rule key, channel and escalation step. Carrying it would let the new instance dedupe against messages nobody there received.",
  },

  // ── A run's own history ──────────────────────────────────────────────
  {
    table: "import_runs",
    decision: "exclude",
    reason:
      "An import that happened on this instance, with a report describing rows in this database.",
  },
  {
    table: "export_runs",
    decision: "exclude",
    reason:
      "The same, and it would include the archive's own row, which cannot be inside itself.",
  },
  {
    table: "agent_runs",
    decision: "exclude",
    reason:
      "An agent run's state machine and its cost, recorded against this instance's provider. The proposals it produced are carried; the run that produced them is not.",
  },
  {
    table: "ai_usage_events",
    decision: "exclude",
    reason:
      "Token spend billed to this instance's provider account. A fact about the bill, not about the workspace.",
  },

  // ── Everything else: the workspace's own content ─────────────────────
  {
    table: "workspaces",
    decision: "export",
    reason:
      "The row the archive is about. Exactly one, and the manifest names it.",
  },
  {
    table: "access_contexts",
    decision: "export",
    reason:
      "The access model's contexts, one per protected object. Without them the imported workspace has no permissions and every read answers not-found.",
  },
  {
    table: "ai_budgets",
    decision: "export",
    reason:
      "Per-workspace AI spending caps, which are a setting somebody chose.",
  },
  {
    table: "ai_feature_settings",
    decision: "export",
    reason: "Which AI affordances this workspace has turned on.",
  },
  {
    table: "ai_model_policies",
    decision: "export",
    reason: "Which models this workspace allows.",
  },
  {
    table: "ai_models",
    decision: "export",
    reason:
      "The model catalogue as this workspace configured it, which the policies above name.",
  },
  {
    table: "ai_providers",
    decision: "export",
    reason:
      "Which providers this workspace uses. The keys are in ai_credentials and are excluded, so an imported provider arrives unconfigured and says so.",
  },
  {
    table: "annual_frames",
    decision: "export",
    reason: "The annual frame the cycles hang under.",
  },
  {
    table: "kpi_categories",
    decision: "export",
    reason: "The categories KPIs are grouped under.",
  },
  {
    table: "kpi_trees",
    decision: "export",
    reason: "The driver trees KPIs hang in.",
  },
  {
    table: "nudge_rules",
    decision: "export",
    reason:
      "Per-rule enablement, channel and ladder overrides. A setting, unlike the nudges themselves.",
  },
  {
    table: "rhythm_settings",
    decision: "export",
    reason: "Check-in day, frequency, grace and the escalation ladders.",
  },
  {
    table: "scorecard_settings",
    decision: "export",
    reason: "The scorecard points layer's settings, off by default.",
  },
  {
    table: "spaces",
    decision: "export",
    reason:
      "The teams that run a rhythm. Everything with an owner sits in one.",
  },
  {
    table: "subscription_lists",
    decision: "export",
    reason:
      "One list per notifiable artifact. The lists travel and the notifications do not, so somebody following a goal still follows it.",
  },
  {
    table: "whatsapp_templates",
    decision: "export",
    reason: "Message templates this workspace wrote.",
  },
  {
    table: "workspace_members",
    decision: "export",
    reason:
      "The memberships. Each is matched to a user by email address on import, or becomes a placeholder, which is the same shape the FlowyTeam importer writes.",
  },
  {
    table: "access_groups",
    decision: "export",
    reason: "The access model's groups, which bindings are granted to.",
  },
  {
    table: "activities",
    decision: "export",
    reason:
      "The feed. Not the audit log: it is not hash-chained, it is what people read on a page, and a workspace with no history reads as though it started today.",
  },
  {
    table: "agents",
    decision: "export",
    reason:
      "The Coach and the Champion as this workspace configured them, including their autonomy setting.",
  },
  {
    table: "ai_prompts",
    decision: "export",
    reason: "Prompt overrides somebody in this workspace wrote.",
  },
  {
    table: "ai_threads",
    decision: "export",
    reason:
      "Copilot conversations. Somebody's own writing, and theirs to take.",
  },
  {
    table: "annual_strategies",
    decision: "export",
    reason: "The strategy that frame carries.",
  },
  {
    table: "blobs",
    decision: "export",
    reason:
      "File metadata: the name, the type, the size and the digest. The bytes travel beside the rows.",
  },
  {
    table: "comments",
    decision: "export",
    reason: "What people wrote on the work, and theirs to take with them.",
  },
  {
    table: "cycles",
    decision: "export",
    reason: "The quarters and years the objectives hang under.",
  },
  {
    table: "documents",
    decision: "export",
    reason:
      "Long-form notes on a space, goal, key result, initiative, cycle or session.",
  },
  {
    table: "initiatives",
    decision: "export",
    reason: "The work that serves the key results.",
  },
  {
    table: "notification_settings",
    decision: "export",
    reason:
      "A member's own choices about channels and quiet hours, which follow them.",
  },
  {
    table: "reactions",
    decision: "export",
    reason: "One emoji per member per subject, on every major subject.",
  },
  {
    table: "space_members",
    decision: "export",
    reason: "Who belongs to which space, and in what role.",
  },
  {
    table: "streaks",
    decision: "export",
    reason:
      "A streak is a record of what somebody did over time and cannot be recomputed once the source is gone, unlike a score.",
  },
  {
    table: "subscriptions",
    decision: "export",
    reason: "Who follows what, and the reason each follow was created.",
  },
  {
    table: "whatsapp_template_mappings",
    decision: "export",
    reason: "Which template answers which rule.",
  },
  {
    table: "access_bindings",
    decision: "export",
    reason:
      "The access model's bindings. This is where who-can-see-what actually lives.",
  },
  {
    table: "access_group_memberships",
    decision: "export",
    reason: "Who is in which access group.",
  },
  {
    table: "ai_messages",
    decision: "export",
    reason: "The messages in those copilot threads.",
  },
  {
    table: "attachments",
    decision: "export",
    reason: "Which file is hung on which subject.",
  },
  {
    table: "cycle_baseline_health",
    decision: "export",
    reason:
      "The health a cycle opened at. A baseline is a measurement taken at a moment and cannot be recomputed later.",
  },
  {
    table: "cycle_calibrations",
    decision: "export",
    reason: "What a calibration session decided.",
  },
  {
    table: "cycle_capacity_notes",
    decision: "export",
    reason: "The capacity judgement a room made, in its own words.",
  },
  {
    table: "cycle_gate_state",
    decision: "export",
    reason: "Which publish gates a cycle has passed.",
  },
  {
    table: "cycle_pack_items",
    decision: "export",
    reason: "The review pack a cycle assembled.",
  },
  {
    table: "cycle_revalidations",
    decision: "export",
    reason: "What a revalidation found.",
  },
  {
    table: "document_versions",
    decision: "export",
    reason:
      "A version is a record of a publish. Section 7.2 refuses to invent versions for an imported document, and these are not invented: they happened.",
  },
  {
    table: "goals",
    decision: "export",
    reason: "The objectives. The reason the workspace exists.",
  },
  {
    table: "kpis",
    decision: "export",
    reason: "The measures a workspace watches between cycles.",
  },
  {
    table: "kpi_dependencies",
    decision: "export",
    reason: "How one KPI feeds another.",
  },
  {
    table: "kpi_records",
    decision: "export",
    reason: "Every KPI measurement, which is the KPI's whole history.",
  },
  {
    table: "kpi_shares",
    decision: "export",
    reason: "Who a KPI is shared with beyond its owning space.",
  },
  {
    table: "performance_snapshots",
    decision: "export",
    reason:
      "A snapshot of performance at a point in time. History, not a derived value: recomputing it now would give today's answer for last quarter.",
  },
  {
    table: "score_entries",
    decision: "export",
    reason: "Scorecard points already awarded, and what they were for.",
  },
  {
    table: "check_ins",
    decision: "export",
    reason: "Every check-in written, with its narrative and its confidence.",
  },
  {
    table: "cycle_priorities",
    decision: "export",
    reason: "What a cycle chose to put first.",
  },
  {
    table: "goal_dependencies",
    decision: "export",
    reason: "How objectives depend on each other.",
  },
  {
    table: "goal_retrospectives",
    decision: "export",
    reason: "What a retrospective concluded about an objective.",
  },
  {
    table: "key_results",
    decision: "export",
    reason: "How each objective is measured.",
  },
  {
    table: "objective_trends",
    decision: "export",
    reason:
      "The trend an objective traced. A series of past measurements, which cannot be recovered once the source is gone.",
  },
  {
    table: "okr_sessions",
    decision: "export",
    reason: "Planning and review sessions, with the stage each one reached.",
  },
  {
    table: "proposed_changes",
    decision: "export",
    reason:
      "Proposals sitting in the review queue. Somebody has to answer them, and they should not have to answer them twice.",
  },
  {
    table: "alignment_findings",
    decision: "export",
    reason:
      "What the alignment engine found, and what somebody did about each one.",
  },
  {
    table: "blockers",
    decision: "export",
    reason: "What stood in the way, with its taxonomy and its clock.",
  },
  {
    table: "check_in_snapshots",
    decision: "export",
    reason: "What a check-in saw of its objective when it was written.",
  },
  {
    table: "check_in_votes",
    decision: "export",
    reason: "Confidence votes cast on a check-in.",
  },
  {
    table: "commitments",
    decision: "export",
    reason: "What somebody undertook to do, and by when.",
  },
  {
    table: "cycle_focus_key_results",
    decision: "export",
    reason: "The key results a cycle put in focus.",
  },
  {
    table: "cycle_issues",
    decision: "export",
    reason: "Issues raised against a cycle.",
  },
  {
    table: "cycle_prior_scores",
    decision: "export",
    reason: "The scores a cycle carried in from the last one.",
  },
  {
    table: "decisions",
    decision: "export",
    reason: "What a room decided, and who decided it.",
  },
  {
    table: "initiative_key_results",
    decision: "export",
    reason: "Which key results an initiative serves.",
  },
  {
    table: "key_result_dependencies",
    decision: "export",
    reason: "How key results depend on each other.",
  },
  {
    table: "key_result_values",
    decision: "export",
    reason: "The measured history of every key result.",
  },
  {
    table: "kudos",
    decision: "export",
    reason: "Recognition somebody gave somebody else.",
  },
  {
    table: "management_answers",
    decision: "export",
    reason: "The management retro's answers.",
  },
  {
    table: "next_cycle_drafts",
    decision: "export",
    reason: "Drafts carried forward for the next cycle.",
  },
  {
    table: "process_health_responses",
    decision: "export",
    reason: "The process health survey's answers.",
  },
  {
    table: "retro_notes",
    decision: "export",
    reason: "What a retrospective surfaced.",
  },
  {
    table: "retro_votes",
    decision: "export",
    reason: "How a room ranked those notes.",
  },
  {
    table: "review_actions",
    decision: "export",
    reason: "The actions a review agreed.",
  },
  {
    table: "review_decisions",
    decision: "export",
    reason: "The decisions a review recorded.",
  },
  {
    table: "review_diagnostics",
    decision: "export",
    reason: "The closing diagnostic's answers.",
  },
  {
    table: "review_narratives",
    decision: "export",
    reason: "The narratives a review wrote.",
  },
  {
    table: "review_scores",
    decision: "export",
    reason: "The scores a review recorded.",
  },
  {
    table: "root_causes",
    decision: "export",
    reason: "What a five-whys pass found under a blocker.",
  },
  {
    table: "session_confidences",
    decision: "export",
    reason: "Confidence collected in a session.",
  },
  {
    table: "session_participants",
    decision: "export",
    reason: "Who was in a session, and in what part.",
  },
  {
    table: "tasks",
    decision: "export",
    reason: "The work itself, under the initiatives that carry it.",
  },
  {
    table: "task_assignees",
    decision: "export",
    reason: "Who a task is assigned to, which also grants them edit on it.",
  },
  {
    table: "checklist_items",
    decision: "export",
    reason: "The checklist lines on a task.",
  },
  {
    table: "learnings",
    decision: "export",
    reason: "What a cycle taught, recorded where the next one will read it.",
  },
];

/** The tables an archive carries, in the order an import may write them. */
export const EXPORTED_TABLES: readonly string[] = TABLE_POLICY.filter(
  (entry) => entry.decision === "export",
).map((entry) => entry.table);

/** The tables an archive must never carry. */
export const EXCLUDED_TABLES: readonly string[] = TABLE_POLICY.filter(
  (entry) => entry.decision === "exclude",
).map((entry) => entry.table);

export function policyFor(table: string): TablePolicy | undefined {
  return TABLE_POLICY.find((entry) => entry.table === table);
}

/** Whether this column's value waits for a second pass. */
export const isDeferred = (table: string, column: string): boolean =>
  (DEFERRED_COLUMNS as readonly string[]).includes(`${table}.${column}`);
