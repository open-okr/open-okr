# Pending indicators: open questions for review

Reviewer: Claude Opus. Author of the work so far: Claude Sonnet. Owner: Agung. Written 2026-11-05 on branch `agung`.

Plan being executed: [pending-indicators.md](pending-indicators.md). Read it first. This file lists what is done, what deviates from the plan, what is unverified, and every question that needs a decision before Change 3 continues.

## 1. State of the work

| Commit | Change | Status |
|---|---|---|
| `1f99cd2c` | Change 1: `Button` shows a spinner for any `type="submit"` in a form with a function action | Committed. `pnpm check:fast` 12 of 12, `pnpm test:changed` 587 tests green |
| `223c4964` | Change 2: Goals and Admin > General | Committed. Same gates green |
| `0007c7d2` | The plan file | Committed |
| none | Change 3, batches 3a to 3e | Not started. Batch 3a candidate table is in section 5 and waits for approval |

Not pushed. CI has not run. The full unit suite and the e2e suite are CI's job.

Files to read for the review:

| Area | File |
|---|---|
| The hook and the auto-pending rule | `packages/ui/src/components/button.tsx` |
| `SubmitButton` after the change | `packages/ui/src/components/submit-button.tsx` |
| Standalone spinner | `packages/ui/src/components/spinner.tsx` |
| Row spinner source | `apps/web/lib/okr-tree/use-okr-tree.ts` (`OKR_WRITE_KEY`, `usePendingOkrIds`) |
| Row spinner use | `apps/web/app/goals/okr-table.tsx` (`savingIds`, `saving` prop on `ObjectiveRow` and `KeyResultRow`) |
| Multi-button tracking | `apps/web/app/goals/[id]/goal-writes.tsx`, `apps/web/app/admin/general/general-settings-form.tsx` |

## 2. How it was checked

| Check | Result |
|---|---|
| Unit tests (5 new, in `packages/ui/test/submit-button.test.tsx`) | Pass |
| Browser, POST requests delayed 2.5 to 3 s | Spinner on Admin > General (settings Save, name, registration, update check), on the Goals row being renamed, and on the goal Edit form. Reset does not spin when Save is pressed. Spinner cleared when the server answered |
| Server pages that call `buttonVariants` (`/kpis`, `/review`, `/goals`, `/sessions`, a 404) | Render, status 200 or 404 as expected |

Test data left behind: the objective "aaaa" was renamed to "aaaab" and back. The Save buttons of the general settings, instance name, registration, update check and goal Edit forms were pressed with unchanged values. No value changed. The audit log has the writes.

## 3. Deviations from the plan

The plan said to change these. Sonnet did not, for the reason given. Confirm or overrule each.

| # | File | Plan said | Done | Reason |
|---|---|---|---|---|
| D1 | `goals/[id]/retrospective-field.tsx` | `pending` on the writing buttons | Nothing | The buttons ask the AI for a draft or move it into the editor. The save is the surrounding page form, which Change 1 covers |
| D2 | `goals/[id]/decompose.tsx` first button (draft the work) | Part of "writes on one pending" | Left as is | It calls the AI and writes nothing. It already shows a "working" label. Only the "Create" button (a DB write) got `pending` |
| D3 | `goals/[id]/coach-strip.tsx` "Suggest a fix" | Multi-button pattern | Only "Use this wording" (applyRewrite) got `pending`, through a new `applying` flag | "Suggest a fix" reads the assist and writes nothing |
| D4 | `goals/okr-table.tsx` `RowActions` stop confirm | `pending={stopping}` | Not done. Covered by the row spinner (plan 6.4) | `stopping` is the state "the reason dialog is open". It is not a save in flight. `stop.run` and `onDelete` call `okr.mutate`, which the row spinner already shows |
| D5 | `goals/filter-assist.tsx` | `pending={busy}` | Done | The server action only parses a sentence with the AI and the page then navigates. It is not a DB write. This is inconsistent with D2 |

Question Q1: D2 and D5 treat the same kind of call (an AI call that writes nothing) differently. Which rule should hold? Options: spinner on every server call, or only on DB writes. The owner's wording was "all buttons that access the database".

## 4. Design questions about what was built

