# OpenOKR 0.9.0 acceptance test

## Run details

| Item | Value |
|---|---|
| Who ran it | **Claude, an AI agent, driving a browser through scripts. Not a person.** It judges whether things work as the plan and the designs say. It does not judge how clear or easy they feel to a new user, and it cannot replace the native Malay review or the screen reader check listed in plan section 7 |
| Commit tested | `7aa291db` (branch `agung`), built as Docker image `openokr:0.9.0-check`. The footer, the Practice page's method link and `package.json` still say `v0.8.1`, as they do until the release pull request applies the changesets (0.8.0 report, Q-2) |
| Run | 2026-11-18, about 03:25 to 04:35 UTC (10:25 to 11:35 WIB) |
| Method | Compose project `openokr-demo` on http://localhost:8080, a fresh Northwind year from `deploy/demo/reset.sh`. Second and third Compose projects (`openokr-uat-fresh` on 8090 for G1, `openokr-uat-up` on 8091 for U1) were created from a copy of `deploy/docker` outside the repository, so `deploy/docker/secrets` of the demo was never touched. Both were removed with their volumes |
| AI | OpenRouter, model `openai/gpt-6-luna`. The key was loaded from a file inside a script and typed into `/admin/ai`. It was never printed. It was removed again at the end (the credential row is soft deleted) and the provider turned off. **21 copilot questions** were sent (plus the key test). The usage table records **78 model calls** for them, because one question takes several rounds. That is above the "about 35 calls" budget if calls means model calls, and within it if it means questions |
| Mail | None sent. The instance has no mail server |
| Browser | Chromium 1440x900 and 390x844 through `playwright-core` 1.65.0 scripts, not the Playwright MCP. Screenshots are in `/private/tmp/claude-501/-Users-agungsm-Documents-dev-open-okr/327f8406-8fa1-4c73-8783-b0699e621c60/scratchpad/uat-0.9.0/` (file names below are in that folder) |
| People | Owner `demo-owner@northwind.example`, personas Priya, Nadia, Daniel, Sara. Roles were assigned for G8 (Nadia and Priya Member, Priya Viewer, Daniel Admin) and **all three were reset to no role**, which is what `demo:prepare` leaves |
| Left behind on the demo instance | Priya's objective title was changed and restored through Undo. Key result "Cut median time to first value" now shows 4.4 and the objective 19.10% progress, because of F-02. API tokens made for the test were revoked. One rating (with a shared note) stays in `ai_answer_ratings` and the copilot threads stay in History. The demo instance is disposable: `deploy/demo/reset.sh` rebuilds it |
| Known issues | The five in plan section 7.1 were not retested. Where one showed up it is referred to as "7.1" and not filed again |

Rounds:

| Round | Instance | Rows |
|---|---|---|
| A | Demo, AI on (OpenRouter), Priya, Sara, Owner | L1 to L4, L7b, CP5, CP10, CP11, CP12, A4, FB1, 3ffc8a7a |
| B | Demo, no AI calls | G8, G2, C2, D1, S1, G5, content width, admin console reads |
| C | Fresh Compose project on port 8090 | G1 |
| D | Compose project on port 8091, 0.8.1 image, then `openokr:0.9.0-check` | U1 |

## Findings

Ranked by severity. Ids are in the order found within each severity.

### F-01. The answer is drawn above the question, live and after a reload

- **Row:** CP12 (panel look), L3 (thread after a reload)
- **Severity:** should fix before release
- **Steps:** sign in as Priya at 390x844. Open the copilot and ask "Who owns the objective "New accounts reach value in their first week" and what is its health?". Wait for the answer. Also: open History and select threads one after another.
- **Expected:** the question sits above its answer in every thread, as it did for the first question of the run at 1440 (`cp-01-activation-answer.png`).
- **Actual:** on the phone the answer, its sources and the Copy row are above the question bubble straight after the answer arrives (`cp12-phone-answer.png`). Reopening threads from History does the same in some threads and not in others: one thread shows "Copilot, Searched your workspace... A change card proposing this rename..." and then the question and its edit card (`cp-09-undo-refused.png`, `cp-10-reloaded-thread-order.png`). The cause is in the data: the member message and the assistant message of every pair have the same `created_at` to the microsecond (for example `2026-11-18 03:34:58.090839+00` on both rows of one thread), so the order is a tie that the database breaks any way it likes. The check was `select thread_id, role, created_at from ai_messages order by created_at desc`.
- **Screenshots:** `cp12-phone-answer.png`, `cp-09-undo-refused.png`, `cp-10-reloaded-thread-order.png`

