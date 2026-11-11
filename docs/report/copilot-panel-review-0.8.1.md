# Copilot panel (S-39): UI and UX review for 0.8.1

Run on 12 November 2026 at Akmal's request, during the 0.8.1 build: "review all the UI/UX of the chatbot area to make it look like a modern/current chatbot as ChatGPT or Claude AI". The rows and decisions it led to are in `docs/plans/release-0.8.1.md` §2.3, where its rows are W3's.

Read-only review. Nothing was edited, committed or pushed. Method: the project's `ui-audit` skill (eight lenses, three verdict classes), plus a comparison with ChatGPT and Claude.ai as Akmal asked.

## Scope

| Item | Value |
|---|---|
| Target | `apps/web/app/copilot/copilot-panel.tsx` (845 lines), `actions.ts`, `apps/web/app/api/copilot/route.ts`, `api/copilot/live/route.ts` |
| Code read at | `release-0.8.1` **419cd468** (A3, A1 and A2 landed while this review ran; every line number below is at that commit) |
| Breakpoints | 1440 and 390 asked for |
| Themes, densities | Both asked for |
| States | Closed trigger, empty, with history, AI off, capped, thinking, streaming, background run, rejoin, stopped, halted, error, proposal pending, applied, dismissed, undone |
| Data | Northwind (`openokr_dev` on 55532), Priya |

### What could and could not be seen running

| Tried | Result |
|---|---|
| Own worktree at `release-0.8.1`, `pnpm install`, `next dev -p 3610` with `DATABASE_URL`, `BETTER_AUTH_URL`, relay and scheduler off | Started in under a minute |
| Sign in as Priya | Worked |
| Any page inside the workspace | **Failed.** "Something went wrong. We could not load your workspace." on every page. The workspace's AI key was sealed by a root key this run did not hold, and the reviewer did not go looking for it |
| `/dev/components` | Worked, used to calibrate the control ladder |

So the panel itself was **not** rendered. Every panel finding below is traced from code and cites `file:line`. The failure itself is a real finding (F14). Two screenshots were taken locally and are not kept here: the whole shell failing on the copilot's availability read (F14), and `/dev/components` used to calibrate the control ladder.

Measured on `/dev/components` with `getComputedStyle`: default button 30px tall, 13px text, 0 12px padding, radius 8px; small button 25px, 12px text; `Kbd` 10.5px text. Body text is 13px (the known type-scale conflict, not reported again).

---

## 1. What the panel is today

### Layout

| Part | As built | Evidence |
|---|---|---|
| Trigger | A pill in the topbar: the copilot's face, "Ask" from 640px up, a `⌘J` key hint from 768px up. Named "Ask the copilot", `aria-keyshortcuts` set | `copilot-panel.tsx:345-380` |
| Panel | Portalled to `body`, `fixed inset-y-0 right-0 z-40`, `w-full max-w-100`, `bg-bg`, left border, `shadow-lg`. 400px wide comfortable, **320px compact** from 768px up (compact sets `--spacing: 0.2rem` and `max-w-100` is built from it, `tokens.css:198-201`). Full width below 400px | `:674-678` |
| Header | Face (mood: sleeping with AI off, thinking while busy, sad after a notice, idle), "Copilot" h2, "AI off" chip, close button. No new chat, no history, no expand | `:680-700` |
| Body | One scrolling column, `px-4 py-3`, turns 12px apart | `:702` |
| Member turn | Right-aligned bubble, `bg-raised`, `max-w-[46ch]`, 13px, `whitespace-pre-wrap` | `:143-151` |
| Assistant turn | Left bubble, `bg-surface`, same 46ch cap (about 300px), plain text with line breaks kept, "Sources" list of underlined links under it | `:143-175` |
| Answer while it arrives | A separate full-width `bg-surface` box: "Reading your workspace" with a looping face, then the raw text | `:763-776` |
| Proposals | All of the thread's cards in one block after the last message, newest first, then the arriving answer | `:734-762`, `copilot-proposals.ts` orders `desc(createdAt)` |
| Notice | A grey box at the end of the thread | `:783-787` |
| Passages | "Passages that match" list at the end of the thread while a turn is in flight | `:788-793` |
| Composer | `TextArea` (2 rows, grows with `field-sizing: content`, no maximum), placeholder "Ask a question" or, with AI off, "Search your workspace for matching passages", and a separate icon Send button, swapped for a ghost "Stop" while busy | `:803-845` |
| Footer reason | When the copilot cannot answer: the availability sentence above the box | `:796-802` |

### Behaviour