| # | Question | Context |
|---|---|---|
| Q2 | `useSubmitPending` is called inside `SubmitButton` even in the non-bare branch, where the result is unused. Remove the call by splitting the component, or leave it? | Harmless today (the ref is never attached, so the effect returns at once). It is a small waste and could confuse a reader |
| Q3 | When `event.submitter === null` (Enter in a field of a form with no default submit button), every submit button in the form spins. Acceptable? | React gives no way to say which action ran in that case |
| Q4 | All other submit buttons of a form are disabled while it is sent, not only the one that spins. Is that the intended reading of "only the pressed one spins"? | It stops a second submit with a different intent. The owner chose "spinner only on the pressed one, others disabled" |
| Q5 | `Button` is now a client module. A server component that passes a function prop to it would fail. None does today (they could not before either). Is a guard needed, such as a lint rule? | 12 server files call `buttonVariants`, which moved to `button-variants.ts` for this reason |
| Q6 | The Goals rows show a spinner but the cells stay editable, because the list uses optimistic updates. Should cells lock while their row saves? | Locking changes the interaction model, so it was not done without a decision |
| Q7 | `usePendingOkrIds` returns a new `Set` on every render and every row subscribes through the parent only once. Is there a render cost to worry about on a 1000-row list? | Not measured. `pnpm perf:budgets` does not cover client render |
| Q8 | `useMutationState` is now re-exported from `packages/ui/src/query/query-provider.tsx`. `apps/web` has no direct `@tanstack/react-query` dependency, so the re-export was the only route without a new dependency. Correct call? | No new dependency was added |
| Q9 | The spinner is `aria-hidden` and the busy state is `aria-busy` on the button or the row's action cluster. Is that enough for a screen reader, or should a live region announce "Saving"? | Adding text would need new translation keys. The owner's rule is that all UI text is translated |

## 5. Batch 3a candidate table (waits for approval)

Rule from the plan: send the owner a table and wait for "ok" before editing. 28 files under `apps/web/app/admin/` excluding `general/`.

| Pattern | Files | Action |
|---|---|---|
| A. Covered by Change 1 (kit Button in a function-action form) | `ai/governance`, `ai/page`, `channels/page`, `channels/template-mapping-form` | None. Check in the browser |
| B. One write button, `disabled={pending}` from `useTransition` | `agents/agent-switch` (2 buttons), `deleted/restore-button`, `roles/member-roles`, `imports/archive-import-card`, `imports/export-card` | `disabled={pending}` becomes `pending={pending}` |
| C. Several buttons share one `pending` | `agents/agent-policy`, `agents/run-controls`, `agents/proposal-queue`, `nudges/rule-cards`, `roles/role-matrix`, `sso/connection-controls` (5 buttons), `imports/wizard` | Multi-button pattern with an `acting` state |
| D. Manual flag (`checking`, `exporting`, `pending`, `busy`) | `audit/audit-panel`, `directory/directory-form`, `sso/sso-form`, `branding/branding-image-card`, `branding/branding-settings-form` | `pending={flag}` on the matching button |
| E. `useActionState` form with its own `onSubmit` (invisible to `useFormStatus`) | `branding/branding-studio`, `practice/practice-form`, `rhythm/rhythm-form`, `plan/plan-form` | `pending={pending}` from `useActionState`. `practice-form` and `rhythm-form` also have a raw Reset button |
| F. Raw `<button>`, not the kit `Button` | `invitations/invite-form`, `invitations/revoke-button`, `support/grant-decision` (2), raw buttons in `practice-form:320` and `rhythm-form:509` | Raw-button pattern: `aria-busy` and `<Spinner />` before the label, classes unchanged |

Unverified points in this table:

| # | Question |
|---|---|
| Q10 | `ai/page.tsx` and `ai/governance.tsx` wrap forms in `AIForm`. It was not opened. If `AIForm` uses `onSubmit` and not a function action, those files move from A to E. Check `AIForm` first |
| Q11 | `audit/audit-panel.tsx` has an `onSubmit` form for "show". If it only reads the audit log, it is out of scope. Confirm by reading the handler |
| Q12 | The table lists buttons only. Inline controls that save on change (a `SelectInput` in `roles/role-matrix` and `nudges/rule-cards`, switches in `agents/agent-switch` and `roles/member-roles`) are in scope by the owner's decision (spinner beside the control, control disabled). The table does not list them. Add a column for them before editing |
| Q13 | Raw buttons (pattern F) do not get the auto spinner. Should Sonnet migrate them to the kit `Button` instead, which would give the auto behaviour but change their look? The plan says keep the look. The owner's memory note "redesign keeps every input" points the same way |