### F-02. Undo of a check-in proposal puts the key result back to its baseline, not to the value it had

- **Row:** L4 (check-in proposal and its Undo, design `copilot-live-data.md` section 4.1)
- **Severity:** should fix before release
- **Steps:** as Priya on the fresh Northwind year, key result "Cut median time to first value from 4.4 days to 3.5" shows 4.02 (its history ends 4.35, 4.29, 4.24, 4.18, 4.13, 4.07, 4.02). In the copilot ask: `Check in on my Q4 objective "New accounts reach value in their first week": status on track, overall confidence 0.7, narrative "Trial shortened to two days", and set the key result "Cut median time to first value from 4.4 days to 3.5" to 3.9 with confidence 0.6.` Press Apply, then Undo.
- **Expected:** Undo removes the check-in and the key result returns to 4.02, and the objective to 40.21%.
- **Actual:** Apply works (current value 3.9, check-ins 7 to 8). After Undo the check-in is gone (7) but the key result's `current_value` is **4.4000**, the baseline, with progress 0; the objective's progress went from 40.21 to 19.10. The history row for 3.9 is soft deleted and the 4.02 row is intact, so the rollback did not use the previous history row. No error was shown. The card says "Undone".
- **Screenshots:** `cp-12-checkin-applied.png`, `cp-13-checkin-undone.png`

### F-03. A check-in proposal is dropped when the person gives no confidence, and the answer sends them to do it by hand

- **Row:** L4 (check-in), related to the tuning item in 7.1
- **Severity:** can wait
- **Steps:** as Priya ask "Check in on my key result "Cut median time to first value from 4.4 days to 3.5" with the value 3.9 and the note "Trial shortened to two days"." Repeat as Sara with "Prepare a check-in card for the key result ...". Repeat as Priya naming the objective, a status and a narrative but no confidence.
- **Expected:** a card, or a question for the missing confidence (design section 4.3 says the card asks when a field is required).
- **Actual:** no card in all three. The answer says "I can't create this check-in from here yet. Make it under Check in". The app log has `{"kind":"copilot.proposal_dropped","reason":"fields_refused","action":"goals.publishDraftedCheckIn"}` for two of them. The same request with "overall confidence 0.7" and a key result confidence made a correct card. A check-in is also on the objective, so "check in on my key result" is not a request the proposer accepts, and the answer does not say so.
- **Screenshots:** `cp-11-checkin-proposal.png`

### F-04. A question in Malay is answered in Indonesian, with a raw code and joined chips

- **Row:** CP10 (reasons in English and Malay), L7b
- **Severity:** can wait
- **Steps:** set Priya's language to Bahasa Melayu in `/account`. In the copilot ask "Bagaimana keadaan hasil utama pengaktifan saya?".
- **Expected:** an answer in Malay, with the health worded as the catalogue words it.
- **Actual:** the answer is Indonesian ("saat ini", "tenggatnya 31 Desember 2026", "Kesehatan objektif") and carries the raw code `on_track`. The two citation chips are drawn side by side as "1214" with no gap. The panel's own text and the reasons are correct Malay (rows below). The answer language comes from the model, not from the catalogue.
- **Screenshots:** `cp10-ms-answer.png`

### F-05. A member with no role may change the input pack

