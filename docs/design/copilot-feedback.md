# Thumbs up and down on a copilot answer

Status: **approved by Agung on 13 November 2026** ("design approved"), with Q1 and Q2 as recommended. Plan 0.9.0 row FB1. Akmal decided FB-Q on 12 November 2026 (in 0.9.0, after L5, as the last copilot row) and approved the direction the same day (plan §10). A new table, so it is designed before code (CLAUDE.md).

## 1. Why

L5's evaluation set (`packages/agents/src/evaluation/sets.ts`) is written by hand from what we guess goes wrong. A member who reads a poor answer knows exactly what went wrong and has no way to say so. A rating, kept with the answer, gives the people who tune the copilot real failures to turn into fixtures. Review Q5 (`docs/report/copilot-panel-review-0.8.1.md`).

## 2. What is kept

New table `ai_answer_ratings`, one row per member per answer.

| Column | Type | Note |
|---|---|---|
| `id` | uuid | |
| `workspace_id` | uuid, not null | Row-level security policy in the same migration |
| `message_id` | uuid, not null, references `ai_messages` | The answer rated. Must be an `assistant` message in a thread of the rater |
| `member_id` | uuid, not null, references `workspace_members` | The rater, always the thread's owner |
| `rating` | text, `up` or `down` | |
| `note` | text, null, at most 500 characters | The member's own words. Plain text, not rich text |
| `shared` | boolean, default false | "Share this conversation": the question and the answer become visible to AI administrators on this rating |
| `model` | text, null | Copied from the answer at rating time, so the administrator view needs no join through a message that may be gone |
| `created_at`, `updated_at`, `deleted_at` | timestamps | Soft delete, the repository default |

Unique on `(workspace_id, message_id, member_id)` where `deleted_at` is null. No legacy source (TECHNICAL-PLAN §7.2). `DATABASE.md` and TECHNICAL-PLAN §4 gain the table.

## 3. Decisions