## 6. Process questions

| # | Question |
|---|---|
| Q14 | After 3a, should Sonnet continue through 3b to 3e with the same table-then-wait step, or stop after each batch for a fresh approval? The plan says table first, wait for ok, per batch |
| Q15 | Change 2 shipped without new unit tests, only the browser check and the existing gates. The owner's memory note says a small change needs `check:fast` and a browser check, no new unit tests and no e2e. Change 1 did add tests because the plan asked for them. Is that split right, or should Change 2 and 3 add a test per pattern? |
| Q16 | Several e2e specs may assert that a button is enabled right after a click. Only CI sees it. Should one targeted spec run locally for a form that changed (the repo allows `pnpm test:e2e e2e/<file>.spec.ts` for user-visible changes) before the push? |
| Q17 | Unverified in the browser: key result Save (`key-result-update.tsx`), the drawer check-in form, the cycle picker Create, the goal-writes move, link and unlink buttons, the add-row Save, the diagram add card, the dependency remove button. Each change is `pending={existingFlag}` and typecheck passes. Is that enough before the push, or does the owner want each shown? |

## 7. Blind spots and risks the author sees

| Risk | Detail |
|---|---|
| Spinner too brief to see on localhost | Dev needs network throttling. In production a fast server may flash the spinner for under 100 ms. No minimum display time was added |
| Disabled button loses focus | A pressed submit button becomes disabled, and browsers may move focus away from it. Not checked with a keyboard or a screen reader |
| Plan counts | The plan said 12 server files call `buttonVariants` and 60 `ActionForm` uses. Both were measured on commit `12cc5b7b`. Drift is possible since |
| CodeQL and Dependency review | No dependency was added, so Dependency review should stay green. CodeQL cannot run locally |
| Docs | `docs/design` and `UIUX-PLAN.md` §4 "Acting" were not updated. The repo rule says a deviation from a design updates the document in the same change. The spinner follows §4, so no deviation was assumed. Confirm |

## 8. What the owner needs back

Answers to Q1, Q10 to Q14 unblock batch 3a. The rest can be answered at any time and do not block it.

## 9. Review answers (Opus, 2026-11-05)

### 9.0 Blocking finding: the work contradicts UIUX-PLAN §4

UIUX-PLAN.md line 85, row "Acting": "The bar waits 200 milliseconds, so a fast answer shows nothing. [...] One indicator in the shell counts the requests; **screens add none of their own.**"

That indicator exists: `apps/web/lib/activity-indicator.tsx`, mounted in `apps/web/lib/app-shell.tsx:534`, with `ACTIVITY_DELAY_MS = 200`. A spinner per button is a second indicator, which §4 forbids. Commit `4e07b8e8` (4 Nov) already cited §4 for its spinner, so the spec and the code disagree since then, and Change 1 and 2 widen the gap. The section 7 row "no deviation was assumed" is wrong.

UIUX-PLAN is the authority over the code (root `CLAUDE.md`, authority order). Two ways out, and this one is the owner's call, not Sonnet's:

| Option | Effect |
|---|---|
| **A. Amend §4 (recommended)** | The owner asked on 2026-11-05 for an indicator on every control that writes. Rewrite the row: the shell bar stays the one global signal; the pressed control also shows a spinner and refuses a second press, after the same 200 ms wait. Ship the §4 edit in the Change 3a commit, or in a small docs commit before it |
| B. Keep §4 as written | Revert the spinner from `Button` and keep only the disabled state. Contradicts the owner's request |

Whichever is chosen, **the button spinner must wait 200 ms like the bar** (one rule in `useSubmitPending` and in the `pending` branch of `Button`: disable at once, show the spinner after 200 ms). That also answers the "spinner flashes" risk in section 7. Add a fake-timer test for it.

### 9.1 Answers