- **Row:** G8
- **Severity:** can wait
- **Steps:** on the demo instance, Nadia has no role (`workspace_members.role_id` is null, as `pnpm demo:prepare` leaves it; Admin, Member and Viewer each read "Held by 0"). With a token of hers, call `GET /api/v1/workflow/read` and `POST /api/v1/workflow/setPackItem` for the active cycle.
- **Expected:** `packAccess.canChange` false and a 403, as for any Member who is not the facilitator.
- **Actual:** `canChange: true` and `200`. After `roles.assign` gives her the Member role the same calls give `false` and `403 "Only an Owner, an Admin or this cycle's facilitator can change the input pack."`. The design's table (section 3) has no row for "a member with no role". This only affects instances where members have no role, which is every persona on the public demo.

### F-06. The 0.8 to 0.9 upgrade notes name three migrations, and there are four

- **Row:** U1
- **Severity:** should fix before release
- **Steps:** read `docs/runbooks/upgrade.md`, section "0.8 to 0.9". Compare with `ls packages/db/migrations`.
- **Expected:** every migration since 0.8.1 is named, and every change a member sees is in "Smaller changes".
- **Actual:** the section says "Three migrations, 0168 to 0170". `0171_member_content_width.sql` adds `workspace_members.width`, and null reads as Compact (1152 px, centred). So every member of an upgraded instance sees a narrower column on a wide screen until they pick Full width, and the notes say nothing about it. The upgrade itself applied all four: after `./openokr upgrade` the `reverse_payload`, `ai_answer_ratings` and `width` objects exist and the data was intact.

### F-07. `./openokr upgrade` prints a `head` error on macOS and does not prune old backups

- **Row:** U1
- **Severity:** can wait
- **Steps:** on macOS run `./openokr upgrade`.
- **Expected:** no error.
- **Actual:** `head: illegal line count -- -3` after "backup complete". `deploy/docker/openokr:563` uses `head -n -3`, which only GNU `head` accepts, so the loop that keeps the three newest backups never deletes one. I did not check whether 0.8.1 has the same line.

### F-08. The reading step line does not name the record

- **Row:** L2 (reading status line)
- **Severity:** can wait
- **Steps:** as Priya ask about one objective by name and watch the panel (`a4-answer.png`).
- **Expected:** plan L2 says the line reads "Reading New accounts reach value in their first week" when one record is opened.
- **Actual:** the line reads "Reading an objective…" and then "Looking through objectives…". The record is never named in the three runs I watched. Design section 3 says the `subject` field is the title of a single-record read, so this may be a case where the model read by list first. I could not tell which.
- **Screenshots:** `a4-answer.png`, `cp12-phone-reading.png`

### F-09. The administrators' list of reads shows a refused proposal as "read propose_change"

- **Row:** L3
- **Severity:** can wait
- **Steps:** as Owner open `/admin/ai`, the list of what the copilot read.
- **Expected:** reads are listed as reads.
- **Actual:** rows such as "2026-11-18 03:40:51 Priya Raman, read propose_change" appear. `ai_tool_calls` holds the proposal tool with outcome `refused`, and the page words every row as "read". Reads with names (`goals.list`, `goals.read`, `passages`) are right.
- **Screenshots:** `admin-ai-full.png`

## Row results