| # | Decision | Why |
|---|---|---|
| FB-D1 | **One rating per member per answer**, changeable: pressing the other thumb replaces it, pressing the same thumb again removes it | The direction |
| FB-D2 | **The note is optional**, at most 500 characters, asked for only after a thumbs-down, in a small form under the answer with "Share this conversation" unticked by default | The direction. A note on a thumbs-up is allowed but not asked for |
| FB-D3 | **The member sees their own rating** on the answer, after a reload too: `copilot.thread` returns `myRating: { rating, note, shared } \| null` per answer | The direction |
| FB-D4 | **AI administrators** (members whose role holds `manage_ai`) see, on Admin, AI: the rating, the note, the model, the time, the member's name, and what was read (rebuilt from `ai_tool_calls` the way L3 rebuilds the line, so nothing is copied). **The question and the answer text only when `shared` is true.** Other members see nothing | The direction. A rating is about the copilot; the conversation stays the member's unless they share it |
| FB-D5 | **A command for fixtures**: `pnpm copilot:feedback --workspace <slug>` lists the shared thumbs-down answers with names and numbers replaced (people's names by role words, numbers by placeholders, titles kept only as their kind), for a person to turn into fixtures by hand. It writes nothing and sends nothing. **Never automatic**, because fixtures are committed to a public repository | The direction |
| FB-D6 | **Kept 90 days**, by the same sweep and the same setting as the tool calls (`agentToolCallRetentionDays`, default 90, agent-tool-calls.md D11) | The direction: "like tool calls". One knob for the AI logs. See Q1 |
| FB-D7 | **Nothing leaves the instance.** No telemetry, no outbox row to anywhere outside, no mail | The direction |
| FB-D8 | **Hidden with AI off**: no thumbs on any answer and no ratings view while the copilot cannot answer. Existing ratings stay and reappear when it is on | The direction, and CLAUDE.md: every AI affordance hidden when the provider is off |
| FB-D9 | **English and Malay**: the controls, the note form, the shared line and the administrator view are catalogue strings | The direction |
| FB-D10 | **Writes through the Operation pipeline**: `copilot.rate` (`{ messageId, rating, note?, shared? }`) and `copilot.unrate` (`{ messageId }`), access `comment` on the member's own thread, the same level `copilot.ask` asks. Each writes the activity and audit rows like every write; the activity kind is not shown in any feed | One write path. The audit says who changed what was shared |
| FB-D11 | **A read for administrators**: `ai.answerRatings` (`{ rating?, cursor? }`), requires `manage_ai`, newest first, paged like the tool calls list | |
| FB-D12 | **Erasure and export**: `people.erase` deletes the member's ratings with their threads. The member's own export includes their ratings. `portability/policy.ts` gains the row: exported with the member's AI threads | The 0.8.0 rule: every new table has a portability decision |
| FB-D13 | **Agents and the agent surface** never rate and never read ratings (`agentSurface: false` on all three actions) | It is a person's judgement of an answer they read |

## 4. On screen (S-39)

| Where | What |
|---|---|
| Under a recorded answer, beside Copy and Retry | Two small icon buttons, "Good answer" and "Poor answer", each with a tooltip; the pressed one is filled. Not on an answer still arriving |
| After a thumbs-down | A one-line note field (500 characters, a counter near the limit), a "Share this conversation with your AI administrators" checkbox with one line saying what that shows them, and Send. Escape or Skip closes it; the rating stays |
| Admin, AI | A "Ratings" section: a filter (All, Poor, Good), rows with time, member, rating, note, model, reads count, and "Shared" with the question and answer folded under it |
| AI off | Neither |

## 5. Acceptance criteria

- Given Priya reads an answer, when she presses "Poor answer", writes a note and ticks Share, then one rating row exists with her note and `shared` true, and after a reload the button is still pressed.
- Given she presses "Poor answer" again, then the rating is removed.
- Given an AI administrator opens Admin, AI, then they see Priya's rating with the note, the model and the reads, and the question and answer because she shared them.
- Given Ben rated an answer without sharing, when the administrator opens the list, then Ben's question and answer text are not in the response at all, not only hidden on screen.
- Given a Member who is not an AI administrator, when they call `ai.answerRatings` through REST, then it is refused.
- Given a rating older than the retention window, when the sweep runs, then it is gone.
- Given the provider is off, then no rating control is drawn.
- Given `pnpm copilot:feedback`, then each shared thumbs-down is printed with names and numbers replaced, and nothing is written.

## 6. Where it is built

| Piece | File |
|---|---|
| Migration and policy | `packages/db/migrations/0170_ai_answer_ratings.sql`, `packages/db/src/schema/ai-threads.ts` |
| Actions | `packages/core/src/actions/copilot.ts` (`copilot.rate`, `copilot.unrate`, `myRating` on the thread), `packages/core/src/actions/ai-ratings.ts` (`ai.answerRatings`) |
| Sweep | The tool call sweep, which deletes ratings by the same window |
| Erasure, export, portability | `packages/core/src/people/erasure.ts`, `people/export.ts`, `portability/policy.ts` |
| Command | `scripts/copilot-feedback.ts`, `pnpm copilot:feedback`, listed in CLAUDE.md's commands |
| Screen | `apps/web/app/copilot/turn.tsx`, Admin, AI |
| Docs | AI-NATIVE-PLAN §2.4 and §9, UIUX-PLAN S-39, TECHNICAL-PLAN §4 and §7.2, `DATABASE.md`, `ai-evaluation.md` (how a rating becomes a fixture) |

## 7. Questions the direction did not settle

| # | Question | Recommended | Other option |
|---|---|---|---|
| Q1 | One retention setting for tool calls and ratings, or a setting of its own? | One: `agentToolCallRetentionDays` covers both. A rating without the reads it points at is half the evidence | A separate `copilotRatingRetentionDays`, default 90 |
| Q2 | When an answer is deleted with its conversation, does its rating go too? | Yes, soft deleted with it. An administrator then sees nothing for it, which is what the member asked for by deleting | Keep the rating and the note, without the text |

## 8. As built

| Point | What was built |
|---|---|
| Taking a rating back | `copilot.unrate` soft deletes the row and clears its note and share, so the soft deleted row holds only the fact of a rating until the sweep removes it. The same applies when `copilot.deleteThread` soft deletes a thread's ratings (Q2) |
| Switching thumbs | `copilot.rate` with the other value starts without the old note and share. The same value with no note or share sent keeps them, which is how the form's Send adds a note to a rating already saved |
| The sweep | `connections.sweepToolCalls` also deletes `ai_answer_ratings` older than the window, soft deleted rows included, and returns `ratingsDeleted` beside `deleted` |
| Paging | `ai.answerRatings` takes `{ rating?, cursor?, limit? }` where the cursor is `{ at, id }` of the last row, like the audit list. Rows have no member id |
| Reads count | Rebuilt from `ai_tool_calls` by member and time through the same window rule as `copilot.thread` |
| AI off | The panel draws the thumbs only while a provider is configured (the same test as Retry). The Admin, AI card is drawn only when a drafter resolves for the workspace |
| The command | `pnpm copilot:feedback` is `scripts/copilot-feedback.ts` over `packages/core/src/copilot/feedback-fixtures.ts`, which reads through the same page as `ai.answerRatings`. The asker, their manager and other members become role words; text in double quotes becomes `[title]` because the answer does not store the kind of thing a title names; emails and figures are replaced. `[n]` citation markers stay |