| # | Answer |
|---|---|
| Q1 | Rule: **any control whose press makes the person wait on the server shows a pending state**, whether or not the server writes to the database. The owner's "mengakses database" names the symptom (a press that seems to do nothing); an AI call waits longest of all. A visible "Working..." label already counts as the pending state. So D1 and D2 are fine as they are (both show "Working..."), D5 is fine. **D3 is a gap**: "Suggest a fix" waits on the AI with no indicator. Give it `pending={pending && !applying}` in 3e or as a follow-up in Goals |
| Q2 | Remove it. Split `SubmitButton` into a bare inner component that calls the hook and a non-bare path that returns `<Button type="submit">` directly. Hooks cannot be conditional, so a split is the only clean form. Small, do it with the 200 ms change |
| Q3 | Acceptable, and close to moot. Implicit submission (Enter) fires a click on the form's default button, so `submitter` is set whenever the form has a submit button. `null` comes only from `form.requestSubmit()` with no argument. Keep it, the comment already explains it |
| Q4 | Yes, that is the owner's decision ("spinner only on the pressed one, others disabled"). It stops a second submit with a different intent |
| Q5 | No guard needed. Checked: no server component in `apps/web/app` or `apps/web/lib` renders `<Button onClick>`. A function prop from a server component to a client one fails the build (`pnpm build`, which CI runs before e2e), so the gate already exists |
| Q6 | Do not lock. Optimistic editing is the list's design, and the owner did not ask to change it. The row spinner plus the shell bar are enough |
| Q7 | No concern. `LiveOkrTable` already re-renders on every mutation through `useIsMutating()`, so the extra `useMutationState` adds no render pass; one `Set` per render is negligible. Leave it |
| Q8 | Correct. The query hooks are already re-exported from `packages/ui` (`useIsMutating`, `useMutation`), so this follows the existing route and adds no dependency |
| Q9 | `aria-busy` is enough per control. Do not add a live region per button: §4 gives the "server has not answered" message to the shell, and a second announcement per press would double it. **But see the focus risk in 9.2**, which matters more for a screen reader than an announcement |
| Q10 | Checked. `AIForm` (`admin/ai/ai-form.tsx:34`) and `ChannelForm` (`admin/channels/channel-form.tsx:28`) both render `<form action={formAction}>` from `useActionState`. Pattern A is right: nothing to change |
| Q11 | `show` calls `browseAudit` (a read) and `check` calls `verifyChain`, `download` calls `exportAudit`. By the Q1 rule all three are in scope because the person waits on the server. `check` and `download` have flags (`checking`, `exporting`): pattern D. `show` goes through `load`: give its submit button `pending` from the same loading state if one exists, otherwise add one. Read the handler before editing |
| Q12 | Yes, add the column. Inline controls found in 3a: `roles/member-roles.tsx:69` (`onValueChange`), `roles/role-matrix.tsx:178`, `nudges/rule-cards.tsx:169, 297, 328`. Only those whose handler writes count (the in-scope rule in plan 6.1). `role-matrix.tsx:269` sets a name in local state: out of scope. `agents/agent-switch` is a `Button`, not a switch: pattern B |
| Q13 | Neither as planned. A raw `<button type="submit">` inside a function-action form (`invitations/invite-form`, `plan/plan-form`, `support/grant-decision`) should become `<SubmitButton bare className="...same classes...">`. That is exactly what `bare` is for: same look, auto behaviour. Check `plan-form` first: it has `onSubmit`, so it needs `pending` as well (pattern E). A raw `onClick` button (`invitations/revoke-button`, `practice-form:320`, `rhythm-form:509`) uses the raw-button pattern |
| Q14 | Recommendation for the owner: keep the table for every batch, but let Sonnet continue without waiting when the table holds only patterns A to F and no deviation. Stop and wait only for a new pattern, a deviation, or anything that touches text, classes or test ids. Owner decides |
| Q15 | The split is right. Change 2 and 3 are prop wiring and the owner's rule is `check:fast` plus a browser check for small changes. The exception is new logic: the 200 ms delay gets a unit test in `packages/ui`. `usePendingOkrIds` is thin enough to leave |
| Q16 | Not required by the repo rule (it asks for specs you wrote or touched, and none were). Low risk found: 13 specs use `toBeDisabled` / `toBeEnabled`; the ones near changed code are `s13h-mid-cycle.spec.ts:174` (still passes, `pending` also disables) and `s36d-nudge-rules.spec.ts:176, 192`, which waits for `save-ladder-*` to be enabled again and sits in batch 3a (`rule-cards.tsx`). Run `pnpm build && pnpm test:e2e e2e/s36d-nudge-rules.spec.ts` after 3a |
| Q17 | Enough for a push; CI runs the full e2e suite. Ask the owner to spot-check the two weekly flows: the drawer check-in and the key result value Save |