| Behaviour | As built | Evidence |
|---|---|---|
| Open and close | ⌘J or Ctrl+J toggles, works in fields. Opening focuses the box and re-reads availability and the thread list | `:408-441` |
| Send | Enter sends, Shift+Enter is a new line. The question shows at once; the box empties and is **disabled** until the turn ends | `:537-546`, `:810-817` |
| Stream | POST `/api/copilot`, Server-Sent Events read by hand: `thread`, `sources`, `proposal` (new in A2), `unavailable`, `text`, `done` | `:563-627` |
| After a turn | `setStreaming(null)`, then the thread and its proposals are re-read; the re-read clears `sources` and `notice` | `:635-645`, `:443-454` |
| Default deployment (`OPENOKR_RELAY` on) | Background run. The job answers **whole** (`answerGrounded`), publishes one `copilot.text`, so there is no word-by-word stream. Stop only unsubscribes | `background.ts:186-215`, `route.ts:267-273`, `copilot-background-runs.md` "No streaming from the provider", "No stop control on a background run" |
| Rejoin after reload | The thread read marks the message `running`; an `EventSource` on `/api/copilot/live` appends text and re-reads on `done`. It does not listen for `sources` or `proposal`, and the live route does not forward `copilot.proposal` | `:469-497`, `live/route.ts:95-115` |
| Proposal decisions | Apply (primary), Dismiss (ghost), Undo after apply when reversible; errors go to the notice at the end of the thread | `:238-336`, `:505-531` |
| Threads | Up to 20 titles, shown only while the panel is empty | `:703-727` |

---

## 2. Gaps against a modern chat interface

Severity: **blocker** (people will notice it on the first day or lose something), **important** (it looks or behaves dated, or fails a written rule), **polish**. Class is the `ui-audit` verdict: `VIOLATION` breaks a written rule, `RISK` is silent in the specification but probably wrong, `QUESTION` needs Akmal.

### 2.1 Defects found on the way (fix these whatever the redesign looks like)

| # | Class, severity | What happens | Evidence | What breaks for a person |
|---|---|---|---|---|
| F1 | VIOLATION, **blocker** | With AI off, the passages and the reason appear, then vanish when the turn lands. The re-read clears `sources` and `notice`, and with no provider nothing is recorded but the question | `:643` calls `loadThread`, which runs `setSources([])` and `setNotice(null)` at `:452-453`. The panel's own comment says the list "is the answer" with AI off (`:788-789`). AI-NATIVE-PLAN §2.4 "Degrades to full-text search" | A self-hosted instance with no key gets a box that swallows questions. The spec `e2e/s39-copilot.spec.ts:124-141` passes on the footer's sentence, so it never noticed |
| F2 | RISK, **blocker** | No way to start a new conversation, or to get back to the list, once a thread is open. The list renders only while the thread is empty, and nothing sets `threadId` back to null | `:703-727`; no `setThreadId(null)` in the file | A new topic is asked inside the old one, and the model is sent the last 8 turns of an unrelated conversation (`answer.ts` `HISTORY_TURNS = 8`): worse answers, higher cost. Only a reload escapes |
| F3 | RISK, **blocker** | No scroll handling at all: no `scrollTo`, no `scrollIntoView`. An opened thread starts at its top; a growing answer grows below the fold | Absent from the file | The person asks, sees nothing change, and has to scroll to find the answer |
| F4 | VIOLATION, important | Escape does nothing; close does not give focus back to the trigger; after every send focus falls to `body`, because the box is disabled (`:810`) and the Send button is swapped for Stop (`:827`); no live region announces the answer, a notice or a stop | No `Escape`, `aria-live`, `role="status"` or `role="alert"` in the file. UIUX-PLAN §7 "focus trapped in overlays and returned on close", "Live regions for toasts, realtime list and feed changes". The OKR drawer already does it right with Base UI `Dialog`, `modal={false}`, Escape (`goals/okr-drawer.tsx:204-222`) | A keyboard user must Tab from the top of the page back into the panel after every question; a screen-reader user is never told the answer arrived |
| F5 | VIOLATION, important | In the default deployment Stop does not stop. It aborts the request, the server only unsubscribes, the panel re-reads, sees `running` and subscribes again, and the answer arrives anyway. The "Stopped" chip never shows. And there is no word-by-word stream there at all | `route.ts:267-273`, `:469-497`, `background.ts:186-215`; S-39 "streaming and a stop control" | The button lies. This is the server work you are planning; the panel needs a stop that really stops |
| F6 | VIOLATION, important | Proposals are not inline. Every card of the thread sits in one block after the last message, newest first, and during a new question the old cards sit between the new question and its answer | `:734-776`; `copilot.proposals` returns no `createdAt` and no message link. S-39 "inline action proposals" | In a thread with two requests the cards no longer sit beside the words that made them |
| F7 | RISK, important | The answer jumps and blinks when it lands: the arriving text is a full-width box (`:764`), the recorded one a 46ch inline bubble (`:147`), and between `setStreaming(null)` (`:638`) and the re-read (`:643`) the answer is not on screen at all | Code trace | A visible flash and reflow at the end of every answer |
| F13 | RISK, important | A failed send loses the question: the box is emptied (`:542`) before the request, and "Your question was not saved" (`:574`) offers nothing back. No Retry anywhere | Code trace | Whoever typed a long question types it again |
| F14 | RISK, **blocker** for the instance | Any exception in the copilot's availability read takes down every page: `app-shell.tsx:312` awaits `copilotAvailabilityAction()` unguarded. Seen live: an AI key sealed by an unknown root key gave "We could not load your workspace" on every page | dev log `KeyRingError … at copilotAvailabilityAction (app/copilot/actions.ts:56)` | A key-rotation mistake, or any provider-routing bug, makes the whole product unusable rather than the copilot unavailable. UIUX-PLAN §4 "AI degradation … no errors" |
| F15 | VIOLATION, important | Sentences the reader sees are built in English on the server and shown as they arrive: "The copilot could not answer. Your question was saved." (`route.ts:162`), "The copilot had nothing to add…" (`answer.ts`), every AI-off reason (`off-reason.ts:46-72`), the background halt sentences (`background.ts:166-170`) | UIUX-PLAN §8 "Message catalogues … No concatenated strings" | A Malay reader gets the panel in Malay and every reason in English |
| F21 | RISK, polish | A rejoined run draws two boxes for one answer: the recorded message's empty bubble with "Still writing", and the arriving text after the cards | `:153-156`, `:763-776` | Looks like two answers |