| Row | Result | Notes |
|---|---|---|
| 3ffc8a7a Provider key waits until the provider is on | Passed | With OpenRouter off the hint "Tick "Use this provider" below and save first..." shows, the key field and Store are disabled. After Save the field enables, Store works and the test says "The provider answered. The key works." (`ai-01`, `ai-02`, `ai-03`) |
| L1 Port: tool turns on OpenRouter | Passed | Tool rounds ran on `openai/gpt-6-luna` through OpenRouter for 21 questions |
| L2 Read tools as the member | Passed | Activation key result: 64.91, target 68, Sara Nasser, due 2026-12-31, confidence 0.6. Objective health and last check-in (16 November, "Moving as planned this week. Nothing new in the way.") match the database. Task owner Leo Martins, status todo. KPI with no records: "has no recorded value". Initiative planned, owner Leo Martins |
| L2 A member who cannot view an object gets nothing | Not tested | No persona holds an object another cannot see on this Northwind year, and I did not build one |
| L2 Reading status line | Passed, with finding | "Searching", "Found 6 passages", "Reading an objective", "Looking through objectives", "Writing the answer", then the answer. F-08 |
| L3 Reads recorded and shown to administrators | Passed, with finding | `ai_tool_calls` has `source = copilot` rows. `/admin/ai` lists "Priya Raman, read goals.list" and the rest with times. After a reload "Searched your workspace, made 2 reads" is rebuilt. F-09 |
| L4 Rename proposal, Apply, Undo | Passed | Card shows before and after. Apply changed the title, Undo restored it, card states Applied then Undone |
| L4 Undo refused after the record changed | Passed | After a second rename, Undo on the first reads "This changed after it was applied, so undoing it would overwrite the later change." and the title stays. Both renames were then undone in reverse order and the title is the original |
| L4 Check-in proposal and Apply | Passed, with finding | Card with status, confidence, narrative and "4.02 -> 3.9, confidence 0.6". Apply adds the check-in as Priya. F-03 |
| L4 Undo of the check-in | Failed | F-02 |
| L7b Tool loop prompt on Luna | Partly tested | Ran the reading questions, the proposals and the page questions. No before and after comparison against L5's sets was made |
| CP5 Numbered chips and source list | Passed | Each `[n]` is a small numbered chip with its source listed below, numbered the same. The numbers are the run's reference numbers, so a single source can be "14" |
| CP5 Sources open the right record | Passed | Key result chip opens `/goals/<objective>#kr-<id>`, so a key result opens its objective. Objective, task, KPI and initiative chips open their own pages. The check-in chip opens the objective page |
| CP10 Reasons in English | Passed | AI off: "No AI provider is configured, so the copilot can find sources but cannot write an answer." and the passage notice |
| CP10 Reasons in Malay | Passed, with finding | AI off: "Tiada penyedia AI dikonfigurasi, jadi Copilot boleh mencari sumber tetapi tidak dapat menulis jawapan." Stopped: "Dihentikan" with "Cuba lagi". Panel controls in Malay. Language switched back to English. F-04. Provider error, no plan and capped reasons were not triggered (self-hosted, no way to force them without breaking the key) |
| CP11 Ask about this page | Passed | On an objective, a KPI, an initiative and a task the panel offers "Ask about this <kind>" and the suggestions "How is this going?" and "What is blocking this?". One question each was answered from that record |
| CP12 Panel look | Passed, with finding | Desktop and 390 px, no horizontal overflow. Empty state, reading, answer, card, AI off all drawn. F-01 for the order |
| A4 First word | Passed, with note | One question that asks for no change: the answer text arrived at 15.4 s, with "Writing the answer" at 13.5 s. This is the 7.1 item, not new. The answer arrives in one piece, with raw `**0.` visible for about 150 ms |
| FB1 Thumbs down, note, Share | Passed | Poor answer opens a note field and the Share checkbox with the sentence about what administrators see. One row with the note and `shared` true. After a reload Poor answer is pressed. A second press takes the rating back (soft delete) |
| FB1 Administrators see it | Passed | `/admin/ai`, "Ratings of copilot answers": Poor, time, Priya Raman, model, "Reads: 3", the note, "Shared conversation" |
| FB1 `pnpm copilot:feedback --workspace demo-operators-workspace` | Passed | One entry. The note reads "It should say [number] percent. [a colleague] owns it and [email] asked, with [number] as value." The question and answer have numbers replaced, the citation `[14]` stays |
| G1 Setup code, refused without it | Passed | Fresh instance: the wizard's second step has a Setup code field. Empty and wrong codes keep the form. The API sign-up without a code answers 422 `SETUP_CODE_REQUIRED` |
| G1 Accepted with it, then closed | Passed | The code from `secrets/app.env` created the owner and landed on `/welcome`. The setup form no longer asks for a code and the API sign-up answers "This instance is invitation-only." |
| G1 The code is never logged | Passed | 0 matches in the app, proxy and database logs, and in `system_settings`. `./openokr up` printed it on purpose |
| G8 Owner, Admin, facilitator Member | Passed | Owner and Admin (Daniel): `canChange` true, 200. Priya as Member and named facilitator: true, 200. Phase 1 shows the Owner's pack editable |
| G8 Member who is not the facilitator | Passed | Nadia as Member: false, 403 with the sentence above. The screen is read only, no toggles and no Confirm distribution, and reads "Only an Owner, an Admin or Priya Raman, this cycle's facilitator, can change the input pack." |
| G8 Viewer facilitator | Passed | Priya as Viewer: false, 403. The screen says "Only an Owner or an Admin can change the input pack." |
| G8 Member with no role | Passed, with finding | F-05 |
| G2 Command palette recents and scoped tabs | Passed | Tabs: Everything, Objectives, Key results, KPIs, Initiatives, Tasks, People. A fresh device lists RECENT from what Priya changed. After opening an objective, an initiative, a task and a KPI they are listed newest first. The Tasks tab narrows the list |
| G2 A recent she can no longer see drops out | Passed | The Owner deleted the task through REST (destructive token). It left Priya's recents. After restore it did not come back by itself, which is reasonable |
| C2 `okr mcp` URL checks | Passed | `http://example.invalid`: "Refusing to send the agent token to ... Use an https:// address, or http:// only for localhost." `https://example.invalid` and `http://localhost:8080` are tried (network error, 401). A 302 from a local server is refused with "answered with a redirect (302)", and the redirect target and the second hop received nothing |
| D1 Agents use the workspace time zone | Passed | The Coach and the Champion have timezone UTC, the workspace's zone. `pnpm db:change --status` says "Data changes: all 35 complete". The demo reset may have run the data changes, so this does not prove the seed alone leaves none |
| S1 Every admin and account page opens | Passed | 28 pages at 1440 and 390 for the Owner: no error page, no console error, one `main`, no horizontal overflow. `/admin/plan` answers "Not found", as it should on a self-hosted instance |
| S1 General: Not saved yet, Discard, Save, reload | Passed | Instance name, at 1440 and 390 |
| S1 Practice | Passed | Phase enforcement, at 1440 and 390 |
| S1 Rhythm | Passed | Check-in frequency, at 1440 and 390 |
| S1 Channels | Passed | Slack Workspace ID, at 1440 and 390. Connected, the Workspace id shows after a reload. Disconnected again |
| S1 Content width kept | Passed | Compact and Full width both survive a reload and carry to `/goals`. Density was left on Comfortable |
| G5 Source links on Practice | Passed | `rework.withgoogle.com/en/guides/set-goals-with-okrs` and `eleganthack.com/radical-focus`, both open in a new tab and answer 200 |
| U1 Upgrade from 0.8.1 | Passed, with findings | `ghcr.io/open-okr/open-okr:0.8.1` pulled. Owner, a cycle and an objective created. `./openokr upgrade` took a backup, ran the data changes and left the instance healthy on 0.9.0. The objective, three members and sign-in were intact and migrations 0168 to 0171 had applied. F-06, F-07 |
| Phone width | Passed | The copilot panel and 56 admin and account page loads have no horizontal overflow at 390 px |

Rows from the brief and not tested: the unreadable-object case of L2 (no such object), CP10's provider error, no-plan and capped reasons. Plan section 7 items that need a person or another browser (Malay speaker, Safari, Firefox, screen reader, the 1,000-row Goals page) were not part of this run. The 7.1 items were not retested.

## Questions

Things I am not sure are bugs.

- **Q-1.** Should a member with no role be treated as a Member by the input pack rule (F-05)? The demo and `demo:prepare` leave every persona that way.
- **Q-2.** Is the copilot meant to answer in the member's language? A Malay question got an Indonesian answer (F-04), and the plan lists Malay review for the strings only.
- **Q-3.** Should the check-in proposal accept "check in on my key result" and ask for a missing confidence, or is the objective-level wording the intended contract (F-03)?
- **Q-4.** Is the "AI calls under about 35" budget counted in questions or in model calls? This run used 21 questions and 78 model calls.
- **Q-5.** Plan section 7 asks for the acceptance test "as Obed ran for 0.8.0". This one was run by an AI agent, so it did not look for confusing wording, odd layouts at unusual sizes or what a first-time user would try. Is a second, human pass wanted?