### 9.2 Additional risks the questions missed

| Risk | What to do |
|---|---|
| **Focus loss on disable.** When a focused button becomes `disabled`, Chromium moves focus to `<body>`. A keyboard or screen-reader user who presses Save loses their place. Change 1 made this new for every submit button in a function-action form (60 `ActionForm` uses) | Check with the keyboard in 3a: Tab to a Save, press Enter, read `document.activeElement` after the answer. If focus is lost, change `Button` in one place: while pending use `aria-disabled="true"` plus a click guard instead of `disabled`, so focus stays. That is a `packages/ui` change with its own test |
| Shell bar and button spinner together | After option A the two signals run at once. Fine by the amended §4, but say so in the §4 text so the next reader does not "fix" one away |
| `s36d-nudge-rules.spec.ts` | See Q16. It is the one spec most likely to notice batch 3a |
| UIUX-PLAN §9 quality gates | Interface changes must pass them (root `CLAUDE.md`, definition of done). Read §9 before the 3a commit and note any row that applies |

### 9.3 Order of work before batch 3a resumes

1. Owner chooses option A or B in 9.0.
2. If A: amend UIUX-PLAN §4, add the 200 ms delay and its test, split `SubmitButton` (Q2), check focus (9.2). One change, one commit.
3. Batch 3a with the corrected table: Q10 confirmed, Q11 and Q12 rows added, Q13 uses `SubmitButton bare`, D3 noted for 3e.

### 9.4 Opus approver verdict on batch 3a (2026-11-05): APPROVED WITH CHANGES

Applied by the implementer. Corrections to the section 5 table, each checked by the approver against the code at `de99bc9e`:

| File | Correction |
|---|---|
| `roles/member-roles.tsx:68-69` | Inline control. Per-member `savingId`; wrap picker and spinner in a `span flex items-center gap-1.5` |
| `nudges/rule-cards.tsx` | Drop `:169` (local state only). `Rule` has four controls on one `pending` with keys `toggle`, `channel`, `quiet`, `ladder`; `LadderEditor` gets a `saving` prop. `:389` quiet mode is B |
| `roles/role-matrix.tsx` | Cell `SelectInput` is inline, key `${role.id}:${domain}`. Delete and create are C with keys `delete:${id}` and `create` |
| `sso/connection-controls.tsx` | Only the switch (`:139`) and confirm (`:193`) write. The other three only open or close |
| `imports/wizard.tsx` | B on each of Read, Preview, Import (different steps) |
| `audit/audit-log.tsx:275` | Missing: "Older" reads from the server. `pending={state.busy === "append"}` |
| `branding/*` | Multi-button: `acting` read from `submitter.value` in `studio.submit`, passed to the settings form |
| `practice/practice-form.tsx` | Pattern A, not E (`action={submit}`, `onSubmit` never prevents default). ResetCard (raw, label) left unchanged |
| `plan/plan-form.tsx` | Pattern R (raw button, no label, `preventDefault`): `aria-disabled`, `aria-busy`, `guardPress`, delayed spinner |
| `invitations/invite-form.tsx` | `SubmitButton bare` with the same classes plus an `aria-disabled:` twin |
| `invitations/revoke-button.tsx` | `start(async () => { await revokeLinkAction(linkId); })`, so the wait lasts |
| `support/grant-decision.tsx` | `SubmitButton bare`, same classes, `name`, `value` |

Rules added: a standalone `Spinner` waits 200 ms too (done inside `Spinner`, so every caller gets it). A kit `Button` whose label already changes uses `pending={pending}` in place of `disabled={pending}` (pattern G). Bare and raw buttons get an `aria-disabled:` twin of every `disabled:` class.