### 2.2 Against ChatGPT and Claude.ai

| Area | What people expect | What the panel does | Evidence | Class, severity |
|---|---|---|---|---|
| Width and layout | A reading column of about 48rem (768px). In-product assistants (Notion, Linear, GitHub) use a 420 to 520px side panel with an expand or full-screen control | 400px, and **320px in compact** from 768px up; bubbles capped at about 300px; no expand | `:678`, `:147`, `tokens.css:198-201` | F16 RISK, important. Full page is F24 QUESTION |
| Member message | A right-aligned bubble with a soft fill, up to about 80% of the column | Right bubble, `bg-raised`, 46ch | `:143-151` | Fine, polish only |
| Assistant message | No bubble: full-width prose under a small avatar, generous line height | A `bg-surface` bubble capped at 46ch, 13px | `:147` | F7, important |
| Formatted answers | Bold, italics, lists, inline code and code blocks rendered; links clickable | Plain text, `whitespace-pre-wrap`. The answer prompt does not forbid Markdown (`drafter.ts` `COPILOT_SYSTEM`), and the models in use (Luna, Sonnet) write `**` and `- ` lists, so asterisks show | `:147`, `:764`; nothing in the repo parses Markdown (`rich-text/from-text.ts` treats an asterisk as an asterisk on purpose) | F8 RISK, important. Not seen live |
| Citations | Numbered chips in the prose; a numbered source list; hover shows the source | The prose carries raw `[2]` (the prompt asks for it, `drafter.ts:142`), the list is unnumbered and in another order, and a citation dropped at read time leaves its number in the prose | `:107-138`; `citations.ts` "dropped, not marked" | F9 RISK, important. A dangling `[3]` also tells the reader a source existed that they may not see |
| Source links | Every source opens | Only goals and KPIs link; key results, check-ins, sessions, documents and the rest are plain text | `hrefFor`, `:92-101` | F10 RISK, important |
| Streaming text | Text appears as it arrives with a caret or dot at the end; no reflow when it finishes | Raw text, no caret. In the default deployment the whole answer appears at once after "Reading your workspace" | `:763-776`, F5 | F5, F7 |
| What it is doing now | One live line ("Searching…", "Reading …"), folding into "Read 3 items" once the answer starts | One fixed phrase, "Reading your workspace", for retrieval, the A2 proposal call and the wait for the first word | `:770` | F27 RISK, important (your server work feeds it) |
| Composer | One rounded box holding the text and the send button; grows to a limit then scrolls; Enter sends, Shift+Enter new line; IME-safe; you can type the next question while an answer arrives; Send turns into Stop in place | Box and button side by side; no height limit; IME composition Enter sends (`:813` has no `isComposing` check); box disabled while busy | `:803-845`, `text-area.tsx:20` | F17 RISK, important |
| Disabled states | Send dims when empty; Stop only while something can be stopped | Send disabled when empty, good. Stop shown when it cannot stop (F5) | `:827-845` | F5 |
| Scroll | Stick to the bottom while streaming unless the person scrolled up; a "Jump to latest" arrow; open a thread at its end | None | F3 | F3 |
| Empty state | A greeting and three or four suggested prompts that work | One sentence and, below it, underlined titles | `:703-727` | F18 RISK, important |
| Conversation list | New chat, history with dates, rename, delete | Titles only, 20 at most, `updatedAt` returned and unused, no new chat, no delete action exists | `:707-726`, `copilot.ts:762-830` | F2 blocker, F19 polish |
| Copy and retry | Copy on every answer; Retry or Regenerate on the last | Neither. `CopyButton` already exists in `packages/ui` | `packages/ui/src/components/copy-button.tsx` | F20 RISK, polish (copy), important (retry, with F13) |
| Proposal cards | A tool result in the flow of the conversation, with a link to what was made | One block after the thread (F6); after Apply, no link to the new objective or task | `:238-336` | F6; F28 RISK, polish |
| Errors | An error under the turn it belongs to, with Retry; the question kept | A grey box at the end of the thread; card errors also land there | `:783-787`, `:517-521` | F13, F22 polish |
| AI off | A clear state, and the way to fix it for whoever can | The reason in prose. No link for admins, and "No AI provider is configured" names no place at all | `:796-802`, `off-reason.ts:56` | F11 VIOLATION of S-39 "AI off with a link for admins", important |
| Entity scope | "Ask about this page" | Never sent; the route and `copilot.ask` accept `subjectType` and `subjectId`, but retrieval ignores them | `route.ts:51-53`, `answer.ts:137-138` | F12 VIOLATION of S-39 "workspace-scoped or entity-scoped", important |
| Keyboard | Esc closes, focus stays in the composer, a shortcut for a new chat | ⌘J only (registered in the `?` overlay) | F4 | F4 |
| Screen reader | The conversation is a `log`; the finished answer and errors announced once, not every token | Nothing announced | F4 | F4 |
| Mobile 390 | A full-screen sheet; composer above the keyboard; safe-area padding; 16px input | Full width, good. 16px input on focus is already global (`tokens.css:501-508`). No safe-area padding, no keyboard-aware height; toasts and the activity bar (`z-50`, bottom) sit over the composer | `:678`, `toast.tsx:198`, `activity-indicator.tsx:86` | F26 RISK, important, not seen on a device |
| Dark mode | Both themes | Every colour is a token (`bg-raised`, `bg-surface`, `text-ink-*`, `border-line`), so nothing obvious; not seen | Code | Unverified |
| Motion | A short fade on a new turn; a caret; nothing under reduced motion | No entrance motion; the face loops only while working; the global reduced-motion rule stops everything (`tokens.css:273-284`) | `agent-face.css:87` | Fine. Any new caret or shimmer inherits the rule |
| Busy coupling | Cards stay usable while an answer arrives | One `busy` flag for both, so Apply is disabled during an answer and the box during a decision | `:401`, `:298-320` | F23 RISK, polish |
| Catalogue | Clean strings | `askAboutThisWorkspace` carries a newline and 18 spaces in `en.json:1884` | | F25 RISK, polish |

