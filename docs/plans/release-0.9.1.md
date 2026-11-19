# Plan: release 0.9.1

Owner: Akmal. Started 19 November 2026.

Status: **planning decisions approved on 19 November 2026**. Akmal put the 0.9.0 known issues in this patch and accepted the directions in section 6. The required designs still need explicit "design approved" before code.

This patch starts with the Viewer access gap. It carries the six rows in the [0.9.0 known issues](release-0.9.0.md#71-known-issues-to-name-in-the-release-notes), four deferred findings from the [acceptance test](../report/uat-0.9.0-report.md), and the demo role fix. The board edit flag is the board row from §7.1. The build log in the 0.9.0 plan records the earlier copilot and input-pack work.

Each numbered row is one change in the CLAUDE.md change loop. **S** is under a day, **M** is a few days and **L** is about a week or more. Sizes are estimates. Dependencies refer to rows or decisions in this plan.

## 1. Access and security

| # | What a person meets | Change | Design first | Size | Depends on |
|---|---|---|---|---|---|
| A1 | A Viewer can create a task or session in a space they belong to. A Viewer who champions an objective can add a key result. The + New menu can also offer work the server refuses. | Apply the domain floor to `tasks.create` and add an explicit session permission for `sessions.create`. For `goals.addKeyResult`, preserve explicit edit bindings, including a champion's, and enforce the goal access rule in the shared action and UI. See `packages/core/src/actions/{tasks,sessions,goals}.ts`, `packages/core/src/operations/operation.ts` and [workspace roles](../design/workspace-roles.md) §§3, 8 and 11. | Yes, access | M | A1-Q1, A1-Q2 |
| A2 | Safari on a plain HTTP self-hosted instance loads without styles and sign-in fails. The 0.9.0 test traced this to `upgrade-insecure-requests` in the Content Security Policy. | Use the configured public origin to decide whether `apps/web/proxy.ts` emits the directive. Verify plain HTTP and TLS offload in Safari, and cover untrusted forwarding headers in the header tests. | Yes, [csp-public-origin.md](../design/csp-public-origin.md) | M | A2-Q |
| A3 | A demo persona with no role is refused the input-pack write, even when named facilitator. Ordinary Members may write only when named facilitator. | Have `pnpm demo:prepare` assign the built-in Member role through the existing role assignment path to roleless demo accounts it creates or can identify on reruns. Check both facilitator and non-facilitator against `packages/core/src/cycles/input-pack-access.ts`. See `packages/core/src/bin/demo-prepare.ts`, `packages/core/src/demo/personas.ts` and `packages/core/src/actions/roles.ts`. | Yes, role assignment | S | A3-Q |

## 2. Goals and board

| # | What a person meets | Change | Design first | Size | Depends on |
|---|---|---|---|---|---|
| W1 | The Goals page with 1,000 objectives froze for about 1.4 seconds when one save started and again when it settled. | Stabilise the pending IDs from `usePendingOkrIds` and keep unrelated rows from rerendering. Measure the same single-row write before and after in `apps/web/lib/okr-tree/use-okr-tree.ts` and `apps/web/app/goals/okr-table.tsx`. | No | M | None |
| W2 | The board offers a move handle on a card the member can only view. A move is refused and the card returns to its old slot. | Add a per-card edit flag to `tasks.board`, computed with the task access rule used by `tasks.move`. Use it for pointer and keyboard moves, including after a live board refresh, and regenerate the contract. See `packages/core/src/actions/tasks.ts`, `apps/web/app/board/page.tsx` and `apps/web/app/api/board/live/route.ts`. | Yes, access-aware read contract | M | A1 for the final role test matrix |

## 3. The copilot

| # | What a person meets | Change | Design first | Size | Depends on |
|---|---|---|---|---|---|
| C1 | The step line appears quickly, but the first word took about 11 seconds on GPT-6 Luna in 0.9.0 (median of five). The target was about 2 seconds. | Time each read round in `packages/core/src/copilot/reading.ts` and design a quicker path for simple questions. Compare time to first word and grounded-answer quality on the same fixtures and live sample before changing the loop. | Yes, read-loop design called out in §7.1 | L | C1-Q |
| C2 | "Create a task" gives no card, and an initiative can link a different key result from the one the member named. | Tune the prompts and offered choices in `packages/core/src/copilot/propose-tool.ts`, `packages/core/src/copilot/proposals.ts` and `packages/agents/src/drafter.ts`. Test a task request and similar key-result names. Ask when the intended link is ambiguous. | No, tuning within the approved proposal flow | M | None |
| C3 | **UAT F-03.** A check-in without confidence gives no card and the answer sends the member to the form. A request naming a key result can do the same. | Resolve a named key result to its objective and ask for the required confidence when it is missing. Keep the existing objective check-in and member confirmation. See `packages/core/src/copilot/proposals.ts`, `packages/agents/src/drafter.ts` and [copilot live data](../design/copilot-live-data.md) §4.3. | No, if it stays within the approved proposal flow | M | C3-Q, C2 |
| C4 | **UAT F-04.** A member who chose Malay got Indonesian prose, a raw `on_track` code and adjacent citation chips that read as one number. | Pass the resolved English or Malay locale to the answer paths. Test rendered health labels and add spacing between citations in the answer UI. Use machine translation for any added or revised Malay copy, and track the [13 doubtful Malay items](../report/malay-review-0.9.0.md) for gradual correction. See `apps/web/lib/locale.ts`, `packages/core/src/copilot/{answer,reading}.ts` and `apps/web/app/copilot/turn.tsx`. | No, within the current two locales | M | C4-Q |
| C5 | **UAT F-08.** The reading line says "Reading an objective" even when the member asked about a record by name. The report could not tell whether the runs only made list reads. | Verify the events from a real single-record read and pass its access-scoped title to the existing status line when the read returns one. Keep the generic line for lists and refused reads. See `packages/core/src/copilot/reading.ts` and `apps/web/app/copilot/turn.tsx`. | No | S | None |
| C6 | **UAT F-09.** In Admin, AI, a refused proposal is labelled as a read. | Use the recorded proposal type and outcome for its own label. Count only reads in any total labelled as reads. See `packages/core/src/copilot/read-record.ts` and `apps/web/app/admin/ai/agent-calls-card.tsx`. | No, display and counting | S | None |

## 4. Checks before the release

| Area | Check |
|---|---|
| Viewer and board | Verify UI and contract writes as a Viewer, a champion, a Member, and a member with mixed card access. Try keyboard and pointer moves. Confirm a refused action still refuses after a role change. |
| Demo | Prepare a seeded demo twice. Sign in as the named facilitator and another persona. Confirm Member assignment, the pack rules and existing custom assignments. |
| Safari and Goals | Record the public HTTP and HTTPS Safari results. Compare the 1,000-objective save on the same data and browser. |
| Copilot | Replay the known issues and F-03, F-04, F-08 and F-09. Check time to first word, the proposed record, English and Malay replies, status events and administrator labels. Use automated catalogue checks for changed copy and record wording issues for later fixes. |
| Upgrade | When the patch is ready, record any migration or data change the approved access work needs and smoke-test the upgrade from 0.9.0. |

## 5. Left out on purpose

| Item | Where it belongs |
|---|---|
| G4, per-KPI access and FlowyTeam KPI shares | [0.10.0](release-0.10.0.md), as decided by Akmal on 19 November. |
| Eight additional locales and the shared language infrastructure | [0.10.0](release-0.10.0.md). C4 fixes the reported two-locale defect. |
| UAT F-01, F-02, F-05, F-06 and F-07 | The checked-out branch already has fixes. F-05 closed the roleless write path. A3 covers preparing the demo accounts under that rule. |

## 6. Decisions

Akmal answered the questions on 19 November 2026. The initial translation pass uses machine translation and ships without native sign-off.

| # | Question | Recommended | Cost | Akmal's answer |
|---|---|---|---|---|
| A1-Q1 | Who may create a session when sessions have no domain in the role matrix? | Give session creation an explicit session permission. Seed Owner and Admin with full, Member with edit and Viewer with view. Require access to the named space. Give custom roles no automatic session grant and cover any intentionally scoped actor paths in the design. | Extends the role matrix and needs a data change for existing built-in roles. Owners may need to adjust custom roles. | Approved as recommended |
| A1-Q2 | May an explicit champion edit binding let a Viewer add a key result to that objective? | Yes, on that objective, under the existing maximum-of-role-and-binding rule. Workspace membership or the Viewer role alone gives no edit. | A champion who holds Viewer can still edit that objective. An absolute ban would change the additive model. | Approved as recommended |
| A2-Q | Should plain HTTP stay usable in the self-hosted setup that exposed the Safari issue? | Yes. Keep the directive on public HTTPS and serve the HTTP path without it. Keep the decision inside the trusted-proxy policy. | Requires a short security design and Safari tests on both sides of TLS termination. | Approved as recommended |
| A3-Q | May `demo:prepare` fill empty roles for verified demo personas already prepared? | Yes. Fill the empty role with built-in Member and preserve any role already assigned. Keep the input-pack rule from F-05. | Changes access for previously roleless demo personas and needs a rerun test. | Approved as recommended |
| C1-Q | How should the first-word target apply to questions that need several live reads? | Keep about 2 seconds as the target for simple questions and report multi-read latency separately. Keep the grounded read path for questions that need it. | Adds a benchmark split. Some multi-read answers will take longer. | Approved as recommended |
| C3-Q | Should the copilot accept a key-result request and ask for missing confidence? | Yes. Resolve the parent objective and ask a focused question before offering the objective check-in card. | Adds a turn when input is missing and needs evaluation for ambiguous names. | Approved as recommended |
| C4-Q | Should a 0.9.1 copilot answer use the member's resolved interface locale? | Yes. Use English or Malay as resolved by the app. The 0.10.0 plan covers explicit requests for another language. | A deliberate mixture of languages in a prompt still gets the chosen interface locale by default. | Approved. Use machine translation for the initial copy and improve the wording gradually. |

## 7. Suggested order

1. **A1** first. Follow the approved [workspace-roles.md §14](../design/workspace-roles.md#14-task-and-session-creation-and-key-results-plan-091-a1) and test the Viewer gap across the shared write paths.
2. **A2**, then **A3** and **W2** once their designs are approved. **W1** can proceed independently after A1.
3. **C2**, then **C3**. **C4**, **C5** and **C6** can proceed independently. Write the **C1** design early and measure the final loop after the proposal changes.
4. Run the release checks in section 4 and write the upgrade notes from the work that landed.

## 8. Build log

Statuses: **to do**, **design written**, **in verification**, **done**, **merged**, **yours** (decision or action for Akmal).

| Row | Status | Note |
|---|---|---|
| A1 | done | Committed as `abc5db70` on 19 November 2026. Task creation and both session writes use role floors. Data change `0036_session_role_permissions` fills the new permission. The production build, `check:fast`, and 37 browser checks passed. The changed-test run passed 8,136 source tests, including the PgBouncer and password checks. It also picked up 194 generated test copies from the concurrent build. After moving the build output, the affected web run passed all 1,113 tests. |
| A2 | in verification | Approved on 19 November 2026. The proxy uses the configured public origin on pages and sign-in redirects. Regression tests cover both schemes, the default and conflicting request headers. Browser checks are grouped at the end of the patch. |
| A3 | design written, waiting for design approved | [Demo persona roles](../design/demo-persona-roles.md) gives verified roleless demo accounts built-in Member through the existing assignment path. |
| W2 | design written, waiting for design approved | [Board card moves](../design/board-card-moves.md) adds an effective task Edit flag and clears an active move when a refresh revokes access. |
| C1 | design written, waiting for design approved | [Copilot first word](../design/copilot-first-word.md) times each stage and tests a one-call answer for simple questions grounded in an already read anchor. |
| W1 | in verification | The Goals list passes each card its own pending and refused state. In the same 1,000-objective jsdom fixture, one title save took about 903 ms to start and 1,196 ms to settle before the change, and 16 ms and 6 ms after. The browser spec checks the busy state and the settled value. |
| C2 | in verification | Task proposals can use the named or sole eligible space. Initiative and task links resolve against scoped choices and decline ambiguous matches. |
| C3 | in verification | A named key result resolves to its editable parent objective. A check-in needs the member's overall confidence, and a short confidence reply can complete the previous request before the card is offered. |
| C4, C5, C6 | to do | Findings carried forward on 19 November 2026. |
| Section 6 | decided | Akmal approved the directions on 19 November 2026 and chose machine translation for the initial copy. |