Q14 (cadence): the owner delegated approval to the Opus approver on 2026-11-05. Decision: the next batch may start without waiting on its table when every row uses a known pattern (A to G, R) and an Opus review has signed it off. Each batch still ends with the owner looking in the browser, and one commit after "ok". Stop and ask on: a new pattern, a handler or text change, a class or element change beyond the `aria-disabled:` twin and the spinner wrapper, a file that does not match its table, a failing gate nobody understands.

Specs to run after 3a: `e2e/s36d-nudge-rules.spec.ts` and `e2e/s36l-branding.spec.ts` (`pnpm build && pnpm test:e2e <files>`).

Follow-up list for 3e: the four Change 2 spinners are covered by the `Spinner` change; coach-strip "Suggest a fix"; raw `ResetCard` buttons (`practice-form:320`, `rhythm-form:509`) keep `disabled` and can lose focus.

### 9.5 Opus approver verdict on batch 3b (2026-11-05): APPROVED WITH CHANGES

`session/[id]/**` and `sessions/**`, 24 files, 44 controls. Ten files need no change (`page.tsx`, `advance-control`, `blocker-panel`, `commitments`, `coordinator-note`, `next-actions`, `confidence-dial`, `session-live`, `minutes/page`, `sessions/page`): their forms use a function action, so the kit button spins on its own and ignores `disabled={pending}` while sending.

Applied: pattern C (an `acting` key per button) in `confidence-round`, `forward`, `monthly-review`, `narratives`, `process-health`, `quarterly-review`, `root-cause` and team-retro `NoteRow`, with the local `run(work)` becoming `run(name, work)`; pattern B or G (`pending={pending}`) in `diagnostic`, `digest`, `management-retro`, `minutes-write-up`, `recognition`, `reset`, `room-pulse`, `scoring` and the team-retro add, cluster; pattern F (`SubmitButton bare`) for the two raw buttons in `sessions/schedule.tsx`. `root-cause`'s detail field uses the `TextInput` `trailing` slot for its spinner.

Decision on a shared helper for 3c to 3e: none. Repeat the `acting` state per file (one `useState`, one `setActing`); handlers differ too much, and a wrapper would mean rewriting call sites, against "same handlers". A consolidation is a separate refactor, offered after 3e.

Left as is and listed for the owner: separate forms on one screen do not refuse each other (Start and Skip in `session/[id]/page.tsx`, Resolve and Reassign in `blocker-panel`), because each form has its own status. Pre-existing and outside this change: hard-coded English strings such as "That did not save." in `diagnostic`, `digest`, `recognition`, `root-cause` and `process-health.tsx:257`, against the translation rule.

Specs to run: `s22b-digest-channel-post`, `s23-monthly-moves`, `s26-session-entry`, `reviews`.

### 9.6 Opus approver verdict on batch 3c (2026-11-05): APPROVED WITH CHANGES

12 files under board, cycle, documents, initiatives, kpis, spaces and tasks. The other 24 files of the batch need no change: kit buttons inside `ActionForm` or a function-action form already spin on their own (`check-in/*`, most of `cycle/*`, `inbox`, `review/*`, `kpis/trees`, `spaces` forms), `method="get"` search and switcher forms are navigation, and `kpis/grid` cells keep their typed value while they save (Q6, shell bar only).

Applied: the board's delete gets its own `useTransition` and a `deletingId` (the one approved handler change; moves stay optimistic and unchanged); `cycle/assists.tsx` was added to the batch (not on the first list); `kpis/kpi-panel` used `form={formId}` outside its form, which `useFormStatus` cannot see, so it passes `pending` from `useActionState`; `tasks/[id]/controls.tsx` `useRun` takes a name and returns `acting`; raw buttons in `document-editor`, `unlink-button` and `controls` follow pattern R.

Follow-ups, not changed: `search/export-button` and `review/nudge-provenance` raw buttons keep `disabled` and can lose focus (their labels already say "Preparing" and "Snoozing"); inline checkboxes, selects and date inputs still lose focus when disabled; hard-coded English in `cycle/assists.tsx` (lines about 158, 163, 401) and `spaces/[id]/space-membership.tsx:105`.

Specs to run: `s27-board`, `s29-documents`, `s34b-space-holidays`, `s09-drafting-assists`.