### 2.3 Counts

| Class | Count | IDs |
|---|---|---|
| VIOLATION | 7 | F1, F4, F5, F6, F11, F12, F15 |
| RISK | 20 | F2, F3, F7, F8, F9, F10, F13, F14, F16, F17, F18, F19, F20, F21, F22, F23, F25, F26, F27, F28 |
| QUESTION | 9 | Q1 to Q9, section 3.3 |

The three with the highest user impact: **F1** (AI off swallows the answer), **F2 with F3** (no new chat and no scrolling, so a conversation gets stuck and answers appear out of sight), **F14** (a copilot failure takes down every page).

---

## 3. Proposed plan rows

None needs a migration or a new runtime dependency if Q2 and Q3 go as recommended. Base UI (`Dialog`, `Collapsible`, `Tooltip`, `Menu`), lucide and `CopyButton` are already in the repo; `motion` is a dependency of `packages/ui` but nothing imports it, and CSS is enough for everything below.

Every row touches `e2e/s39-copilot.spec.ts` (it asserts "Earlier conversations", the "Search your workspace" placeholder and "Send the question"), and some touch `s39b-copilot-proposals.spec.ts`, `s39c-copilot-background.spec.ts` and `ai-off.spec.ts`. Catalogue rows go to `packages/ui/src/i18n/messages/en.json` and `ms.json`.

### 3.1 The rows

| Row | What | Files | Size | Fixes |
|---|---|---|---|---|
| **CP1** | **Frame and keyboard.** The panel becomes a Base UI `Dialog` with `modal={false}`, the OKR drawer's pattern: Escape closes (except while composing), focus returns to the trigger, `role="dialog"` named "Copilot". Width `max-w-lg` (512px, on the container scale so compact does not shrink it) with an **Expand** button to `max-w-3xl` (768px), remembered in the browser (wrapped in try/catch). Below 768px a full-screen sheet with safe-area padding on header and composer. The conversation is `role="log"`; one polite status line announces "Answering", "Answer ready", "Stopped" and errors | `copilot-panel.tsx` (split: `panel-frame.tsx`), catalogues, `s39-copilot.spec.ts` | Under a day | F4, F16, F26 (part) |
| **CP2** | **Conversations.** Header gets **New chat** (icon plus label from 640px) and **History**. History is a view inside the panel: titles with relative dates from `updatedAt` (Today, Yesterday, This week, Earlier), the open one marked. The open thread lives in the address as `?copilot=<threadId>` (S-01's drawer does the same with `?okr=`), so reload and Back restore it. Delete needs a new `copilot.deleteThread` action (soft delete on the existing `deleted_at`, audited): **Q4** | panel, new `thread-list.tsx`, `copilot.ts` (only if Q4 says yes), `contract/*` regenerated | Under a day without delete; half a day more with it | F2, F19 |
| **CP3** | **Turns, order and scroll.** One `AssistantTurn` for arriving and recorded answers: no bubble, full width up to 68ch, the face at 20px above it, so nothing reflows on landing, and the arriving text stays until the recorded message replaces it. Member turn: right bubble, up to 80%. Proposals interleaved by time and placed inside the turn that made them (needs `createdAt` on `copilot.proposals` output, contract regenerated, no migration). Stick to the bottom while text arrives unless the person scrolled up more than 80px; a "Jump to latest" button (arrow icon, named) when not at the bottom; an opened thread starts at its end. A rejoined run draws one turn | panel, new `turn.tsx`, `use-stick-to-bottom.ts`, `copilot-proposals.ts`, `contract/*`, `live/route.ts` (forward `copilot.proposal`) | About a day | F3, F6, F7, F21 |
| **CP4** | **Formatted answers.** A small safe renderer for the subset models write: paragraphs, line breaks, bold, italics, inline code, bullet and numbered lists, fenced code blocks with a Copy button. It returns React elements only, never an HTML string; a URL in the text stays text (a passage can carry an injected link, and the model may invent one). Unclosed markers mid-stream show as typed until closed. The answer prompt names the subset (fold into L7, which is tuning that prompt now). **Q2** | `packages/ui/src/components/answer-text.tsx` and its test, `packages/agents/src/drafter.ts` (one sentence), `turn.tsx` | About a day | F8 |
| **CP5** | **Citations.** `[n]` in the prose becomes a small numbered chip linking to its source, with the title on hover and focus (`Tooltip`). The source list under the answer is numbered the same way, each with the entity icon. A marker whose citation the reader may not see is removed, not shown. `copilot.thread` returns an `href` for each citation (key result to its objective `?okr=…&kr=…`, check-in to its objective's history, session, document, initiative, task) so the panel stops guessing. Needs the passage number stored with each citation: **Q3** | `turn.tsx`, `packages/core/src/copilot/citations.ts`, `answer.ts`, `background.ts`, `copilot.ts` output, `contract/*` | About a day | F9, F10. The same chips serve copilot-live-data §3.3 and §3.7 in 0.9.0 |
| **CP6** | **Composer.** One rounded box (`TextArea` from `packages/ui` with a bare skin, so the field rule holds) holding the text and the button: 1 row at rest, grows to 40% of the panel, then scrolls. Enter sends unless composing (`isComposing`), Shift+Enter is a new line. Typing is allowed while an answer arrives; sending is not. The send button becomes Stop in the same place, and Stop is offered only when it can stop. A failed send puts the question back in the box | `composer.tsx`, maybe a `variant` on `packages/ui` `TextArea`, panel | Half a day | F13 (part), F17 |
| **CP7** | **Answer actions and errors.** Under each finished answer: Copy (`CopyButton`), and on the last answer, Retry when it failed, stopped or halted (asks the same question again as a new turn, disabled when capped). Errors show under the turn they belong to with `role="alert"`; a card's error shows on the card. After Apply, the card links to what it made. Asking and deciding get separate busy flags | `turn.tsx`, `copilot-panel.tsx`, `copilot-proposals.ts` (return the made entity's `href`), `contract/*` | Half a day | F13, F20, F22, F23, F28 |
| **CP8** | **Empty, AI off and capped.** Empty state: the face, one sentence, four suggested prompts as buttons that fill and send (catalogue strings; until L2 they must be things the copilot answers well today, see Q9). AI off: keep the passages and the reason on screen after the turn lands, as the answer; add the link S-39 asks for: **Open AI settings** (`/admin/ai`) for whoever holds `manage_ai`, **Choose a plan** (`/admin/plan`) for the plan reason, **Your AI keys** (`/account/ai`) where personal keys are allowed. Capped: the reason and when it resets. Guard `app-shell.tsx:312` so a failed availability read renders the copilot as unavailable and the rest of the page normally | panel, `app-shell.tsx`, `actions.ts`, catalogues, `ai-off.spec.ts` | Under a day | F1, F11, F14, F18 |
| **CP9** | **Streaming look and the live step line** (the screen half of your server work). Spec in 3.2. A caret at the end of arriving text; one step line while working; the steps fold into a disclosure once words arrive. Labels come from the catalogue by key, with titles as parameters, so they translate | `turn.tsx`, new `step-line.tsx`, catalogues, `s39c-copilot-background.spec.ts` | About a day once the events exist | F5 (screen half), F27 |
| CP10 | Reason codes instead of English sentences: the server sends `{ code, params }` for every unavailable, halted and error reason, the panel translates | `off-reason.ts`, `answer.ts`, `background.ts`, `route.ts`, panel, catalogues | About a day, server-led | F15. **Q8** |
| CP11 | Entity scope: on an objective, key result, KPI or initiative page the composer offers an "About this objective" chip; the question is sent with `subjectType` and `subjectId`, and retrieval puts that entity first | panel, `answer.ts` | More than a day (retrieval) | F12. **Q9** |

### 3.2 How streaming and the live step should look (CP9)

One assistant turn, top to bottom:

| Part | While working | When finished |
|---|---|---|
| Face and name | The copilot's face, 20px, mood `thinking` and `live`; "Copilot" in 12px `ink-3` | Face `idle`, not looping |
| Step line | One line, 13px `ink-3`, replaced in place, never stacked: "Searching your workspace…", "Checking whether this is a change I can make…" (the A2 proposal call), "Reading *New accounts reach value in their first week*…", "Writing the answer…". Each shown at least 400ms so it does not flicker. A slow shimmer across the text with motion allowed; static under reduced motion | Folds into one quiet line, "Read 3 items", a `Collapsible` listing each step with a check, closed by default |
| Card | A proposal card arrives first (A2 order), so it sits first in the turn; nothing moves when the words arrive | Same place; after Apply, a link to what was made |
| Prose | Rendered by CP4 as it arrives, with a 2px caret in `ink-3` after the last character, blinking at 1s (UIUX-PLAN §2 allows "the caret in an actively edited field" as live motion); static under reduced motion. No per-word fade | Same text, caret gone, no reflow |
| Sources | Hidden until the answer is done | Numbered chips (CP5) |
| Actions | Stop in the composer | Copy; Retry on the last answer when useful |
| Announced | "Answering" once, then the step at most every 2 seconds (`role="status"`, polite). The arriving text sits outside any live region (`aria-busy` on the turn), so a screen reader is not read every token | "Answer ready", or "Stopped", once |

The panel needs these events from the server, in the shape the panel already reads (`kind` plus data), and both the POST and the live route must forward them:

| Event | Fields | Shown as |
|---|---|---|
| `step` | `id`, `key` (catalogue key, for example `copilot.step.reading`), `params` (for example `{ title }`), `state` (`running`, `done`, `failed`) | The step line and, later, the disclosure |
| `text` | `text` | Prose, word by word, in **both** deployments |
| `stopped` | none | "Stopped" chip; the composer is free at once |

**Stop has to stop a background run.** Today it cannot (F5). That needs a server path, for example a `copilot.stopRun` action the panel calls before it aborts the request; that is yours to design.

### 3.3 Decisions for Akmal

| # | Question | Recommended | The alternative, and its cost |
|---|---|---|---|
| Q1 | Side panel, or a full page like ChatGPT? | **Keep S-39's side panel, add Expand to 768px (CP1)**; a `/copilot` page with the history in a sidebar later, if people ask | A full page now: a new screen and route, S-39 rewritten, the ⌘J panel kept beside it. More like ChatGPT, about two more days |
| Q2 | How are formatted answers rendered? | **An in-house renderer for the subset only, React elements, no HTML, no links from model text, in `packages/ui` (CP4)**. Nothing in the repo does this: core's rich text is editor JSON and `richTextFromPlainText` deliberately reads no Markdown; `renderRichTextToHtml` cannot run in the browser because `@openokr/core` exports only its server index. The subset is about 200 lines plus tests | (a) A library such as `react-markdown` with `remark-gfm`: a new runtime dependency, CodeQL and dependency review, more than we need. (b) Tell the model to write plain text only: no work, but lists and steps read worse. Also confirm the CLAUDE.md rich-text rule ("render through the one shared `packages/core` module") does not apply to a model's answer, which is a text column and never stored as rich text |
| Q3 | How does `[n]` find its source after the answer is recorded? | **Store the passage number with each citation** (`{ entityType, entityId, n }` in the existing `ai_messages.citations` jsonb, no migration). Changes the stored shape for new answers; old answers fall back to the unnumbered list | (a) Renumber the prose when it is recorded: changes stored content. (b) Strip the markers and keep only the list: no stored change, loses inline citations |
| Q4 | Delete and rename conversations? | **Delete now** as a new soft-delete action (no migration, audited). Rename and AI-written titles later | Nothing: the list grows forever, 20 shown |
| Q5 | Thumbs up and down on answers? | **Not in 0.8.1.** It needs a table, and 0.8.1 has no migration | Build with L5's evaluation in 0.9.0, where the feedback would be used |
| Q6 | Are the live steps stored? | **No.** Shown while the answer arrives; afterwards the sources say what was used. Once L3 records the copilot's reads in `ai_tool_calls` (0.9.0), the disclosure can be rebuilt from them | Store them now: a column or table, so a migration |
| Q7 | Which release? 0.8.1 is "a quick patch … no new engine, no migration" | **0.8.1: CP8, CP3, CP2, CP1, CP6** (the defects F1 to F4, F13, F14 and the stuck conversation), about four days. **0.9.0: CP4, CP5, CP7, CP9, CP10, CP11**, beside L1 to L6 and your streaming, because CP5 and CP9 share their events and citations | All of it in 0.8.1: about eight more builder days in a patch release |
| Q8 | Should the server stop sending English sentences (CP10)? | **Yes, in 0.9.0** with the streaming change, which already touches every event | Leave it: Malay readers keep English reasons |
| Q9 | Which suggested prompts, and does entity scope wait for L2? | **Prompts that work before L2**: "What have people said about onboarding?", "Summarise the open blockers in my space", "Add a task to one of my key results", "Start an initiative for a key result". Swap in "How are my objectives doing?" when L2 lands. **CP11 waits for L2**, which gives the copilot the reads that make "about this objective" useful | Prompts about values and health now: the live test on 11 November answered 0 of 15 of those, so the first click would fail |

### 3.4 Acceptance criteria

| Row | Given | When | Then |
|---|---|---|---|
| CP1 | The panel is open and focus is in the composer with nothing typed | The person presses Escape | The panel closes and focus is on "Ask the copilot" |
| CP1 | The panel is open | The person presses the close button | Focus is on "Ask the copilot" |
| CP1 | Compact density at 1440 | The panel opens | It is 512px wide, the same as comfortable |
| CP1 | The panel is open at 1440 | The person presses Expand, closes, reloads and opens it again | It opens 768px wide |
| CP1 | A question was sent | The answer finishes | A polite status has said "Answer ready" once, and focus is still in the composer |
| CP2 | A thread with three turns is open | The person presses New chat | The thread is empty, the composer is focused, and the next question starts a new thread |
| CP2 | Two earlier conversations | The person opens History and picks the older one | Its turns show, the address carries `?copilot=<id>`, and reloading shows the same thread |
| CP2 | Q4 says yes; a conversation in History | The person deletes it | It leaves the list, an audit row records `copilot.deleteThread`, and its address answers not-found |
| CP3 | A thread taller than the panel | The person opens it | The last turn is in view |
| CP3 | An answer is arriving and the person has not scrolled | Text is added | The newest line stays in view |
| CP3 | An answer is arriving and the person scrolled up | Text is added | The view does not move, and "Jump to latest" shows; pressing it scrolls to the end and hides it |
| CP3 | A thread where the first question made a card and the second did not | The thread is read | The card sits in the first turn, not after the second |
| CP3 | An answer has finished arriving | The recorded message replaces it | The text never leaves the screen and the column width does not change |
| CP4 | An answer containing `**on track**` and a three-line `- ` list | It is shown | "on track" is bold, the list is a list, and no asterisk or dash shows |
| CP4 | An answer containing `[click](javascript:alert(1))` or `https://example.com` | It is shown | Neither is a link; the text shows as typed |
| CP4 | An answer ending mid-stream in `**on tr` | It is shown | The characters show as typed, and the page does not break |
| CP5 | An answer citing passages 1 and 3 | It is recorded and shown | Chips 1 and 3 in the prose open the same sources as items 1 and 3 in the list |
| CP5 | A cited key result the reader can no longer see | The thread is read | Neither its chip nor its number appears anywhere |
| CP5 | A cited key result the reader can see | The person presses its chip | Its objective opens with that key result in view |
| CP6 | The composer is focused | The person types twenty lines | The box grows to 40% of the panel, then scrolls inside |
| CP6 | A Japanese IME composition is open | The person presses Enter to confirm it | Nothing is sent |
| CP6 | An answer is arriving | The person types the next question | It is kept, and Send stays disabled until the answer ends |
| CP6 | The server refuses the request | The person presses Send | The question is back in the box and an error under it says why |
| CP7 | A finished answer | The person presses Copy | The answer's text is on the clipboard and "Copied" is announced |
| CP7 | The last answer stopped early | The person presses Retry | The same question is asked again as a new turn |
| CP7 | A pending card the person may not apply | They press Apply | The refusal shows on that card, not at the end of the thread |
| CP7 | A card that was applied | It shows | It links to the objective, key result, initiative or task it made |
| CP8 | No AI provider | The person asks a question | The matching passages and the reason stay on screen after the turn lands |
| CP8 | No AI provider, and the person holds `manage_ai` | The panel opens | It shows Open AI settings, linking to `/admin/ai`; a member without it sees no link |
| CP8 | The availability read throws | Any page loads | The page renders, and the copilot says it cannot answer right now |
| CP8 | An empty panel with AI on | The person presses a suggested prompt | That question is sent |
| CP9 | A question that makes a card | The answer is being prepared | The step line reads "Checking whether this is a change I can make…" before the card shows |
| CP9 | Reduced motion | An answer arrives | The caret and the step line do not move |
| CP9 | The default deployment (`OPENOKR_RELAY` on) | The person presses Stop | Text stops arriving, "Stopped" shows on the turn, and a reload shows the same stopped answer |

---

## 4. What must change in UIUX-PLAN S-39 and the mockups

**S-39 today**: "A side panel opened with ⌘J, workspace-scoped or entity-scoped. A thread of turns with streaming and a stop control, inline action proposals rendered as a preview or difference with apply and dismiss, and citations only to what the viewer may see. States: empty, AI off with a link for admins, rate-limited or capped. …"

| Add or change | Proposed words, in the document's style |
|---|---|
| Frame | "A side panel opened with ⌘J, 512px wide, with Expand to 768px; below 768px a full-screen sheet. Not modal: Escape closes it and focus returns to Ask. The open conversation lives in the address (`?copilot=`)." |
| Conversations | "New chat and History in the header. History lists the member's conversations, newest first, with when each was last used." (plus delete, if Q4) |
| Turns | "The member's turn is a bubble on the right. The copilot's answer is prose across the panel under its face, with bold, italics, lists and code rendered from the subset the copilot writes, and no link the model wrote." |
| Streaming | "While it works, one line says what it is doing (searching, checking for a change it can make, reading a named item, writing), and folds into a 'Read n items' disclosure once the answer starts. Arriving text ends in a caret. The view follows the answer unless the member scrolls up, and Jump to latest brings it back. Stop stops the answer in every deployment." |
| Citations | "Numbered chips in the answer and a numbered list under it, each a link to the objective, key result, KPI, initiative, task, check-in, session or document. A source the reader may no longer see is dropped with its number." |
| Proposals | "A card sits in the turn that made it, and after Apply links to what it made." |
| Actions | "Copy on every answer; Retry on a failed or stopped one." |
| States | "Empty shows four suggested questions. AI off keeps the matching passages on screen as the answer and links whoever can fix it to the AI page, the plan page or their own AI keys. A failure to check availability makes the copilot unavailable, never the page." |
| Accessibility | "The conversation is a log. The finished answer, a stop and an error are announced once; arriving text is not read out word by word." |

Also: §7 could name the copilot beside "toasts, realtime list and feed changes" in its live-region line, and §4's AI affordance row could say a streaming answer shows its steps.

**Mockups.** There is no copilot mockup (`docs/mockups/README.md` and the UIUX-PLAN §10 table list none). Recommend `docs/mockups/src/13-copilot.html`, rendered to PNG and added to the §10 table, drawing five states at 512px and 390px in both themes: empty with suggestions, an answer arriving with the step line, a finished answer with citations and actions, a card in its turn, and AI off with the admin link. Reference only, as always. AI-NATIVE-PLAN §2.4 needs no change for these rows; copilot-live-data §3.7 already promises entity source links and the reading line, so CP5 and CP9 should say they build it.

---

## 5. Unverified, and why

| Not checked | Why | Next run |
|---|---|---|
| Every rendered size, contrast and overflow of the panel, at 1440 and 390, light and dark, comfortable and compact | The shell failed on the workspace's sealed AI key (F14); I had no `OPENOKR_ENCRYPTION_KEY` and did not search for one | Start the app with the key that sealed the Northwind credentials, or with a workspace that has none |
| F1, F5, F6, F7, F21 seen on screen | Traced in code only | Same, with relay on and off |
| Whether Luna and Sonnet answers carry Markdown in this product (F8) | No provider reachable | One live question with a provider configured |
| Composer growth in Safari and Firefox (`field-sizing`) | No browser run of the panel | Playwright WebKit and Firefox |
| iOS keyboard over the composer, safe areas (F26) | Needs a device | A real iPhone |
| Screen-reader output | Needs a person, as `docs/design/accessibility.md` says | VoiceOver pass after CP1 |
| Real streaming cadence and first-word delay with A2's proposal call | No provider | Live run in the L7 work |
