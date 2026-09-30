# @openokr/web

## 0.1.0

### Minor Changes

- [#92](https://github.com/open-okr/open-okr/pull/92) [`62e5d9e`](https://github.com/open-okr/open-okr/commit/62e5d9ea652a7e10a1948f7a5b896ee12af9843f) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - A workspace's brand colour and its own words for the method's terms now reach
  its screens.
  
  Both were saved on the admin screens and read by nothing. The branding card
  said a saved colour was "in force across this workspace" while every screen
  stayed indigo, and a workspace that renamed "Space" to "Team" still read
  "Spaces" everywhere.
  
  **The brand colour** becomes the buttons, links, progress bars and focus rings
  on every screen of the workspace, in light and dark, without a rebuild. Each
  shade is weighted so its text stays readable at WCAG AA: a colour too light to
  carry white text is darkened for buttons, and the card names the shade in
  force. Red, amber and green are refused, on the card and through the API,
  because they mean off track, at risk and on track; the card says so in words
  instead of appearing to save. A status colour stored before this release is
  not applied, and the card says that too. The sign-in page and emails do not
  carry the colour.
  
  **A renamed term** shows in the sidebar and in the main screens' headings,
  create buttons, counts and empty states: the Spaces, KPIs and Cycles pages,
  drafting's Add objective and Add key result, the goal page's key results,
  search and inbox labels, and the champion, reviewer, sponsor and facilitator
  fields. A rename is the organisation's own word, so it reads the same in
  English and Bahasa Melayu; a term nobody renamed reads in each person's own
  language. Rule names, coaching messages, longer explanatory sentences, emails
  and chat messages keep the method's words.
  
  Two English headings changed wording so they can hold any term: "Add a KPI"
  is now "New KPI" and "Create a space" is now "New space".

- [#87](https://github.com/open-okr/open-okr/pull/87) [`5d03240`](https://github.com/open-okr/open-okr/commit/5d032405c58639f57bc76cf7171e635f88dccb08) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - An administrator can make another member an administrator, and step down.
  
  Until now only the person who created the workspace could ever have full
  access: invitations grant standard access at most, and nothing on screen or
  in the API could change it. A workspace whose founder left had no
  administrator. Each person's profile now has "Make administrator" and "Remove
  as administrator" for administrators to use. The last administrator cannot
  step down, and is told to hand over first. Agents and guests cannot be made
  administrators. New API action: `people.setAdministrator`.

- [#92](https://github.com/open-okr/open-okr/pull/92) [`2aefe9c`](https://github.com/open-okr/open-okr/commit/2aefe9c9d5e2b68e48a11870f80d390e8aaaeb70) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - A local AI agent can connect with a token, every public door is rate limited,
  and a token can no longer administer tokens.
  
  An agent that cannot open a browser, such as a coding agent in a terminal or a
  desktop assistant set up from a file, had no way to reach the agent endpoint:
  it only accepted tokens from the browser consent flow. On **Account, then API
  tokens**, a token can now be made for **An AI agent**. It is shown once, already
  inside a configuration the agent can read, and the agent sends it as a bearer
  token to `/api/mcp`. It carries your own access narrowed by the scopes you
  choose, exactly like an agent you approve in the browser, and it works at the
  agent endpoint and nowhere else. A REST token is refused there and told which
  kind to make. The tokens list now says which kind each token is.
  
  The agent endpoint, OAuth client registration, the OAuth token endpoint and
  SCIM directory sync are now rate limited, as the REST surface already was. A
  refusal is a 429 with `Retry-After`, in each protocol's own error shape. The
  REST surface and the device login now send `Retry-After` too.
  
  | Door | Counted per | Limit |
  |---|---|---|
  | `/api/mcp` | Approved agent, or agent token | 600 a minute |
  | `/api/mcp/register` | Caller address | 10 a minute |
  | `/api/mcp/token` | Caller address | 600 a minute |
  | `/api/scim/v2` | Directory token | 600 a minute |
  
  The caller address is the one the sign-in lockout already counts: a single
  address in `X-Forwarded-For` or `X-Real-IP`, as the shipped proxy writes it.
  The device login used to trust the first entry of a forwarded chain, which the
  caller can write, and now does not.
  
  **Behaviour change.** Minting a token, revoking one and approving a terminal
  now work only in the browser, signed in. A call to `tokens.create`,
  `tokens.revoke` or `tokens.approveDevice` through the REST surface, the agent
  endpoint or chat is refused, whatever the token's scopes. Before this, a token
  with write scope could mint itself one with destructive scope.

- [#87](https://github.com/open-okr/open-okr/pull/87) [`17d147a`](https://github.com/open-okr/open-okr/commit/17d147a98049de07eff9e74ed23c5a8029335c16) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - The Coach and the Champion read only what they are bound to, and an agent in
  sandbox mode no longer changes anything.
  
  Both agents were given access to named spaces and never to the whole
  workspace, and then read every goal, KPI, blocker and session regardless. The
  Coach sent the titles it read to the AI provider. They now read through their
  own access, the same way a person does. So that nothing drops out of their
  sight, both are also given access, by name, to every company goal, individual
  goal and KPI that belongs to no space, as each is created. `pnpm db:change`
  does the same for the ones that already exist, and gives each such KPI the
  access record it has never had.
  
  Sandbox mode was supposed to commit nothing. The two built-in agents ignored
  it and sent their nudges and wrote their proposals anyway. A sandboxed run now
  works everything out, records what it would have done as simulated, and
  changes nothing else. The demonstration instance runs both agents once before
  putting them in sandbox, so its nudges still come from the product.

- [#92](https://github.com/open-okr/open-okr/pull/92) [`1ec5af5`](https://github.com/open-okr/open-okr/commit/1ec5af57cc992b7dde1064edb0913daa00c46431) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - An administrator now decides what may leave for an AI provider, and the product
  enforces it on every AI request.
  
  The privacy card on the AI console was three paragraphs of text. Nothing it
  described could be changed, and one paragraph was not true: it said an assist
  sends only the text it drafts from, while the copilot sent the passages it found
  and the search index sent every item's text to be embedded.
  
  The card is now a form with four controls:
  
  - **What may be sent.** Everything a feature needs (as before), assists only,
    or nothing. With assists only, the copilot shows its passages without a
    written answer and nothing is sent to build the search index. With nothing,
    every assist falls back to its manual path and the agents run without
    drafting, as they do with AI off.
  - **Replace email addresses and phone numbers** with a placeholder before a
    request leaves. On by default, including on workspaces upgraded from an
    earlier release. Names are sent as written.
  - **Ask the provider not to keep or train on what is sent.** OpenRouter takes
    this on every request and routes only to providers that do not collect data.
    The card says plainly that Anthropic, OpenAI and Google take no such
    instruction. Off by default.
  - **Hosts an AI request may reach.** Empty allows any provider you enable. A
    request to any other host is refused before it is sent.
  
  None of the four applies to a provider at localhost or at a private network
  address written as numbers, because nothing sent there leaves your network. A
  name such as `ollama` is still governed, since only a name server knows where
  it points; list it if you use the allow-list. When every tier is answered
  locally, the card says so and greys the controls out.
  
  Each request a control refuses or changes is written to the audit trail with
  its host and how many addresses and numbers were replaced. The text itself is
  never recorded. Nothing about how the product decides anything changes: with AI
  off, or with a control withholding a request, every rule, score, gate and nudge
  works exactly as before.

- [#92](https://github.com/open-okr/open-okr/pull/92) [`533dc64`](https://github.com/open-okr/open-okr/commit/533dc6445731b2faf4ddc589771fbb7b7ef0215a) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - An instance now carries the name its operator gave it, everywhere a person
  sees one.
  
  `OPENOKR_INSTANCE_NAME` and the setup wizard's name field were both stored and
  never read. Every tab, heading, email and chat message said "OpenOKR" whatever
  the instance was called, and the public demo, which sets the variable to
  "OpenOKR demo", said "OpenOKR" on every page.
  
  The name now reaches the browser tab, the sign-in and setup headings, the error
  page shown when the app cannot start, the feed's name for the product acting,
  the chat linking prompt and its reply, password-reset and address-confirmation
  emails, invitations, every nudge and the morning summary, the blocker card, the
  channel test message, the command line's consent screen and connections list,
  the name an AI client shows for the agent endpoint, the title of the live API
  document, and the app name an AI provider's dashboard lists. With nothing set,
  all of them still say "OpenOKR".
  
  The wizard pre-fills the name the instance already has and stores one only
  when you type a different name. It used to pre-fill "OpenOKR" and store
  whatever the field held, which silently replaced the variable for good.
  
  General in admin gains the name on a self-hosted instance. A name saved there
  wins over the variable; clearing the field hands the choice back to it. Every
  rename is recorded on the instance audit chain. Authenticator apps and passkey
  prompts show a new name after the next restart, and the card says so. On a
  managed cloud the name belongs to the operator and the card is not shown.

- [#87](https://github.com/open-okr/open-okr/pull/87) [`beccda2`](https://github.com/open-okr/open-okr/commit/beccda2497580e6aa5c05783eb8bc95ee94a2de5) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - A workspace archive now moves between instances with its people and its files.
  
  - **A passphrase seals it.** Exporting asks for a passphrase of at least 12
    characters, and any instance given it can import the archive. Archives used
    to be sealed with the exporting instance's own encryption key, so moving
    from the cloud to a self-hosted install would have meant handing over the
    cloud's key. Archives from earlier releases still import on the instance
    that wrote them.
  - **People can claim themselves.** Every member now travels with their email
    address. When that person joins the receiving workspace, they take over
    their member and everything it wrote, instead of getting a second, empty
    membership. The same applies to people a FlowyTeam import brought in.
  - **Files come back.** An import writes every file's bytes back into the
    receiving instance's storage. Before, files arrived as names with nothing
    behind them.
  
  The export card on the admin imports page also works again: it could not seal
  an archive at all, because it was never given what it needed. The archive
  format is now version 2.

- [#92](https://github.com/open-okr/open-okr/pull/92) [`02bc075`](https://github.com/open-okr/open-okr/commit/02bc0758fb4bb090c47d5a2a68801efbe42926b7) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - The AI assists are on the screens they were built for, and two that were
  promised now exist.
  
  Six assists had been built and nothing in the browser offered them. With a
  provider configured they now appear beside what they help:
  
  - a narration of a KPI's trend, under its chart;
  - a KPI suggested from a sentence, under the add-a-KPI form;
  - a summary of a space's open blockers, above the blocker board;
  - a draft retrospective from a goal's check-ins, in the close form;
  - a prose write-up of a quarterly review, on the minutes screen, which can be
    kept as a draft document on the session;
  - next-cycle objectives proposed from the learnings the room carried forward,
    on the learnings stage of the review.
  
  Two assists the requirements listed are new. A goal's discussion can be
  summarised, with the questions it left open, and a summary that quotes words
  nobody in the thread wrote is refused rather than shown. A key result can be
  broken into a few initiatives with their first tasks, drafted as rows you edit
  and untick before anything is created in the space you choose.
  
  Every draft lands in fields you edit before you save; nothing is written on its
  own. Each assist is hidden when AI is off, when the workspace's privacy
  settings keep assists from the provider, or when an administrator switched that
  assist off on the AI console, where both new assists now have their own switch.
  
  The copilot can now propose a key result for an objective, an initiative behind
  a key result, or a task, as well as an objective. It only offers spaces,
  objectives and key results you may change, and applying a proposal still runs
  as you. A proposal card names the change ("New task") instead of printing the
  action's internal name.
  
  The recovery board now shows what launching a recovery would create, the
  objective and its key results, before you press the button.

- [#77](https://github.com/open-okr/open-okr/pull/77) [`6594cf3`](https://github.com/open-okr/open-okr/commit/6594cf3f91401be64e481f9a6322632dde3551a4) Thanks [@agungksidik](https://github.com/agungksidik)! - The audit trail has a screen, and an isolated network has a guide.
  
  **An administrator can check the chain and take the trail away.** Every
  sensitive action has been recorded since the first release and hash-chained
  since the performance work, and reading either needed a shell on the server.
  Now `/admin/audit` says whether the chain is intact and, when it is not, which
  position broke and why. The export narrows by date, action or target and hands
  over a CSV carrying each row's position and hash, so the file and a later
  verification can be lined up against each other by somebody who was not there.
  
  Taking a copy of who did what is itself recorded, with the filter that was
  used. An auditor reading the file finds the export at the end of it.
  
  Both are administrator actions. The trail names every actor and the payloads
  carry the detail, which is not a thing to hand out in bulk.
  
  **Running with no route to the internet is documented and checked.**
  `docs/runbooks/air-gap.md` says what works with nothing configured, what stays
  off until it has a connection, and how to install from a loaded image. Its
  checklist is not prose: `pnpm check:air-gap` checks each row against the
  source and fails if the guide and the product disagree in either direction.

- [#92](https://github.com/open-okr/open-okr/pull/92) [`13c5a0a`](https://github.com/open-okr/open-okr/commit/13c5a0aa32a1fe1187def568d923ad535de65724) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - Bahasa Melayu is a real translation rather than a copy of the English.
  
  About 1,500 of the Malay catalogue's entries were the English text. They are
  now translated, along with about 800 sentences that never reached the
  catalogue at all: text chosen inside a screen's code, messages returned after a
  save, error headings and label lists. Sentences that built English plurals or
  dropped English words into a Malay sentence now pick a whole sentence instead.
  The workspace language setting is a picker rather than a box expecting "ms".
  
  The method's own texts, such as phase names and coaching prompts, stay in
  English. The translation has not yet been reviewed by a native speaker.

- [#92](https://github.com/open-okr/open-okr/pull/92) [`d3984f0`](https://github.com/open-okr/open-okr/commit/d3984f09b866cd84be50f241f68a793f9be8a92e) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - The board shows who else has it open, there is a board for each initiative
  and each key result, and a card can be moved anywhere with the keyboard.
  
  Each board now shows the faces of the other people looking at it, with their
  names read out to a screen reader. Only people who can read that board are
  shown, and somebody who loses access leaves everybody's board at once. When
  live updates are unavailable the board works as before and shows nobody.
  
  An initiative's page and each key result on a goal's page open their own
  board. A key result's board holds the tasks that name it and the tasks of
  every initiative serving it, the same work its "linked work" count adds up. A
  task added on an initiative's board belongs to that initiative. Asking for the
  board of a space, initiative or key result you cannot see now answers "not
  found" rather than showing an empty board, in the app and in the `tasks.board`
  API, which also says what the board is of.
  
  Each card has a move handle. Press Space or Enter to pick the card up, the
  arrow keys to carry it up and down its column or across to the next one, then
  Space or Enter to put it down, or Escape to put it back. Each step is
  announced. The card is saved once, when it is put down, exactly as a drag
  saves it.

- [#92](https://github.com/open-okr/open-okr/pull/92) [`ac34feb`](https://github.com/open-okr/open-okr/commit/ac34feb2863404447f031d19d13779cd7c57bb5d) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - Closing a cycle is one act now, and it feeds the next cycle by itself.
  
  The method says that at the close the product hands the next cycle its
  inheritance automatically. It did not. Recording the result was a button on the
  scorecard, handing over to the next cycle was another, and nothing ever marked a
  cycle closed, so a cycle stayed open for good and the next one inherited only
  what somebody remembered to press. The feed-forward button on phase 7 did not
  work at all.
  
  Phase 7 now has **Close the cycle**, and the scorecard offers the same close for
  a cycle that has stopped being current. It waits until every key result is
  scored and the retrospective is written, and lists what is still missing until
  then. Closing records the result on the scorecard, marks the cycle closed and
  feeds the next cycle: every score and each carried item into phase 2, the
  learnings into the phase 1 input pack, and the lowest-scoring process-health
  statement into phase 3.
  
  **The next cycle does not have to exist yet.** The review comes before anybody
  drafts the next cycle, so usually it does not, and when it is created it
  receives the same inheritance then. Phase 7 of a closed cycle shows its result,
  its verdict and what the next cycle received.
  
  **The lowest process-health statement is a phase 3 priority again**, as the
  method's table says, rather than a phase 2 issue. Existing issues written the
  old way are left where they are.
  
  For API clients: `cycles.close` is new. `cycles.feedForward` stays as a re-run,
  and its result reports `processPriority` (the statement, or null) in place of
  the `processHealthIssue` flag. `cycles.snapshot` refuses a closed cycle, whose
  result was fixed when it closed, and `cycles.feedForward` refuses to feed into
  one.

- [#74](https://github.com/open-okr/open-okr/pull/74) [`91bdf61`](https://github.com/open-okr/open-okr/commit/91bdf6184c028531f87214c4eda0bd639d62e3d2) Thanks [@agungksidik](https://github.com/agungksidik)! - Cloud signup, the workspace lifecycle, and a verification rule that helps
  self-hosted instances too.
  
  **A sign-in now waits for a verified address as soon as the instance can
  actually send mail.** `requireEmailVerification` has been off since the first
  release with a good reason: a fresh instance has no mail server, and blocking
  the first login on a link nobody can receive makes the product unusable out of
  the box. That reason stops applying the moment `mail.transport` is something
  other than `console`, and it stops applying whether the instance is a managed
  cloud or somebody's own server. An unrecognised transport does not count as
  delivering, so a typo cannot lock everybody out.
  
  The answer is resolved once at boot, so changing the mail transport needs a
  restart before sign-in behaviour follows.
  
  **A cloud instance keeps registration open.** The existing rule closes
  registration once somebody has claimed the instance, which is right for a
  server that belongs to whoever set it up and wrong for a cloud, where it would
  mean exactly one customer ever signed up. An operator setting
  `registration.policy` to invitation-only still closes it, because an explicit
  choice beats a computed default.
  
  **A cloud workspace can be suspended, closed and reopened.** A suspended
  workspace is read-only and a closed one is frozen, through the permission
  overlay that already refuses those writes rather than through a second check.
  Member and settings management keeps working in both, which is what lets a
  suspension be lifted.
  
  **Nothing is ever erased without somebody choosing a number.**
  `cloud.closureRetentionDays` is zero out of the box, and the sweep reads that
  setting and returns before it looks at a single row. `pnpm cloud:sweep` reports
  what retention is set to and which closed workspaces a future erasure would
  name. It deletes nothing.
  
  **A row-level security fix.** The tenant policy on `tenants` now treats an
  empty setting as absent. On a pooled connection that had already served a
  request, the previous expression raised an error rather than returning no
  rows: fail-closed either way, and nothing ever leaked, but it stopped a
  second permissive policy from applying.

- [#74](https://github.com/open-okr/open-okr/pull/74) [`c79702c`](https://github.com/open-okr/open-okr/commit/c79702c0c8687231ebb669715b3f59bc5c8d9756) Thanks [@agungksidik](https://github.com/agungksidik)! - The groundwork for a managed cloud, with nothing visible on a self-hosted
  instance.
  
  A new `tenants` table records what a vendor knows about a customer it
  operates the product for: a plan, a seat count, a trial end, a region and a
  lifecycle state. It is written by workspace provisioning, in the same
  transaction as the workspace itself, and only when the instance has been told
  it is a cloud one.
  
  **Three new instance settings, all defaulting to the self-hosted answer.**
  `cloud.enabled` is off, so an instance that is never told otherwise writes no
  tenant row and behaves exactly as it did before. `cloud.region` is recorded on
  every tenant and never routed on. `cloud.closureRetentionDays` is zero, which
  means a closed workspace is never erased: a number out of the box would
  delete data on every instance that never chose one.
  
  **Nothing on the product path may read the tenant row**, and the architecture
  boundary gate now refuses one that tries. A plan key read by a goal list or a
  check-in would fork the self-hosted product from the cloud one, and the fork
  would stay invisible until a self-hosted instance met the null.
  
  Self-hosted behaviour is unchanged in every respect. No screen, no setting to
  answer, no seat limit and no billing surface.

- [#87](https://github.com/open-okr/open-okr/pull/87) [`70eb0bc`](https://github.com/open-okr/open-okr/commit/70eb0bcf288ba8ba1c084a35523686d0070a7508) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - Comments, mentions, check-ins and closed goals now tell the people following
  them.
  
  A mention used to subscribe the person and tell them nothing, and a new
  comment told nobody at all. Now a mentioned person gets a notification
  straight away, marked as a mention, and everybody following the goal, key
  result, check-in, cycle or document gets one for each new comment. Mentioning
  somebody in an edit tells them too, once. A published check-in and a closed
  goal reach the goal's watchers. Nobody is told about their own comment or
  check-in, nobody gets the same event twice, and a person who can no longer
  see the item is not told about it.

- [#87](https://github.com/open-okr/open-okr/pull/87) [`24fec55`](https://github.com/open-okr/open-okr/commit/24fec55eef4526fb898a5ee001abebc652b1c7eb) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - Every planning phase of a cycle can now be completed from the browser.
  
  Several things the cycle's phases check had no control on any screen, so
  those phases could never turn green and every publish needed an override:
  
  - **Phase 1:** name the sponsor and facilitator, book the four planning
    sessions, and declare a first cycle.
  - **Phase 2:** record baseline health in its three columns: stable,
    declining, business as usual.
  - **Phase 3 (quarterly):** revalidate the annual frame, and choose which of
    the year's key results this quarter focuses on.
  - **Phase 5:** record what was cut, which capacity gate 5 requires.
  
  A quarter now finds its year's key results by the calendar, so a quarter
  under a year with key results is asked to choose among them rather than
  getting by with a note. A sponsor or facilitator must be an active person in
  the workspace. New API action: `workflow.setFocusKeyResults`.

- [#92](https://github.com/open-okr/open-okr/pull/92) [`7e00584`](https://github.com/open-okr/open-okr/commit/7e005845f46ff310b2c82ca45a7442dca712aa40) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - A deleted goal, initiative, task or document can be brought back, by an undo
  straight after the delete or from a new Deleted items screen later.
  
  The delete button on each of those four pages said "an administrator can bring
  it back", and nothing could. Deletes were always soft, so nothing was lost, but
  there was no restore and no list to find a deleted item on.
  
  Deleting is now one press. The page you land on shows a message that says what
  a delete is here and offers Undo for six seconds; pressing it restores the item
  and takes you back to it. This replaces the old second "are you sure" press,
  which the interface design never called for on something that can be undone.
  
  Later, **Admin, Deleted items** lists what was deleted that you could restore,
  newest first, with who deleted each one and when. Restore brings the item back
  with what the delete took with it: a goal's key results, an initiative's links
  to key results, a task's assignees and checklist. A task on a deleted
  initiative, or a document on a deleted goal or initiative, is refused until the
  parent is restored, and the refusal names the parent. Restoring asks the same
  access the delete asked, and is recorded in the feed and the audit trail.
  
  New API actions: `goals.restore`, `initiatives.restore`, `tasks.restore`,
  `documents.restore` and `workspace.deletedItems`.

- [#77](https://github.com/open-okr/open-okr/pull/77) [`b54e21c`](https://github.com/open-okr/open-okr/commit/b54e21c503411d7aea9816789cfc96f4bf19b638) Thanks [@agungksidik](https://github.com/agungksidik)! - The demo now holds a quarter that is already over.
  
  `pnpm db:seed` used to build one quarter, mid-flight, with an empty scorecard.
  The note beside it was honest about why: scoring at the quarterly review had not
  been built yet, and seeding invented scores would have put a number on a screen
  that no review agreed. Scoring shipped, and the note stayed.
  
  So the demo of a product whose closing argument is "did we miss because the
  strategy was wrong, or because the cadence broke" had nowhere to show that
  argument. It does now. The seed runs a whole review of the previous quarter
  through the ordinary actions: two objectives, five key results each graded with
  a one-line reason, the scores revealed, the process-health survey answered, the
  diagnostic recorded, the session closed and the cycle snapshotted.
  
  The result is a scorecard with last quarter on it, goal pages with scores, and
  a diagnostic reading "strategy or OKR-quality problem" out of a cycle score of
  0.58 against a rhythm score of 4.0. Nothing writes that verdict. It is derived
  from the two numbers, so changing either threshold changes what the demo says.

- [#77](https://github.com/open-okr/open-okr/pull/77) [`8f81678`](https://github.com/open-okr/open-okr/commit/8f816783d810f53bb8d9f2d065e3c0b7b421dab5) Thanks [@agungksidik](https://github.com/agungksidik)! - A public demonstration instance, and a reset that rebuilds it from nothing.
  
  `deploy/demo/` is an overlay on the Compose target rather than a second
  deployment. It changes two things: the sign-in page names the seven people
  anybody may sign in as and publishes the password they share, and Postgres is
  published on the loopback address so the seed can reach it. Nothing is switched
  off, no gate is loosened, and no feature is hidden.
  
  `deploy/demo/reset.sh` destroys the demo compose project including its volumes,
  starts it again with fresh secrets, waits for health, claims the instance,
  seeds the organisation and gives the cast their accounts. Put it in cron and
  the instance is the same one every visitor sees.
  
  It destroys everything every time. An instance strangers can write to
  accumulates whatever they wrote, and a reset that deleted only what visitors
  added would be a delete path across 129 tables that nobody exercises. The
  compose project name is fixed in the script rather than read from the
  environment.
  
  Also fixes a defect this work sat next to: `/api/sso-providers` has been
  fetched by the sign-in page since single sign-on shipped and was never on the
  proxy's public list, so on a deployed instance every request for it was
  answered with a redirect to the sign-in page. The page caught the failure and
  rendered no buttons, which is why nobody saw it: an instance with single
  sign-on configured showed no way to use it, and no error either.

- [#77](https://github.com/open-okr/open-okr/pull/77) [`3c85a03`](https://github.com/open-okr/open-okr/commit/3c85a036ee2da87ca7ee89488710f130770fca7e) Thanks [@agungksidik](https://github.com/agungksidik)! - A demo workspace's people can be signed in as.
  
  `pnpm db:seed` has always written a believable organisation, and its seven
  invented people have always been members with nobody behind them. That is right
  for a seed on a laptop, where the presenter is signed in and the cast are names
  on a screen, and wrong for a public demo instance, where the visitor is nobody
  and the only way to see the product as the Head of Engineering sees it is to be
  her.
  
  `pnpm demo:prepare` gives each of them an account, attaches it to the member
  row the seed already wrote, puts both agent members into sandbox, and runs the
  Coach and the Champion once so the nudges on screen are ones the product
  produced rather than rows something inserted.
  
  It refuses a workspace the demo builder did not build, and never touches a
  member who already has a real person behind them. The password is published on
  purpose, because a demo account nobody can sign into is not a demo account.

- [#92](https://github.com/open-okr/open-okr/pull/92) [`18cb948`](https://github.com/open-okr/open-okr/commit/18cb948a11cc351305d416fc1a9c8ffbf65089b0) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - Documents, files and comments are on every page that should carry them, not
  only the goal.
  
  **Where they are.** The documents panel is on a goal, an initiative, a space's
  home, a session and the cycle workspace. The files panel is on all of those and
  on a task and a document. The discussion, with reactions on each comment and on
  the thing itself, is on a goal, an initiative, a task and a published document.
  A task's page used to say that comments and files were not kept on a task; it
  now keeps both.
  
  **Who sees them.** A comment or a reaction is readable and writable by whoever
  reads what it is on, and by nobody else. `comments.create`, `reactions.add` and
  `reactions.list` now check that, as `comments.list` always did. Only a
  comment's author, or somebody who can edit what it is on, can delete it; before
  this any member could delete any comment. A draft document has no discussion:
  its author is told to publish it first, and anybody else gets not-found. A
  comment on a key result now resolves through its goal instead of failing.
  
  **The feed.** A file attached to a goal, a task, a space or an initiative is a
  line in that subject's feed. It used to be recorded as being on a document
  whatever it was on, so no feed showed it.
  
  Migration 0103 lets a comment hang on an initiative. It widens a check
  constraint and nothing else, so the previous release keeps working during a
  rolling upgrade.

- [#87](https://github.com/open-okr/open-okr/pull/87) [`4e569ea`](https://github.com/open-okr/open-okr/commit/4e569ea0edbad8558099f71a1e1ac4252fc1fdef) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - Drafting on the cycle screen now waits until the planning phases are done.
  
  The requirements say that drafting in phase 4 is refused, with the reason,
  while an earlier phase is incomplete. Before, the screen only showed a banner
  and let drafting go ahead. Now the add forms give way to a note, and the
  server refuses a draft from the cycle screen and names each missing item.
  Goals added anywhere else, by import, from a template or through the API
  without the new `guided` flag, are not held up. Each goal's progress bar on
  the drafting screen is now named after its goal for screen readers.

- [#92](https://github.com/open-okr/open-okr/pull/92) [`c123cee`](https://github.com/open-okr/open-okr/commit/c123cee3f39c617d55dcdb5bbd12ac1777294c9d) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - Erasing a member now removes their name from everywhere a workspace can read
  it, and removes their sign-in account when this was their only workspace.
  
  The erasure's own feed entry used to record the erased person's name, and
  earlier entries about them kept it too. Neither does now, and existing entries
  are cleaned by a data change. When the person belongs to no other workspace,
  their account is anonymised, signed out and stripped of every way to sign in;
  otherwise it is left for the workspaces they are still in.
  
  Every member can also download what the workspace holds about them, from
  Account, Security, Your data, without asking anybody.

- [#87](https://github.com/open-okr/open-okr/pull/87) [`473cd9d`](https://github.com/open-okr/open-okr/commit/473cd9d7ed1722a999aaa4acb3eb9cbcf7a887f5) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - Anthropic, OpenAI, Google, a local Ollama and any OpenAI-compatible endpoint
  now work. Until now only OpenRouter did.
  
  Every model call was built as OpenRouter whatever a workspace had configured,
  so a workspace that set up any of the other five providers found every assist,
  the copilot and the agents' drafting behaving as though AI were switched off.
  Calls now go to whichever provider the workspace routes each tier to, with that
  provider's own key and address. A local Ollama, which needs no key, is picked
  up from its settings alone, which is what makes a fully air-gapped model work.
  
  On the managed cloud, the address an administrator gives for Ollama or an
  OpenAI-compatible endpoint is checked on every request, and a private or
  reserved address, or a redirect, is refused. On a self-hosted instance a
  private address is allowed, because that is where a local model runs.

- [#87](https://github.com/open-okr/open-okr/pull/87) [`446374d`](https://github.com/open-okr/open-okr/commit/446374dd3c13bff57ec9364b5ea3465b6f017e93) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - Twelve of the agents' messages that the product described but never sent now
  go out.
  
  The OKR Champion now:
  
  - tells a space's coordinator the same day a key result is scored at 0.3 or
    below;
  - sends the week's digest to the space and the sponsor after a weekly session
    closes;
  - reminds people of open commitments on the last working day of the week;
  - warns a coordinator on the Friday of a week with no session, when that would
    break the streak;
  - tells the facilitator when a planning phase's window closes with the phase
    unfinished.
  
  The OKR Coach now flags:
  
  - a draft whose confidence is too comfortable;
  - a key result whose forecast misses its target;
  - too many objectives at a level or in a team;
  - a direction set with no not-doing list;
  - capacity checked with nothing cut;
  - scores that cluster too high at the close;
  - the lowest-scoring process-health statement after a quarterly review, for
    the sponsor to carry into the next cycle.
  
  Every one is decided without AI, reads the workspace's own thresholds, and
  goes through the usual deduplication, quiet hours and weekly ceiling.

- [#92](https://github.com/open-okr/open-okr/pull/92) [`20f3ac3`](https://github.com/open-okr/open-okr/commit/20f3ac3071225d3579395bd87703683c139315e2) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - Uploaded images are re-encoded and shown as previews, and files can be scanned
  for viruses.
  
  **Every uploaded image is written again before it is kept.** A PNG, JPEG, GIF
  or WebP is decoded and saved anew in the type it claimed. What is stored is
  pixels the instance drew rather than the bytes that arrived, so a photo's EXIF
  block, with the camera and, from a phone, where it was taken, no longer comes
  along. A file that says it is an image and is not one is refused with a message
  saying so, and so is an image of more than 100 megapixels. A portrait photo
  stays upright: the orientation the phone recorded is applied before the tag is
  dropped.
  
  **The file list shows what each file is.** An image has a small preview beside
  it, and anything else the icon for its type, with the type named beside its
  size. Images uploaded before this release keep their icon, because no preview
  was made when they arrived.
  
  **A virus scan is available, and off until you turn it on.** Set
  `OPENOKR_CLAMD_HOST` to a ClamAV daemon the instance can reach (and
  `OPENOKR_CLAMD_PORT` if it is not on 3310), in the environment, the Compose
  file or the Helm chart's `scan.clamd` values. Each new upload is then listed as
  being checked and cannot be opened until clamd answers. A file clamd flags, or
  refuses to scan, is held back for good and never served, and the signature is
  on the audit row. If clamd cannot be reached the file waits and the scan is
  tried again. With nothing set, files are available as soon as they are
  uploaded, as before, and nothing but Postgres has to run.
  
  Nothing needs doing on upgrade. The image carries the image library for its own
  platform, and nothing is downloaded when it first runs.

- [#92](https://github.com/open-okr/open-okr/pull/92) [`49215e4`](https://github.com/open-okr/open-okr/commit/49215e4751fb368618b9fec93f583dc1dccf48a2) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - The spreadsheet importer offers a template for each kind of row, as a CSV file
  or an Excel workbook.
  
  Under Admin, then Import, the wizard now shows two links beside its choice of
  what the file holds, and lists the columns that kind of row cannot do without.
  Each template is a header row and one example row. The headers are the
  importer's own column names, so a filled-in template maps every column with no
  questions asked. The same files are at `/admin/imports/templates/<entity>.csv`
  and `.xlsx` for anybody with full access, and the imports guide lists every
  column and what it holds.
  
  The six examples name each other, so importing them in order (objectives, key
  results, KPIs, KPI values, initiatives, tasks) resolves every reference they
  make. Getting that right found two faults, now fixed: importing an initiative
  you own yourself, or a task assigned to you yourself, failed every time with a
  database error, from a spreadsheet and from FlowyTeam alike.

- [#92](https://github.com/open-okr/open-okr/pull/92) [`a22401e`](https://github.com/open-okr/open-okr/commit/a22401e1b3a804c34af25589f2504c643ecb59bc) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - A key result can be measured by a KPI from the browser, and recording the KPI
  now moves it.
  
  Drafting a key result on the cycle's phase 4 has a new "Measured by" choice.
  It starts at "Measured by hand", which is how every key result worked before,
  and lists every KPI in the workspace beside it. A key result read from a KPI
  starts at the KPI's latest reading, takes its progress from the KPI's
  achievement, and refuses a typed value until it is unlinked. A key result
  drafted by hand can be linked later from the goal page, in the card that
  already unlinks one.
  
  Recording a value on the KPI grid used to move the KPI and nothing that read
  it. The key result kept its old value and its goal kept its old progress until
  somebody checked in on the goal for another reason. Now the same write moves
  the key result, its goal and every goal above it. The same is true when a
  calculated KPI changes because one of its sources did, and when a KPI's target
  or direction is edited. A closed goal is left as it was closed, and its key
  results cannot be linked until it is reopened.
  
  For the API and the command line there are two new actions: `goals.linkKpi`
  links a key result to a KPI, and `kpis.list` returns every KPI by title in one
  query, for a picker.

- [#92](https://github.com/open-okr/open-okr/pull/92) [`88760f4`](https://github.com/open-okr/open-okr/commit/88760f478099aecdde6ee0ecf929eac28ac5241a) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - A member can keep their own AI key, and their own requests use it.
  
  An administrator could already let members supply their own key for a
  provider, and nothing in the product let a member do it. There is now a
  **Your AI keys** page in every member's account menu. For each provider the
  workspace opens to personal keys, a member pastes a key once, and from then on
  sees only whether one is stored, its last four characters, its status and the
  date it was stored. They can replace it or remove it. Nobody, including an
  administrator, can read it back.
  
  The key is used for that member's own requests: the assists they run and
  Copilot's answers to them. The workspace's key still answers everybody else,
  and the Coach and the Champion always run on the workspace's key. On a
  workspace that holds no key of its own, the assists now appear for a member
  who has stored one and stay hidden for everybody else.
  
  A key with a space, a line break or curly quotes inside it is now refused when
  it is pasted, for a workspace key as well as a personal one, instead of being
  stored and then refused by the provider on every request. The AI console says
  where members keep their keys, beside the setting that allows them.
  
  For the API: `ai.readOwnCredentialStatus` now says when each key was stored
  (`setAt`), and `ai.readAvailability` counts the caller's own key.

- [#87](https://github.com/open-okr/open-okr/pull/87) [`ff18095`](https://github.com/open-okr/open-okr/commit/ff18095824049c9fef7180093163f346a5ab5386) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - Reminders sent by email, Slack, Teams and Telegram now say what they are about
  and link to it.
  
  Every reminder except a blocker's used to read "You have a reminder waiting in
  OpenOKR", with no goal, no link and no button. Each one now opens with the
  rule's own name and what it concerns, for example "Check-in due today: Become
  the preferred platform for mid-market teams", and carries a link that opens
  the right page. A check-in reminder offers the check-in itself: a button
  straight to the check-in page by email, and a one-tap command that starts the
  check-in conversation in chat. The links go through the ordinary sign-in;
  nothing in a message signs anybody in.
  
  The daily summary and the blocker card now get their links too. The instance
  never passed its own address to them, so both went out without links.

- [#87](https://github.com/open-okr/open-okr/pull/87) [`6f06e24`](https://github.com/open-okr/open-okr/commit/6f06e2428ca29b0db60005b8b0458ea07cd20786) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - An objective that names an output now blocks publishing, and the drafting
  phase says when it is done.
  
  Publish gate 2 used to judge key results only, so an objective such as
  "Launch the new mobile app" could be published without a word. It now also
  refuses an objective that fails the outcome-not-output check, as the
  requirements always said it should. A warning still does not block, and an
  administrator can still publish over a red gate with a recorded reason.
  
  Phase 4 ("Draft OKRs") is now computed from the drafted set: it names each
  objective that still fails a quality check, and which checks. Phase 5's gate
  list now judges gate 2 as the publish button does, instead of reporting it as
  impossible to check.

- [#74](https://github.com/open-okr/open-okr/pull/74) [`9a9d578`](https://github.com/open-okr/open-okr/commit/9a9d5783522bdbd25a5caaf454e95bb2f2458648) Thanks [@agungksidik](https://github.com/agungksidik)! - The cloud operator console has its first two screens.
  
  A list of every workspace on the instance, and a detail screen for one of
  them: who the customer is, how much of the product they are using, and the
  control that suspends or closes them.
  
  **Nothing a member wrote appears on either screen**, and that is enforced by
  the database rather than by the pages. An operator's connection returns
  nothing from any table holding a workspace's content.
  
  Both screens are absent on a self-hosted instance and to anybody without a
  live operator grant. Not hidden behind a disabled menu: the routes answer the
  same way they would for a page that does not exist.
  
  **The lifecycle control states its consequence before its controls** and names
  the workspace inside its own button, because the last thing somebody reads
  before freezing a customer's account should be whose account it is. The reason
  is required, and it is the sentence that customer's own members are shown.
  
  Usage figures carry the moment they were measured. They are refreshed on a
  schedule, and a number with no timestamp beside it invites somebody to act on
  a stale one.

- [#74](https://github.com/open-okr/open-okr/pull/74) [`807c602`](https://github.com/open-okr/open-okr/commit/807c602ab8ab5ef61b6e7e1dea18bfc0eb4b2f7a) Thanks [@agungksidik](https://github.com/agungksidik)! - A cloud operator can suspend a workspace, and the workspace can see who did
  it.
  
  Suspension goes through the same lifecycle path a member would use, so the
  permission overlay that already refuses writes in a read-only workspace is
  what refuses them here too. A reason is required and the workspace's own
  members are shown it.
  
  **The audit row names the operator.** Until now an operator's action could
  only be recorded as an empty actor, because an operator is a member of no
  workspace and the actor column points at members. A support action that reads
  as the customer's own work is a falsified record, and a suspension a customer
  cannot see attributed is one they have to take on trust.
  
  Somebody without a live operator grant gets the same answer as somebody asking
  about a workspace that does not exist.

- [#74](https://github.com/open-okr/open-okr/pull/74) [`43aa139`](https://github.com/open-okr/open-okr/commit/43aa139be5f9a195e7bf649d09160a446a0eaa4e) Thanks [@agungksidik](https://github.com/agungksidik)! - Per-tenant usage figures for the cloud operator, taken without loosening a
  single policy.
  
  An operator can see how many members, goals and check-ins a workspace holds,
  how much storage it uses, and when it was last active, without being able to
  read anything inside it. The numbers come from a snapshot refreshed by a
  scheduled measurement that opens each workspace properly and counts what a
  member of that workspace would count, so no content table gains a policy and
  no database role gains a privilege to make it work.
  
  The snapshot carries the instant it was taken, shown beside the numbers, so a
  figure from this morning cannot be mistaken for a live one.
  
  **A workspace can now read its own usage row**, which is the same set of
  numbers a plan and seats screen will want.
  
  Instance administration can also list workspaces now. Enumerating them needed
  a database role that could see past the tenant floor entirely; a select-only
  policy is a much smaller privilege and does the same job.

- [#74](https://github.com/open-okr/open-okr/pull/74) [`6043fda`](https://github.com/open-okr/open-okr/commit/6043fda9fbfaa5695f3fc7bd444991bd28cee509) Thanks [@agungksidik](https://github.com/agungksidik)! - The cloud operator, and the wall between them and every customer's content.
  
  A new instance-level grant makes somebody an operator. An operator is not a
  member of any workspace, and reaching across workspaces goes through a narrow
  database key that names exactly three things: the tenant rows, the workspace
  rows, and the operator table itself. Every one of them is read-only.
  
  **No content table names that key, and none ever should.** An operator's
  connection returns zero rows from goals, check-ins, comments, documents and
  every other table carrying a workspace, whatever the application code above it
  does. That is proved against every such table rather than against a sample.
  
  Revoking a grant takes effect on the operator's next query rather than at
  their next sign-in, because the check is in the policy rather than in a
  session.
  
  **A row-level security fix.** One tenant policy, on workspace archive imports,
  compared against an empty setting rather than treating it as absent. On a
  pooled connection that had already served a request it raised an error instead
  of returning no rows. Fail-closed either way and nothing ever leaked, but the
  error stopped a second permissive policy from applying. Every other policy in
  the schema already had the guard.

- [#76](https://github.com/open-okr/open-okr/pull/76) [`1d7ebfa`](https://github.com/open-okr/open-okr/commit/1d7ebfa7c0aeadd036dcf64b4bfe1fbb13a841c0) Thanks [@bedddev](https://github.com/bedddev)! - One workspace can no longer slow down everybody else on the same server.
  
  A cloud deployment can now cap how many actions one workspace runs a minute
  and how many it runs at once. Both caps are off by default and stay off
  unless an operator sets a number, so a self-hosted instance is never limited
  by a value nobody chose.
  
  **The cap sits at the one door every surface comes through**, so it covers
  the browser, the REST API, the command line, an agent calling a tool and a
  slash command in chat. The rate limits that existed before this lived in the
  web routes, which meant an agent or a chat command was never limited at all.
  
  **A workspace over its cap is told when to come back.** The refusal carries
  the number of seconds until the window resets, and the REST API sends it as
  a `Retry-After` header, so a client waits instead of retrying in a loop.
  
  Nothing that was already agreed to is thrown away: a queued job is never
  dropped, and a side effect written inside a transaction that already
  committed is never refused.
  
  A number below its floor is refused when the instance starts, with a message
  naming the setting, rather than being accepted and quietly stopping the
  product.

- [#70](https://github.com/open-okr/open-okr/pull/70) [`234126e`](https://github.com/open-okr/open-okr/commit/234126e7ff1b2088ecbd36a0dc14bd9f7fdd4577) Thanks [@agungksidik](https://github.com/agungksidik)! - An instance can now watch itself, forget what it no longer needs, and hand a
  member their own data.
  
  **Observability.** A new `/api/metrics` endpoint serves this instance's own
  measurements to an instance administrator, in Prometheus format, over its own
  origin. Sixteen series cover every action with its duration and outcome, the
  Operations underneath them, authorisation decisions, the outbox queue's depth
  and age, scheduled jobs, nudges with the reason each was sent or held,
  channel delivery per provider, realtime fan-out, agent runs, and AI spend.
  Two dashboards ship as files and a Compose profile runs them locally, off
  unless you ask for it. Nothing leaves the host unless you set
  `observability.otlp.endpoint`, which is empty.
  
  **Privacy.** Erasing a member now removes the account they are known by on
  Slack, Teams, Telegram or WhatsApp, the codes that linked them, the tokens
  issued to them and their copilot conversations, and blanks the words inside
  messages addressed to them. What they wrote stays, under a placeholder
  identity, so a quarter's record is still readable and the audit chain still
  verifies. The erasure produces an export of their own data first, covering
  every table that holds them, and says in the file what it left out and why.
  
  **Retention.** `messageLogRetentionDays` sweeps the channel message log on a
  daily schedule. It defaults to zero, which means delete nothing: an instance
  upgrading into this loses no row it did not agree to lose. Nudge records and
  agent run logs are never swept, because they are the record of what the
  product did on your behalf.
  
  **Mail.** A misspelt `mail.transport` is now refused, naming the setting,
  instead of silently falling back to writing every message to the process log.
  Leaving it unset still gives you the console driver, and the general settings
  screen now says when an instance is using it, because that driver logs every
  address and every password-reset link rather than delivering them. The reset
  fallback no longer prints the link outside development.
  
  **Coaching.** The objective check that asks "could you complete this without
  anything actually improving?" fired on nineteen real drafts out of twenty. It
  now recognises an end state by the shape of the sentence rather than only by
  a list of words, so "Make onboarding something new customers finish by
  themselves" passes and "Launch the new mobile app" still does not.

- [#74](https://github.com/open-okr/open-okr/pull/74) [`06f96a0`](https://github.com/open-okr/open-okr/commit/06f96a000201a6a5bdf0b31e15828a9a81fa1141) Thanks [@agungksidik](https://github.com/agungksidik)! - Seats, on the managed cloud only, and nothing else changes with a plan.
  
  **No feature is ever behind a plan.** There is no field in a plan definition
  that can name one, and that is the point rather than an omission: a plan is a
  number of seats and a monthly AI spend, and every plan includes everything the
  product does. A self-hosted instance has no plan at all and is never
  seat-limited.
  
  **An invitation holds a seat from the moment it is sent.** If it did not, a
  full workspace could invite a hundred people, every invitation would succeed,
  and every one of those people would be turned away at the moment they clicked
  the link. The refusal belongs with the administrator who sent it, not with the
  colleague who accepted it.
  
  Guests and the built-in agents are never seats. Sharing a space with somebody
  is not a decision about money, a support session costs nothing, and nobody
  pays for the Coach and the Champion. Somebody suspended stops holding a seat
  the day they are suspended.
  
  The limit is checked when an invitation is made and again when somebody
  actually joins. The second is what makes it true: one reusable link admits
  everybody who holds it, so a limit checked only at invite time can be
  overshot by any amount.
  
  A new Plan and seats screen shows what is used, what is left, and what the
  plans on this instance offer. On a self-hosted instance the screen is absent
  rather than empty, and so is its entry in the admin menu.

- [#83](https://github.com/open-okr/open-okr/pull/83) [`516d8d1`](https://github.com/open-okr/open-okr/commit/516d8d1eb7ce5d3604679f1031cb9cccca7275eb) Thanks [@agungksidik](https://github.com/agungksidik)! - A workspace may let progress pass 100%.
  
  METHOD.md §3.1 clamped progress to 100 with a constant, so a key result that
  reached 150 of a 100 target read exactly the same as one that stopped on the
  number. The over-achievement survived only in the raw value and in the §3.6
  forecast, which is deliberately unclamped.
  
  The clamp is a §11 registry parameter now, `scoring.progressCeilingPct`. It
  defaults to 100, so nothing changes for a workspace that does not ask, and it
  may be raised as far as 200, which is the ceiling §6.4 already applies to KPI
  achievement. It is editable on the rhythm settings card like every other
  threshold.
  
  Raising it reaches the goal rollup as well as the key result. A goal holding one
  key result at 150% and one at 50% then reads 100% and looks complete while half
  the work was missed, which is stated in METHOD.md §3.1 so that a workspace
  raising the ceiling is accepting it rather than discovering it.
  
  A *maintain* key result is never above 100 whatever the ceiling. Its value is
  inside the stated band or on its way back, and there is no sense in which a
  value inside a band exceeded it.
  
  Scoring is untouched. A score is judged at the close by a person on the 0.0 to
  1.0 scale, and a key result that overshot is still one whose target was set too
  low.
  
  One defect fixed on the way: the KPI-linked progress path carried its own
  hardcoded cap of 100, so everything §6.4 measured above it was discarded and a
  KPI at 180 was indistinguishable from one at exactly 100 on the key result that
  linked to them.
  
  Progress bars still draw on a 0-to-100 track and understate a value above 100.
  That is a separate change.

- [#77](https://github.com/open-okr/open-okr/pull/77) [`c101d95`](https://github.com/open-okr/open-okr/commit/c101d95127f185bb978ad3002c7c978055c1e4b6) Thanks [@agungksidik](https://github.com/agungksidik)! - Single sign-on speaks SAML, natively.
  
  Until now it spoke OIDC only, and SAML was reached by putting a bridge in front
  of the instance. The reason recorded for that was that Better Auth had no
  native SAML. It does: `@better-auth/sso` is a first-party plugin, and it is
  mounted here.
  
  `sso_connections` stays the one place a provider is configured, with the tenant
  policy it has always carried, and the plugin's own table is derived from it.
  Which identity provider a workspace trusts is business data and belongs behind
  the same floor as the rest of it.
  
  Somebody arriving through a SAML provider lands in the workspace that
  configured it, at the level every other joining path gives, and their session
  behaves like any other. That is one path shared with OIDC rather than a second
  one that looks similar.
  
  Three fixes came out of driving a real assertion through, and two of them
  affect OIDC as well:
  
  Just-in-time provisioning was refused on every invitation-only instance, which
  is every instance after its first account. The assertion verified, the audience
  matched, and the account was refused at the last step. Configuring a provider
  now counts as the workspace saying it will admit the people that provider
  vouches for, which is what a directory token already meant.
  
  An arrival through a provider could end up in two workspaces: the right one,
  and a private one nobody opens. The path that resolves which provider somebody
  came through only recognised one of the two protocols.
  
  Configuring a SAML provider is the next release. This one makes the sign-in
  work; there is no screen for it yet.

- [#77](https://github.com/open-okr/open-okr/pull/77) [`51abffc`](https://github.com/open-okr/open-okr/commit/51abffc60b03e8c70da1b09eb7aa34daed77565a) Thanks [@agungksidik](https://github.com/agungksidik)! - A directory group becomes a space, and its membership becomes the space's.
  
  Adding somebody to a group in the identity provider puts them in the matching
  space here, with the access that space carries. Removing them takes it back.
  Renaming the group renames the space rather than making a second one.
  
  **Losing a group is not leaving the workspace.** Somebody removed from a group
  loses that space and keeps everything else; whether they are in the workspace
  at all is a separate question the user side of directory sync answers.
  
  **Deleting a group empties its space and leaves the space standing.** A
  directory saying who works together is not permission to put a workspace's
  goals, tasks and documents out of reach. Archiving a space stays an
  administrator's decision.
  
  A space with members needs somebody managing it and no directory says who, so
  the first person a group brings gets the role and a successor is appointed
  before the last manager leaves. An administrator can appoint whoever they meant
  to.
  
  Upgrading applies migration 0095.

- [#77](https://github.com/open-okr/open-okr/pull/77) [`935e984`](https://github.com/open-okr/open-okr/commit/935e984ba232dd11154baa2ff6d95a41a2196f53) Thanks [@agungksidik](https://github.com/agungksidik)! - Directory sync provisions and deprovisions people.
  
  The SCIM surface could create a user and list members. It had no way to say
  somebody had left, which is the thing a directory integration exists for.
  
  `PATCH`, `PUT` and `DELETE` on a user now answer the one question an identity
  provider asks, in the shapes Okta and Entra actually send it. Somebody removed
  from the directory is suspended: every session, token and grant of theirs stops
  working, and nothing they wrote is erased. Restoring them in the directory
  brings them back.
  
  **Suspension, never deletion**, and a workspace will not suspend its last
  administrator, so a directory cannot lock a workspace out of itself. That
  refusal answers 409 with the reason, rather than failing quietly.
  
  Provisioning now writes the way the rest of the product writes: accounts
  through the authentication layer, membership through the one member funnel,
  and an audit row for every change. Somebody the directory adds lands in the
  workspace that issued the token rather than in a new workspace of their own,
  and they can be provisioned on an invitation-only instance, which is the kind
  that runs a directory.
  
  Listing supports the `userName eq` filter providers use to reconcile. A filter
  this surface cannot read is refused rather than answered with the whole
  membership.
  
  Groups are not mapped to spaces yet.

- [#77](https://github.com/open-okr/open-okr/pull/77) [`a08637d`](https://github.com/open-okr/open-okr/commit/a08637d9a21b92a513d0bdd2dc4cc17877de1a19) Thanks [@agungksidik](https://github.com/agungksidik)! - A workspace can require everybody to hold a second factor.
  
  One-time codes and passkeys have been available since the first release, and
  until now a workspace could only ask people to use them. Switching the new
  setting on holds anybody without one in their security settings at their next
  page load: they can enrol, or sign out, and nothing else.
  
  **Off unless an organisation asks for it**, so nothing changes on upgrade.
  
  **The administrator who switches it on is held by it too.** That is what makes
  it a policy rather than a suggestion, and the setting says so beside the box.
  
  **An account managed by an identity provider is exempt.** The provider already
  enforces whatever second factor the organisation chose, and a second one here
  would be a factor the organisation cannot administer or reset.

- [#87](https://github.com/open-okr/open-okr/pull/87) [`04052e8`](https://github.com/open-okr/open-okr/commit/04052e8379fc22c12b165c94b7e48ce460d99ebc) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - Sessions can be scheduled from the browser, and a whole cycle can be booked
  in one press.
  
  Until now nothing on screen could create a session: after onboarding's first
  weekly session, nobody could hold a check-in, a monthly review or a quarterly
  review. The sessions screen and every space home now carry two controls:
  
  - **Book the whole cycle** books a weekly check-in every week, a monthly
    review every month and the quarterly review at close, on the day and time
    you choose, in the workspace's timezone. Anything already booked is kept,
    nothing is booked in the past, and pressing it again books nothing.
  - **Schedule one session** books a single ritual or a planning session.
  
  The cycle's phase 6 ("Run the cadence") is now computed: it says which space
  is missing which weeks, months or the closing review, and whether a decision
  has been recorded. A session's time with no offset is read in the workspace
  timezone, and its facilitator must be an active person in the workspace.
  
  New API action: `sessions.bookCycle`.

- [#93](https://github.com/open-okr/open-okr/pull/93) [`3214e24`](https://github.com/open-okr/open-okr/commit/3214e243a9ceb5dd171b93a202339574214541ef) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - The workspace's first-day setup can be opened again from admin, it counts its
  own steps correctly, and everybody is offered a short tour on their first visit.
  
  **Setup can be opened again.** Skipping every step of the first-day setup is a
  working start, and until now it was also a final one: once finished, the setup
  refused to appear, and nothing could bring it back. General in admin now has a
  Workspace setup card. Opening the setup again takes you straight to it, and
  every step shows what the workspace holds now, so skipping a step keeps the
  answer you already gave. While it is open, every administrator is sent to it
  from the Work Map until somebody finishes it. Opening it is audited and shows
  in the activity feed.
  
  **The count is right.** The setup said "Four questions" above a "1 / 5"
  counter, because a fifth step, the starting templates, was added and the
  sentence was not. The sentence now takes its number from the list of steps, in
  English and in Bahasa Melayu.
  
  **A tour on the first visit.** The Work Map offers each person a five-stop tour
  the first time they open it: the map itself, Review, check-ins, the cycle strip
  and ⌘K. It is a card on the page, under its heading, rather than an overlay,
  so nothing is blocked while it is showing, and each stop outlines what it
  names when that is on screen. Finishing it or ending it early is remembered for that person on
  every machine.
  
  **Everybody already in a workspace sees the tour once too**, the next time they
  open the Work Map after this upgrade, because none of them has seen it either.
  One press ends it for good.
  
  This release adds a column to `workspace_members` (migration 0106). It is
  nullable and additive, so the previous release reads the table unchanged
  during a rolling upgrade.

- [#74](https://github.com/open-okr/open-okr/pull/74) [`ed973cd`](https://github.com/open-okr/open-okr/commit/ed973cd271b5a6a8ada664e505d31fea291e7b96) Thanks [@agungksidik](https://github.com/agungksidik)! - The vendor can say something to everybody, and an operator can see what the
  instance is.
  
  A site message reaches every workspace, or only the ones it names. It carries
  a tone, a window it shows in, and whether people can dismiss it. **The window
  is required rather than optional**: a message with no end is a banner
  everybody learns to ignore, and the next one is ignored with it. A message
  whose window has passed stops showing without anybody removing it.
  
  **Dismissing belongs to the person, not to their membership.** Somebody in
  three workspaces meets an instance-wide sentence once and dismisses it once,
  and dismissing hides it from them and from nobody else.
  
  The message body is plain text. It reaches every customer at once, which is
  the worst place in the product to add a surface that needs sanitising, and a
  maintenance notice needs a sentence rather than a heading level.
  
  **The operator console lists the instance's own flags**, each with what it
  does, whether it is on, and whether that came from the database, the
  environment or the default. The list is derived from the settings registry, so
  a flag added later appears without anybody maintaining a second list. It is
  read-only there: changing a mail host from a console that lists every customer
  is a different job with a different blast radius.

- [#92](https://github.com/open-okr/open-okr/pull/92) [`1451c6f`](https://github.com/open-okr/open-okr/commit/1451c6f070e4630c59d0c0cc71601f18be930bc2) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - A space's home shows its goals and KPI trees, a member can set their own
  picture and bio, and a guest can be invited straight into one space.
  
  **The space home.** It now lists the space's open goals, drawn as the Work
  Map's table in the same tree order, and the KPI trees the space owns, drawn as
  the KPI tree screen draws them. Each shows only what the reader can open. Both
  cards load on their own, with a skeleton while they do and an error card of
  their own if they fail, so the rest of the page is never held up. A new read,
  `kpis.spaceTrees`, returns one space's KPIs grouped by tree and answers
  not-found to anybody who cannot open the space.
  
  **Your picture and bio.** Your own profile has a picture card and a bio in the
  shared rich text editor. The picture goes through the same upload path as
  attachments, so it is re-encoded and given a thumbnail, and it is shown to the
  rest of the workspace while it is your picture and withdrawn when you replace
  or remove it. `people.updateOwnProfile` now refuses an avatar that is not an
  image, or is a file you could not open, and an emptied bio is stored as no bio.
  An administrator still edits another member's name, title and manager, never
  their picture or bio.
  
  **Guests.** Admin, Invitations has an "Invite a guest" card: one address, one
  space, used once. Accepting makes a guest with nothing on the workspace itself
  and view on that one space, and a guest is not a seat. The join page tells the
  guest which space they will see. A guest put in a space by hand now sees it
  too, where before the space's standard group gave them nothing. A guest who
  signs in lands on the spaces they can open rather than on the Work Map.
  
  Migration 0101 adds `member_kind` and `space_id` to `invite_links`. It is
  additive, so the previous release keeps working during a rolling upgrade.

- [#77](https://github.com/open-okr/open-okr/pull/77) [`37f21d3`](https://github.com/open-okr/open-okr/commit/37f21d3fffae23dcff0a42d3ab2e61fee4f8e2d1) Thanks [@agungksidik](https://github.com/agungksidik)! - Single sign-on enforcement does something.
  
  The setting has been stored since single sign-on shipped and read by nothing,
  so a workspace that switched it on watched password sign-in carry on working.
  
  A connection that enforces, and lists at least one email domain, now claims
  those addresses. Somebody on a claimed address signs in through that identity
  provider and through nothing else: a password, a sign-up, a password reset and
  a passkey are all refused, and the refusal names the provider to use. That is
  the point of enforcing. The organisation controls the account, so removing
  somebody there removes them here, and a local credential outliving that
  removal is the one thing the setting exists to prevent.
  
  The refusal lands before the password is checked, so it says nothing about
  whether the password was right.
  
  **Enforcing with no domains listed does nothing.** An empty list means "every
  member of this workspace" where the column is read per workspace, and the
  sign-in page has no workspace, so applying it there would claim every address
  on the instance. The provider form says so, and says how to undo an
  enforcement that locked somebody out.
  
  Enforcement is read live, so turning it off takes effect on the next attempt
  rather than the next restart.

- [#77](https://github.com/open-okr/open-okr/pull/77) [`a5d1761`](https://github.com/open-okr/open-okr/commit/a5d17615f605ca3208ed03392e150e2141c8201d) Thanks [@agungksidik](https://github.com/agungksidik)! - Signing in through your organisation's identity provider puts you in your
  organisation's workspace.
  
  Until now it did not. A workspace configured a provider, an employee signed in
  through it, and they arrived alone in a brand new empty workspace of their own,
  never seeing the one whose provider they had just used. The workspace that owns
  the provider was read from the database at startup and then dropped before the
  sign-in path could use it.
  
  A first-time arrival now joins the workspace that configured the provider,
  through the same funnel an invitation uses and at the same level every other
  joining path gives. Nothing the identity provider sends decides what a new
  member may do.
  
  Somebody who is already a member is unaffected, and a repeat arrival adds
  nothing: the workspace feed records people arriving, not a directory checking
  its own work.

- [#77](https://github.com/open-okr/open-okr/pull/77) [`dd50d8a`](https://github.com/open-okr/open-okr/commit/dd50d8a23884a90d7a960d03921fdd6c0ea40141) Thanks [@agungksidik](https://github.com/agungksidik)! - A new workspace can start from a template instead of from nothing.
  
  The onboarding wizard now asks a fifth question: which starting template to
  apply, or none. Three are offered.
  
  **OKR starter cycle** is the smallest real quarter: one company objective,
  three key results pairing a lagging proof with two leading signals, a KPI wired
  underneath, and the first weekly session in the calendar.
  
  **Company onboarding** is a company's first quarter: three objectives across
  customers, product and how the company works, because a first set that is all
  product is the commonest way OKRs become a roadmap with a new name.
  
  **Product team space** gives a product team its own space, two team objectives
  and a KPI tree of its own.
  
  A template is not the demo. The demo seeds a whole cast with months of history
  for somebody deciding whether to use the product; a template seeds the smallest
  real thing a team can work from and then edit. Everything it writes is ordinary
  content, written through the same actions a person writes through, so the
  quality checks run and the audit trail names whoever applied it.
  
  Skipping the step starts empty, and that stays a first-class answer. A template
  applies once: a workspace that already holds goals is left alone.
  
  `docs/handbook/ways-of-working.md` maps four common shapes of organisation onto
  spaces, cycles and initiatives, and names the four ways people lay a workspace
  out wrong.

- [#74](https://github.com/open-okr/open-okr/pull/74) [`31d265c`](https://github.com/open-okr/open-okr/commit/31d265c11acdb90d39b2241554cb8fbf2092dea8) Thanks [@agungksidik](https://github.com/agungksidik)! - You can see who from OpenOKR is in your workspace, and end it from anywhere.
  
  A new Support access screen under Admin shows every request, every grant and
  every session that has ever run: who asked, why, who said yes, how long for,
  and how it finished. Answering a request means reading the reason first and
  then choosing how much access and for how long. Saying no is a real answer
  and it goes on the record.
  
  **While somebody from OpenOKR is inside, every screen says so.** The banner
  names them, says how long is left, and carries the reason they gave. It is the
  only banner in the product that cannot be dismissed, because the cost of
  forgetting it is that somebody outside your organisation is reading your
  objectives and nobody in the room remembers. Anybody who can see it can end
  the session, not only the person who granted it.
  
  **Somebody who is already in a workspace cannot be given support access to
  it.** They do not need it, and the two kinds of membership must not be
  entangled: ending a support session suspends the membership it created, and
  that must never be somebody's real one.

- [#74](https://github.com/open-okr/open-okr/pull/74) [`747d900`](https://github.com/open-okr/open-okr/commit/747d90097a311a59a424a64500889fd0196b6924) Thanks [@agungksidik](https://github.com/agungksidik)! - Support access, and the promise that comes with it: nobody from outside gets
  into a workspace unless somebody inside it says yes.
  
  An operator asks, giving a reason. A member who can manage access reads the
  reason and decides, choosing how long and how much. There is no path in this
  release that lets an operator into a workspace on their own, and that is the
  product promise rather than a setting.
  
  **A granted session is a real guest membership**, created through the same
  funnel every other joining path uses. From that moment the operator is
  answered by the same permission checks as anybody else: a space they were not
  given reads as not-found, a write above their granted level is refused, and a
  suspended workspace refuses them too. Nothing about support access is a
  special case in the authorisation code, because there is no second path for
  one to live in.
  
  A session may be granted at view, comment or edit, and never at full. Full
  includes changing who has access, so an operator holding it could extend their
  own session.
  
  **Access stops the moment the time is up**, on the next thing the operator
  does, rather than whenever a background job next runs. The job still runs, and
  what it does is tidy up: it closes the session and suspends the membership so
  the customer's screen stops saying somebody is inside.
  
  The workspace keeps the whole record: who asked, why, who said yes, how long
  for, when it ended and how. The grant and the end are both in the workspace's
  own audit trail.

- [#92](https://github.com/open-okr/open-okr/pull/92) [`faa60ee`](https://github.com/open-okr/open-okr/commit/faa60ee091baf131b2131dca4491ed0d0573334c) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - Teams checks in with a card, a space can post its digest to its own channel,
  and a rule sent to a channel somebody cannot be reached on falls back.
  
  **A rule's own channel is checked.** An administrator can send one nudge rule
  to one channel, for example Slack. A member who had never linked Slack still
  had that nudge sent to Slack, where it was dropped with nobody told. Now the
  rule's channel is checked the way a member's own is: when it cannot reach them,
  the nudge goes to their own channel, or by email when that cannot reach them
  either, and the nudge records why. Nobody is told to reconnect a channel the
  workspace chose for them.
  
  **Checking in from Microsoft Teams is one card.** Typing `checkin` with a goal,
  or pressing **Check in** on a reminder, answers with a card holding the three
  questions. Pressing **Publish** writes the check-in exactly as the browser and
  Slack do. It used to be four messages, one question at a time.
  
  **A space can post its weekly digest to Slack or Teams.** A space manager pastes
  the channel's ID into the space settings, for a provider the workspace has
  connected. Once a weekly session has closed, its coordinator presses **Post to
  the space's channel** on the session and the digest goes there once. The digest
  records where it went.
  
  This release adds a column to the nudges table. The upgrade runs it on its own.

- [#92](https://github.com/open-okr/open-okr/pull/92) [`d7c9af0`](https://github.com/open-okr/open-okr/commit/d7c9af0101fb42b328b0a0e18fda13f4a5e51eee) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - The annual cycle can be created and opened from the cycle screen, and the
  mid-cycle calibration can be recorded there.
  
  - The cycle screen's header has a Quarterly and Annual toggle, and a picker
    for any cycle in that horizon, including next quarter or next year before
    it starts. Creating a cycle makes one in the horizon you are looking at and
    opens it. Before this the screen only ever showed and made the quarter, so
    the annual frame's own cycle could not be reached.
  - Links inside the cycle screen stay on the cycle you opened, rather than
    falling back to the quarter.
  - Phase 6 has a form to record the one mid-cycle calibration a cycle allows,
    with its written reason, under the METHOD.md §7.6 rule in the method's own
    words. Once recorded, it shows the reason, who recorded it and when, and the
    form goes away. A closed cycle cannot be calibrated, and an unknown cycle is
    refused as "No such cycle" rather than failing on a database constraint.
  - Creating a cycle without naming a cadence keeps making quarters after an
    annual cycle exists. It used to follow the newest cycle, so opening next
    year's annual cycle turned the next "create" into another year.
  - The `cycles.create` action takes an optional `mode` (`annual` or
    `quarterly`), and `workflow.read` returns the cycle's `calibration`.

- [#93](https://github.com/open-okr/open-okr/pull/93) [`0947b35`](https://github.com/open-okr/open-okr/commit/0947b350b14654e4ba6167de8b62cece55b2a198) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - The audit trail can be read on the admin screen, not only verified and
  exported.
  
  Admin, then Audit trail, now lists the trail newest first, fifty rows at a
  time with older rows a click away. Each row says when (in the reader's own
  time zone, which the column names), who acted and through which channel when
  it was not the browser, the action, the target, and its position in the chain
  or that it is still waiting for one. A row's details stay out of the list; the
  export carries them and records that it was taken.
  
  - **One filter for the list and the file.** A date range, an action, a person
    or agent, and a target type. Show matching rows draws them; Export as CSV
    takes the same rows away. The person filter is new to the export too.
  - **Administrators only**, as the rest of the screen is. The read behind it,
    `audit.list`, is also on the REST surface, the command line
    (`okr audit list`) and the agent endpoint, refused below full access
    everywhere.
  
  The database gains one index, migration 0105, on the audit trail's workspace,
  time and id, so a page is read from the index rather than by sorting the whole
  trail.

- [#87](https://github.com/open-okr/open-okr/pull/87) [`17d7edd`](https://github.com/open-okr/open-okr/commit/17d7eddb85bd52c0f13da9d20da83d7063fd0c89) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - A managed cloud can now change a workspace's plan, and grant its first
  operator without writing SQL.
  
  Nothing wrote a tenant's plan or seat count after the tenant was created, so
  no seat limit could ever apply. An administrator now changes plan on Plan and
  seats, which also lists who holds each seat, and an operator sets a plan, or a
  seat count of their own, from the workspace's page in the console. Both follow
  one rule: a plan with fewer seats than are in use is refused, and the refusal
  names both numbers, because the product never chooses who loses access. The
  plan's AI allowance becomes the workspace's monthly AI cost budget.
  
  `pnpm cloud:operator --email <address> --granted-by <address>` grants the
  operator role and `--revoke` takes it away. Nobody grants it to themselves,
  once one operator exists only an operator may grant another, and every grant
  is written to the instance audit chain.
  
  Self-hosted instances are unchanged: they have no tenants and no plans.

- [#92](https://github.com/open-okr/open-okr/pull/92) [`4666cad`](https://github.com/open-okr/open-okr/commit/4666cadbc9f692cfce23b3f476ee2c8ab119841a) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - The command palette (⌘K) jumps to anything by its name, offers actions, and
  asks the semantic index when an AI provider is on.
  
  It used to jump to a KPI by its short code and to nothing else, it had no
  actions, and it never asked the semantic index. Now it lists what you typed in
  groups. **Go to** holds objectives, key results, KPIs, initiatives, tasks,
  documents, spaces, sessions, cycles and people whose name holds every word,
  even a word only half typed. **Search results** holds full-text matches.
  **Related** holds semantic matches, and appears only when an AI provider is on
  and finds something. **Actions** holds a new objective, the theme switch,
  "search everything for" and every page your sidebar and administration area
  offer, and it is all the palette shows before you type.
  
  Every result is one you can open. A session is offered only to someone in its
  space, a guest is offered only what it has been let into, and a KPI's short
  code no longer names the KPI to a guest. A key result, a comment or a check-in
  in the results now opens the page it belongs to, rather than a page that was
  not there.

- [#87](https://github.com/open-okr/open-okr/pull/87) [`0cf36eb`](https://github.com/open-okr/open-okr/commit/0cf36eb2d2defd1bb12741aef51eaada7f3431e3) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - The server no longer connects to its database as a superuser, the scheduler
  starts under the role it does connect as, and rotating the root key no longer
  breaks every stored AI key and chat credential.
  
  **The database role.** A Docker Compose install connected as the Postgres
  image's own role, which is a superuser. Postgres never applies row-level
  security to a superuser, so the rule that keeps one workspace out of another's
  rows was switched off on the default install. The product still checked access
  on every request, but the second line of defence was gone. The server now
  connects as `openokr_app`, which cannot bypass row-level security, and the
  image's own role is kept for migrations and backups. An existing install is
  moved over on its next `./openokr up` or `./openokr upgrade`, and its previous
  `secrets/app.env` is kept beside the new one.
  
  **The scheduler.** Under a restricted role the job queue could not create its
  own schema, so the scheduler logged one line and stopped: no Coach, no
  Champion, no reminders, no digests, no staleness sweep, while the instance
  reported healthy. A migration now creates that schema for the application
  role, and the scheduler lists workspaces through a read-only scan the database
  allows for exactly that purpose.
  
  **Saying so.** `/api/health` now reports whether the scheduler is running and
  whether the tenant floor is enforced, the status page counts a scheduler that
  failed to start as unavailable at once rather than two hours later, and
  `/admin/general` warns about either. The server also warns at boot when its
  database role bypasses row-level security, which a Kubernetes install pointed
  at a superuser can still do.
  
  **Root key rotation.** `./openokr rotate-key` re-wrapped the instance's own
  secrets and none of the ones workspaces hold. AI provider keys, chat channel
  credentials and single sign-on client secrets are sealed under the same key,
  and the command removes the previous key as soon as rotation finishes, so all
  of them became unreadable. Rotation now re-wraps every one, in every
  workspace, including deleted ones a restore could bring back. The command also
  waits for the instance to be serving again before it returns, as `upgrade`
  now does.
  
  **Restore.** `./openokr restore` ran a library file with no entry point and
  ignored the result, so migrations never re-ran after a restore. It now runs
  the container's own migrator, which also re-applies the application role's
  privileges that a restore does not carry, and fails loudly if it cannot.

- [#92](https://github.com/open-okr/open-okr/pull/92) [`9ee8bc9`](https://github.com/open-okr/open-okr/commit/9ee8bc9ea1f6652a7b9328adf8c9992566df35ff) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - A trusted email domain now lets people join.
  
  An administrator could list trusted email domains on the general card and the
  list changed nothing: no screen ever offered anybody the workspace. Now
  somebody whose confirmed address is at a trusted domain is offered the
  workspace when they sign in, and joins it with one press.
  
  - **With no workspace yet**, they land on a page listing the workspaces their
    domain admits, with a button to start one of their own instead. Sign-up no
    longer makes them an empty workspace of their own before they have chosen.
  - **With a workspace already**, the same offer sits at the top of their Work
    Map.
  - **An unconfirmed address is offered nothing**, because anybody can type an
    address at somebody else's company. Confirming an address needs mail, so an
    instance with no mail admits nobody this way, and the card now says so.
  - **A member somebody suspended or removed is not let back in** by their
    domain. Only an invitation does that. The seat limit applies as it does to an
    invitation.
  
  A trusted domain does not open registration on an invitation-only instance.
  
  The database gains one read-only policy, migration 0104, which lets a signed-in
  person find the workspaces trusting their domain by name and nothing else.

### Patch Changes

- [#83](https://github.com/open-okr/open-okr/pull/83) [`3cf2b24`](https://github.com/open-okr/open-okr/commit/3cf2b2406c9269b0320353d5a8c7f662e088a73d) Thanks [@agungksidik](https://github.com/agungksidik)! - A save that is refused now says so where you are looking, and keeps what you
  typed.
  
  On the rhythm and thresholds screen the reason a save was refused appeared at
  the top of the card. A card there runs to seventeen hundred pixels and its Save
  button stays in view as you scroll, so pressing Save near the bottom of one
  produced no visible response at all: the sentence was above the window, inside
  a card you were already in.
  
  Worse, the value that was refused did not survive being refused. Type 500 where
  the method allows 200, press Save, and the box was back to 200 before the
  refusal could be read, which left the message describing a number no longer on
  screen. That had been true since the card was first made editable.
  
  Three things carry the outcome now. A message appears in the corner of the
  window and clears itself. The field the method named is scrolled into view,
  given focus and marked as the invalid one, with the reason printed under it.
  And what was typed stays in the box, so fixing it means changing a digit rather
  than typing the whole thing again.
  
  The messages are new to the product generally, not only to this screen. The
  interface design has called for them since the beginning, for confirming a
  save, for offering an undo instead of an "are you sure" dialog, and for telling
  a screen reader that something happened. Nothing had ever built them.

- [#83](https://github.com/open-okr/open-okr/pull/83) [`b57cd69`](https://github.com/open-okr/open-okr/commit/b57cd69ebba776ecd0c6ec9fdf3d444889b906e8) Thanks [@agungksidik](https://github.com/agungksidik)! - The rhythm and thresholds screen saves a card at a time, beside the card.
  
  It held 123 fields under one Save button 7,785px below the first of them, which
  is 9.6 screens. Changing the check-in grace at the top meant scrolling past
  seven other cards to commit it, with nothing on the way to say the edit had not
  been saved. Each of the eight cards is now its own form with its own Save,
  Reset and confirmation, and the card header stays in view while you are inside
  that card, so the button that commits a field is on screen whichever field you
  are in.
  
  The rest of the product was measured against the same rule before this changed.
  Thirty screens, and the rhythm screen was the only one where a submit button
  sat more than one screen from a field it governs. The two next longest settings
  screens already saved a card at a time and are untouched.
  
  Leaving a page with unsaved edits now asks first. Nothing in the product did
  that before, so a click on the sidebar threw the typing away without a word.
  The question is asked once per page however many forms it holds, and it knows
  the difference between a value that changed and a value that was typed and
  typed back.
  
  ⌘⏎ saves the form the cursor is in, on any form that opts into it. The keyboard
  reference has listed that since the interface was designed and nothing bound
  it.

- [#91](https://github.com/open-okr/open-okr/pull/91) [`d0e6dff`](https://github.com/open-okr/open-okr/commit/d0e6dff29da927f358813478a8ce7fabdfc2a98a) Thanks [@agungksidik](https://github.com/agungksidik)! - A suspended member sees why, instead of a crash page that blames the app.
  
  Signing in as a member whose access had just been suspended landed on
  "Something went wrong. We could not load your workspace. This is our fault,
  not something you did." on every page they tried next. The reassurance was
  wrong: the access-scoped reads that load the app shell correctly refuse a
  suspended member by design, and nothing caught the refusal before it fell
  through to the framework's generic error boundary.
  
  The shell now catches that refusal once, in the one place every
  authenticated page shares, and shows "Access suspended" with what to do:
  sign out, or ask an administrator if this looks wrong.

- [#92](https://github.com/open-okr/open-okr/pull/92) [`864653a`](https://github.com/open-okr/open-okr/commit/864653aa140ab99804873a8375c7afaca782e2c7) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - Two form controls on detail pages now have names a screen reader can say: the
  quiet-hours start and end on a person's profile, and each member's role on a
  space's management card.
  
  Both were found by the accessibility scan, which now opens every goal, key
  result, space, session, task, person, initiative and document page on a real
  record, and the sign-in and password-reset pages signed out.

- [#96](https://github.com/open-okr/open-okr/pull/96) [`874953d`](https://github.com/open-okr/open-okr/commit/874953de7be23ca47074a9b4756f8ec590bba7ce) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - The Coach and the Champion see every goal that belongs to no space.
  
  A goal created through the API, the command line or an agent tool with a space
  but a different owner is stored in no space. The agents are given sight of
  spaceless goals by name, and that step checked the space the goal was sent
  with instead of the one it was stored in, so these goals were never checked
  or chased. They now are. Goals created on screen were not affected.

- [#92](https://github.com/open-okr/open-okr/pull/92) [`bc1ddb0`](https://github.com/open-okr/open-okr/commit/bc1ddb0767182eb882c632c89184baa6f60edf7b) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - Aligning a goal under a key result is now checked the way aligning it under a
  goal always was. The key result has to belong to a goal you can see, and a goal
  can no longer be placed under one of its own key results, or under a key result
  of a goal below it, which made the alignment tree loop.

- [#91](https://github.com/open-okr/open-okr/pull/91) [`1590555`](https://github.com/open-okr/open-okr/commit/1590555cebb9c5a750a8ee7864156fb96b13d0e0) Thanks [@agungksidik](https://github.com/agungksidik)! - A personal invitation now only admits the address it was issued to.
  
  Registering through an invitation link checked only whether the token itself
  was still usable, never which address it named. A single-use invitation
  issued to one person could be used by anyone holding the link to register any
  address, on an instance where registration is otherwise closed to everybody
  without one. The registered account also never joined the inviting
  workspace: it silently fell through to a brand new workspace of its own,
  which is the same failure by a different name.
  
  Registering now refuses an address a personal invitation was not issued to,
  and an address outside a shared link's allowed domains, the same rule already
  enforced for somebody accepting an invitation while signed in.

- [#78](https://github.com/open-okr/open-okr/pull/78) [`535a687`](https://github.com/open-okr/open-okr/commit/535a68702b0210b71653f4f0cc3036791b54684a) Thanks [@agungksidik](https://github.com/agungksidik)! - An OIDC provider can be configured, and the AI spend cap is read.
  
  Two writes and reads ran on a connection with no tenant setting, which is the
  same class the row-level-security fixes closed in single sign-on and directory
  sync. Postgres answered correctly both times and nothing said so.
  
  `POST /api/v1/admin/sso` inserted with `current_setting('app.workspace_id')`,
  which raises rather than returning null when the setting is absent, so **no
  OIDC provider could be created on any instance, by any route**. The admin
  screen posts there and nowhere else, so everything downstream of a provider
  existing was unreachable: the sign-in buttons, the workspace a person lands
  in, and enforcement. Creation moved into `packages/core`, takes the workspace
  it is given and runs inside it, which is the shape directory-sync tokens have
  had since they were fixed.
  
  The per-workspace AI run cost cap was read unscoped against `workspaces`,
  which carries the tenant floor, so the read matched nothing and the hardcoded
  default of 2 USD took over. `agentRunCostCapUsd` has never had an effect: a
  higher cap was ignored and so was a lower one, while the screen that sets it
  reported success. Zero now means zero rather than unset.
  
  No migration. An instance that had set a cap will find it applied on the next
  agent run.

- [#92](https://github.com/open-okr/open-okr/pull/92) [`89ce613`](https://github.com/open-okr/open-okr/commit/89ce613b2351bcde95efddc7484e5a710e84e886) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - A file attached to a goal, task, check-in or document now opens for everyone
  who can read that item, not only for the person who uploaded it.
  
  The list of attachments already showed the file to colleagues, but the
  download refused them. Taking the file off again makes it private to its
  uploader once more.

- [#87](https://github.com/open-okr/open-okr/pull/87) [`995442c`](https://github.com/open-okr/open-okr/commit/995442c4fd27080c1a798927a444181d53f75b03) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - Backups on Kubernetes now run, include your files, and are proved to restore.
  
  - The Helm chart's backup job named a Kubernetes Secret the chart never
    creates, so every scheduled backup failed before it started. It now reads
    the chart's own Secrets, and uses the database admin address when one is
    set.
  - It now backs up the uploaded files as well, when they live on the chart's
    own volume. Files in object storage are the bucket's to keep.
  - Verifying a backup with `helm test` could never succeed, because of two
    faults in the verify job's script. Both are fixed.
  - On Docker Compose, `./openokr restore` stops the application while it
    restores. Before, it could not replace a database the running server was
    connected to.
  
  A restore drill now runs in continuous integration on both deployment
  targets.

- [#83](https://github.com/open-okr/open-okr/pull/83) [`b146caa`](https://github.com/open-okr/open-okr/commit/b146caa7aec659452ba8a830d2ff34234321840e) Thanks [@agungksidik](https://github.com/agungksidik)! - A progress bar drawn beside a number above 100 now agrees with that number.
  
  A workspace may raise its progress ceiling as far as 200. Until now every bar
  was drawn on a 0-to-100 track whatever the value, so a goal at 150% filled the
  track completely and told a screen reader, through `aria-valuemax`, that 100 was
  the most there was, while the figure printed beside it said otherwise. Ten bars
  now carry their own maximum.
  
  Three of those had nothing to do with the ceiling and were wrong for longer.
  KPI achievement has been measured 0 to 200 since the KPI engine shipped, and the
  KPI grid, the KPI tree and the recovery board all drew it on a 0-to-100 track, so
  a KPI at 180 and one at exactly 100 produced the same bar.
  
  Four bars are deliberately unchanged: the cycle phase rail counts gates met out
  of the total and is genuinely a percentage, two draw a score on its own 0 to 1
  scale, and the last is the component gallery.
  
  Form controls are no longer smaller than 16px below the 768 breakpoint. Safari
  on iOS zooms the page when a smaller control takes focus and does not zoom back
  out, so tapping a field moved the layout somewhere nobody asked for.

- [#87](https://github.com/open-okr/open-okr/pull/87) [`f027ac1`](https://github.com/open-okr/open-okr/commit/f027ac147668a978085e9eefe27ec4acd98df74f) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - A blocker left open past its clock now lands in the review inbox of the person
  it was escalated to, marked "Escalated to you". The Champion always told the
  coordinator and then the sponsor, but it never recorded who a blocker had been
  escalated to, so it never appeared on their list of what they owe.

- [#87](https://github.com/open-okr/open-okr/pull/87) [`f51cec1`](https://github.com/open-okr/open-okr/commit/f51cec1b4542a3655571aa5acdc58145db793cdc) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - A blocker raised in a weekly session now reaches its owner's review inbox,
  and closing someone else's blocker or commitment needs access to their space.
  
  Every blocker, whether raised in a session's diagnose step or from a chat
  command, was stored without the goal it belongs to. The review inbox decides
  who may see a blocker by its goal, so it skipped every one of them, and
  "blockers you own" was always empty. New blockers record their goal, and
  `pnpm db:change` repairs the ones already stored.
  
  Resolving a blocker, handing it to someone else and closing commitments used to
  check only that the caller could edit something in the workspace. A member
  with no access to a space could act on its blockers and commitments if they had
  an id. Each is now checked against the space or goal it belongs to, and a
  commitment id that does not exist is refused rather than counted as closed.
  
  A blocker's 24-hour clock now follows the workspace's own blocker clock
  setting, as the board and the reminders already did.

- [#87](https://github.com/open-okr/open-okr/pull/87) [`9a626e6`](https://github.com/open-okr/open-okr/commit/9a626e6643748226f52d3c72b455d618699e9941) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - A calculated KPI no longer loses its value when a source is recorded mid-period.
  
  Recording a daily value on any day but the first of the month wiped the
  monthly total of any KPI calculated from it, because the recalculation looked
  for a month starting on that day, found none, and saved an empty value over
  the real one. Each calculated KPI now recalculates for its own period.

- [#93](https://github.com/open-okr/open-okr/pull/93) [`f1a359b`](https://github.com/open-okr/open-okr/commit/f1a359b972a1c06b1cf8281c9d7650722f110615) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - The server log no longer fills up with "The destination stream closed early".
  
  That error means a browser stopped reading a page before the server finished
  drawing it. Almost always it is the page's own prefetching, which reads a
  screen up to its loading state and cancels the rest, so nothing had failed.
  One test run logged more than a thousand of them, and real errors were lost
  among them. They are now left out of the log. Set `LOG_LEVEL=debug` to see
  them again, for example while checking whether a proxy is cutting responses
  off. Every other error is logged exactly as before.

- [#93](https://github.com/open-okr/open-okr/pull/93) [`49a262e`](https://github.com/open-okr/open-okr/commit/49a262e844d382c9c73c5daf50100e86c6b35563) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - The Slack, Microsoft Teams, WhatsApp and Telegram webhooks no longer tell a
  caller which organisations are connected. A request for a Slack workspace,
  Teams tenant, WhatsApp number or Telegram bot nobody connected used to get
  200, and one with a bad signature 401, so anybody could list the connected
  ones without holding a secret. Every refusal is now the same empty 401, never
  sooner than a quarter of a second, and Meta's subscription check the same 403.
  A provider pointed at this instance with no connection here will now report
  failed deliveries rather than silently succeeding ones.
  
  A Teams token is checked against Microsoft's published keys before anything
  is looked up, and those keys are fetched once a day instead of on every
  message.
  
  Operators can tell the refusals apart on a new counter,
  `openokr_channel_inbound_refusals_total`, labelled by provider and reason.

- [#92](https://github.com/open-okr/open-okr/pull/92) [`626fc14`](https://github.com/open-okr/open-okr/commit/626fc145bef3c44b58374c9fbbf557f189440a89) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - The weekly session's confidence round works in a space that has turned team
  voting off, and shows the room its votes once they are revealed.
  
  With voting off, the facilitator could not confirm any key result, because the
  confirm form only appeared after a vote the product refuses in that space, so
  the session could never leave its first step. With voting on, revealing the
  votes showed nothing: the room now sees each vote and the team average, and the
  facilitator's dial starts from the average.

- [#93](https://github.com/open-okr/open-okr/pull/93) [`ea76743`](https://github.com/open-okr/open-okr/commit/ea76743b21ceb2a968b7e98da4dd3385c234fb22) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - An instance that has not set up mail no longer writes password-reset links,
  address confirmations or invitation links into its log.
  
  The console mail driver, the default until `mail.transport` is set to SMTP,
  now logs only the masked recipient and the subject in production, which is
  enough to see that mail is being attempted and going nowhere. A development
  machine still logs the whole message, because there the link is how a
  developer signs in.

- [#78](https://github.com/open-okr/open-okr/pull/78) [`d419107`](https://github.com/open-okr/open-okr/commit/d419107a13f32a6ff97fb500c306f9c5e889a80e) Thanks [@agungksidik](https://github.com/agungksidik)! - A copilot answer survives the page that asked for it.
  
  An answer used to exist only inside one HTTP response. Closing the tab, or
  reloading, stopped the run with it: there was nothing still going and nothing
  to come back to, and a long question was simply lost.
  
  The answer is now produced by a background job. Asking records the question and
  an empty answer together, the job writes the prose, and the panel subscribes to
  it. Reloading subscribes again, and a conversation reopened later holds the
  answer whether or not anybody was watching when it landed. While a run is going
  the answer is marked as still being written, so an empty bubble is never
  mistaken for a finished one.
  
  A run that ends early says why, in the conversation: no provider configured,
  a provider that would not answer, or a workspace whose AI cost cap says a run
  may not spend. The cap is now read before a token is spent rather than after.
  
  An instance that drains its own queue gets all of this. One started with
  `OPENOKR_RELAY=off`, which is how an operator moves the relay to its own
  process, answers inline exactly as before.
  
  Upgrading applies migration 0098. Nothing needs configuring.

- [#92](https://github.com/open-okr/open-okr/pull/92) [`06a3d7b`](https://github.com/open-okr/open-okr/commit/06a3d7b22fb5d862299d57dd0dccd16b084b8c5f) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - A run started for a custom agent now actually runs, one task at a time, and
  the agents screen shows how far it got.
  
  Starting a run through the API, the command line or the agent endpoint wrote
  the run and nothing else, so it sat at its first task forever and said it was
  running. Starting one now queues its first step in the same save, and each
  step queues the next, so a run carries on after a restart from where it was.
  
  Every rule an agent works under holds at every step. It acts only inside the
  spaces, goals and KPI trees it is bound to. A write becomes a proposal in the
  review queue unless an administrator has let that agent write directly, and in
  sandbox mode nothing is saved at all. A read is never turned into a proposal.
  
  A run stops, with the reason written on it, when the agent is turned off, when
  the workspace has no AI provider for the agent's tier or its privacy settings
  let nothing reach the provider, when the per-run cost cap is zero, or when the
  workspace's or the agent's own AI budget is spent. The OKR Coach and the OKR
  Champion are unaffected and keep working with AI switched off.
  
  A task that names an action the product does not have is refused when the run
  is started, rather than failing later or waiting in the review queue as a
  proposal nobody could apply.

- [#94](https://github.com/open-okr/open-okr/pull/94) [`801efd0`](https://github.com/open-okr/open-okr/commit/801efd0dcc3ec6a10bf2f05a9544e3e49b115523) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - `pnpm db:change` runs the data changes again.
  
  pnpm 11 has a `change` command of its own, so the script opened pnpm's prompt
  instead of running anything. It now names `run` explicitly. This is the command
  an upgrade tells you to run to seal identity-provider tokens stored before they
  were encrypted.

- [#77](https://github.com/open-okr/open-okr/pull/77) [`bbdade3`](https://github.com/open-okr/open-okr/commit/bbdade311735a26f95050ec65760433b80382a93) Thanks [@agungksidik](https://github.com/agungksidik)! - Documentation an administrator can follow without reading the repository.
  
  `docs/README.md` is the index, sorted by who you are rather than by how the
  product is built: installing, administering, or running the practice.
  
  The install quickstarts cover one server with Docker Compose, Kubernetes with
  Helm, and the managed cloud, each written from what the deployment actually
  does. The Compose page says what the first `up` generates, what it waits for
  and why, which commands you will use afterwards, and the one consequence of
  changing the instance's address later.
  
  The administrator guide covers people and access, security, settings and
  operations: who can get in, what happens when somebody leaves, which settings
  change behaviour, and how backups, upgrades and key rotation work.
  
  The user guide, the OKR handbook and the API reference follow.

- [#77](https://github.com/open-okr/open-okr/pull/77) [`eb528f5`](https://github.com/open-okr/open-okr/commit/eb528f54b78fb63fc206c755c1961712e7f3e3fe) Thanks [@agungksidik](https://github.com/agungksidik)! - The browser suite reports its own flakiness.
  
  Vitest has recorded every test that passed only after a retry since the
  flakiness gate shipped. Playwright retries once in continuous integration and
  recorded nothing, so a spec that failed and recovered was indistinguishable
  from one that passed first time: a green run, no record, and nobody learns the
  spec is rotting.
  
  That is how two specs came to be failing about one run in four without anybody
  noticing until the suite was run eleven times in a single day.
  
  The end-to-end suite now writes the same report the unit shards do, with the
  same identifiers, so one merge and one quarantine list cover the whole
  repository. It is written locally too, because a report that exists only in
  continuous integration is a report nobody can check before pushing.

- [#93](https://github.com/open-okr/open-okr/pull/93) [`e3ae8cd`](https://github.com/open-okr/open-okr/commit/e3ae8cd803d6178c9b384c9c3b574e0d970599bc) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - The document editor has its base styles in production again.
  
  The editor used to add its own small stylesheet to the page as it opened, and
  the instance's security policy, which only allows styles it served itself,
  refused it. So every document page logged a policy error in the browser, and
  the editor ran without the rule that keeps runs of spaces as typed. The same
  rules now ship in the application's own stylesheet, and nothing is refused.

- [#87](https://github.com/open-okr/open-okr/pull/87) [`d7ae42e`](https://github.com/open-okr/open-okr/commit/d7ae42e657306b9f6edb6dd917840bd296ca6cd7) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - Every screen can be reached on a phone.
  
  Below tablet width the sidebar hides itself and a bottom tab bar takes over.
  That bar held four destinations and nothing else, so on a phone KPIs, Spaces,
  the board, initiatives, sessions, the scorecard and admin could only be reached
  by typing an address. A More tab now opens everything else, grouped as the
  sidebar groups it. It closes when you choose, when you press Escape, or when
  you tap outside it.

- [#76](https://github.com/open-okr/open-okr/pull/76) [`6fe3c39`](https://github.com/open-okr/open-okr/commit/6fe3c391316d074f45e9009de586356894664b08) Thanks [@bedddev](https://github.com/bedddev)! - One workspace's import no longer holds up everybody else's notifications.
  
  Side effects wait in a queue that was drained oldest first. That meant an
  import writing forty thousand rows put every other workspace's check-in
  reminder, digest and chat message behind forty thousand jobs, and nothing was
  misbehaving: the queue was simply first come, first served.
  
  The queue is now drained a turn at a time. Each workspace's oldest waiting job
  goes first, then each workspace's next, and so on. A workspace that just ran
  an import still gets through all of it, it just stops being first forty
  thousand times running.
  
  **Nothing slows down on an instance with one busy workspace.** When there is
  nobody to be fair to the order is exactly what it was, so a self-hosted
  deployment pays nothing for a problem it does not have.
  
  **The database connection pool has a ceiling it never had.** Every deployment
  has been running on the ten connections the database library picks by
  default. It is now twenty, which is the number this product measured itself
  needing, and `OPENOKR_DB_POOL_MAX` changes it.

- [#92](https://github.com/open-okr/open-okr/pull/92) [`235da5f`](https://github.com/open-okr/open-okr/commit/235da5f2bca0834be5c3526c0fc7fe23c0f3fe81) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - The FlowyTeam importer now names every source table it does not read.
  
  The connector checked that fifteen FlowyTeam tables existed, then read none of
  them and said nothing, and it never looked at time logs at all. So a company's
  objective discussions, KPI sharing, key result files, task categories, time
  logs, points and several settings were left behind without a word. That is the
  silent drop the importer is never supposed to make.
  
  Every run, the dry run included, now counts each of those tables for the
  company being imported and names every one that holds rows, with the count and
  a sentence on what it holds and why it is not imported yet. The summary at the
  top of the report says how many there are. A table with no rows for the company
  is not mentioned. Nothing new is read beyond one count per table, and the
  source is still opened read-only.
  
  Whether to import each of them is an open decision. The import guide lists them
  with where each could land in OpenOKR, or says there is nowhere for it.
  
  An instance missing a table nobody reads, such as an older FlowyTeam without
  discussion tables, is no longer reported as a domain that will import nothing.

- [#93](https://github.com/open-okr/open-okr/pull/93) [`cc5892b`](https://github.com/open-okr/open-okr/commit/cc5892b3029d87cc30055aa82787038425fe3df4) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - A guest who opens a screen that reads the whole workspace is taken to their
  spaces instead of an error.
  
  A guest is invited into one space. The Work Map already sent them to their
  spaces, but eight other screens, among them Check in, Cycle, Goals, KPIs,
  Scorecard and Activity, showed "We could not load" instead. Every one of them
  now does what the Work Map does. The goals on a guest's own space page, which
  failed to draw for the same reason, are drawn with the method's standard terms
  and progress ceiling.

- [#77](https://github.com/open-okr/open-okr/pull/77) [`0fd23fe`](https://github.com/open-okr/open-okr/commit/0fd23fe82bb08cc461efcf6d47c0306096e5f65c) Thanks [@agungksidik](https://github.com/agungksidik)! - The OKR handbook, the user guide and a generated API reference.
  
  The handbook is the practice itself, written for the person running it rather
  than for the person building the product: how to write an objective that is a
  destination instead of a delivery, how the four-step weekly session works and
  what the five blocker types are for, and what the quarterly cycle's eight
  phases, six publish gates and eleven review stages actually require.
  
  Every threshold it quotes is checked against the registry the product reads
  those numbers from, so the handbook cannot drift from what the product does.
  
  The API reference lists all 345 actions and is generated from the contract,
  which is itself generated from the action registry. The page cannot drift from
  the surface it describes.
  
  The user guide says what each screen answers, and the importer pages cover both
  importers and the rules they obey: read-only at the source, a dry run by
  default, safe to run twice, and nothing derived taken on trust.

- [#95](https://github.com/open-okr/open-okr/pull/95) [`9afd55e`](https://github.com/open-okr/open-okr/commit/9afd55e58318413d1e8249e1d12c138e240fbfac) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - The Helm chart upgrades a release installed before the virus-scan settings
  existed.
  
  `helm upgrade --reuse-values`, which the restore runbook uses, keeps the old
  release's values and does not add the chart's new defaults. The deployment read
  `scan.clamd.host` as a path, so on such a release the upgrade failed to render
  before anything rolled out. It now reads the block as optional, and a release
  without it simply has no scan, which is the default anyway.

- [#93](https://github.com/open-okr/open-okr/pull/93) [`ffc4622`](https://github.com/open-okr/open-okr/commit/ffc46229b30252c21b97c69bdb72381a498b9277) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - The tokens an identity provider issues when somebody signs in are now
  encrypted in the database.
  
  Signing in through an OIDC provider stores three tokens on the person's
  account: an access token, a refresh token and an ID token. They were kept
  exactly as the provider issued them, so a database dump or a backup carried
  live credentials for the organisation's own identity provider. They are now
  sealed under the instance's root key, the same way AI provider keys, channel
  credentials and SSO client secrets are, and opened only on the server when a
  sign-in or a token refresh needs them. `./openokr rotate-key` re-wraps them
  with everything else.
  
  Tokens stored before this release stay readable and are sealed by a data
  change. Run `pnpm db:change` once after upgrading, with
  `OPENOKR_ENCRYPTION_KEY` in the environment. An instance nobody has signed
  into through OIDC has nothing to seal. Until it runs, the next sign-in through
  the provider replaces a person's tokens with sealed ones anyway.

- [#92](https://github.com/open-okr/open-okr/pull/92) [`88cb67b`](https://github.com/open-okr/open-okr/commit/88cb67b6459a9ddbb7ed8ddac45a06b04885afc0) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - Assigning a task to the person who imported it, or handing them an imported
  initiative or space, no longer fails with a database error.
  
  An import gives the person running it edit access to what it creates, so it
  can finish writing the rows it started. Giving that same person the task or
  the initiative later granted the access a second time, and the database
  refused the duplicate. The existing grant is now raised to the higher level
  instead.

- [#92](https://github.com/open-okr/open-okr/pull/92) [`57e3531`](https://github.com/open-okr/open-okr/commit/57e35316e984c8c07ea3d95511705b6473bd9d90) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - An initiative's work now counts as linked work for every key result it serves.
  
  The board's "Linked work" figure used to count only the tasks that named a key
  result, so a key result moved by an initiative showed no work behind it. It now
  also counts the tasks of each initiative linked to the key result. A task linked
  both ways counts once, and a dropped initiative adds nothing.
  
  The rail beside the board lists the key results a card's initiative serves as
  well as the one the card names, and only those whose goal the reader can see.
  The Coach's divergence finding reads the same count, so an initiative whose
  tasks are all done behind a number that has not moved is reported the way
  finished tasks already were.
  
  The measured progress is unchanged. Linked work is still a separate figure
  beside it and never moves it, and the trend forecast still reads measured
  values only.

- [#87](https://github.com/open-okr/open-okr/pull/87) [`1252cd4`](https://github.com/open-okr/open-okr/commit/1252cd4b9ca26980634fd523af6e34d169d24072) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - A key result drafted on the cycle screen can now name its owner and due date.
  
  The quality check that asks for a baseline, a target, a due date and an owner
  failed on every key result drafted in the browser, because the form offered
  neither. New key results now default to the objective's champion and the
  cycle's last day, and existing ones can be changed in place. The starter
  template gives its key results an owner and a date too, so a fresh workspace
  no longer starts with failing checks. An owner must be a member of the
  workspace, and a due date must be a date. Agents and unclaimed members are no
  longer offered as champions, reviewers or owners.

- [#92](https://github.com/open-okr/open-okr/pull/92) [`e1a0ac1`](https://github.com/open-okr/open-okr/commit/e1a0ac1bce5361e81e9ca930b3881f9a0a2ddf79) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - The coach's KPI recovery messages now reach people in three cases where they
  went nowhere.
  
  A KPI measured only against its standing target, with no target recorded per
  period, never earned its recovery proposal: every period read as having no
  data. A KPI owned by the whole workspace told nobody when it left its
  corridor; it now tells the workspace's administrators. And the message saying
  a recovery can close was never sent, because the check that decided to send it
  also marked it as already sent; it now arrives once.

- [#77](https://github.com/open-okr/open-okr/pull/77) [`872db06`](https://github.com/open-okr/open-okr/commit/872db06a08a9b62ee2206db0907afb78e3903e63) Thanks [@agungksidik](https://github.com/agungksidik)! - Everything a release needs that was not already automated.
  
  The release machinery has been complete since the signing and provenance work:
  a tag verifies, builds, signs, publishes, verifies its own signature from
  outside, attaches a bill of materials and packages the chart. What was missing
  was the human half.
  
  `docs/runbooks/release.md` is the maintainer's runbook: where the version
  number comes from, what each job proves, and the three checks nobody else will
  do afterwards. A clean-machine install, an upgrade from the previous release,
  and a chart install into a cluster are the acceptance criteria for a launch and
  none of them is something a tag's own workflow can check.
  
  `docs/runbooks/announcement.md` is the text to post, marked where it changes.
  
  `docs/runbooks/good-first-issues.md` says what makes one, and lists the ones
  that are open. Tasks from the implementation plan are deliberately never
  labelled that way: they have a Definition of Ready and design gates behind
  some of them, and they are not an introduction to the project.
  
  A workflow now comments on a pull request whose commits are missing their
  sign-off, naming which commits and the two commands that fix it. The gate
  itself is unchanged; a first-time contributor used to meet a red cross on a job
  named "Licences and sign-off" and had to read the log to find out which of the
  two it was.
  
  Issue templates for bugs and features, with the security policy linked from the
  chooser so a vulnerability does not arrive as a public issue.

- [#78](https://github.com/open-okr/open-okr/pull/78) [`13c03d7`](https://github.com/open-okr/open-okr/commit/13c03d76edea4650a9f0abd513ef9a9182785fa7) Thanks [@agungksidik](https://github.com/agungksidik)! - The lifecycle helper works from Git Bash on Windows.
  
  `./openokr rotate-key` failed on a module that was never missing when it was
  run from Git Bash with Docker Desktop. That shell rewrites an argument shaped
  like an absolute path before handing it to a native program, so the path to the
  rotation script inside the container arrived with the shell's own install
  directory spliced into it. The same rewrite reached the restore path and both
  blob copies.
  
  Nothing about a Linux host changes: the two variables that switch the rewrite
  off are read by that one shell and ignored everywhere else.
  
  `deploy/docker/secrets/` and `deploy/docker/backups/` are ignored by git now.
  Running the documented backup command from inside a checkout used to leave an
  encrypted database dump, and an interrupted run used to leave the instance root
  key, sitting untracked where git offers to commit them.

- [#74](https://github.com/open-okr/open-okr/pull/74) [`93b4ec7`](https://github.com/open-okr/open-okr/commit/93b4ec7eaabe191afe9cf58f36946860624d98a3) Thanks [@agungksidik](https://github.com/agungksidik)! - Every screen tells you it is loading, including the ones that were not part
  of the application yet.
  
  Signing in, the first-run wizard, onboarding and following an invitation all
  left the page you came from on screen while the next one was fetched, with
  nothing moving to say anything was happening. Those screens draw their own
  card rather than sitting inside the sidebar and the topbar, and the rule that
  decided which screens got a loading state was tied to where an error would
  draw instead of to whether you were waiting. The two are separate questions
  and are now answered separately.
  
  The skeleton matches the screen it stands in for: a centred card where the
  screen is a centred card, a panel where the screen is a panel. A full-width
  placeholder resolving into a small centred form is a bigger jump than no
  placeholder at all.
  
  **Plan and seats and Support access have icons in the admin list.** They were
  the only two sections without one, so they read as two labels in a column of
  illustrated rows.

- [#83](https://github.com/open-okr/open-okr/pull/83) [`b3ea0fb`](https://github.com/open-okr/open-okr/commit/b3ea0fb3043146b025696cd649963adeec9cbf79) Thanks [@agungksidik](https://github.com/agungksidik)! - A member who did not create the workspace can open their own screens again.
  
  `settings.readWorkspaceSettings` returns the whole stored settings map and is
  declared full access, which is right for an admin card. Eight screens that are
  not admin screens called it: the Overview and the welcome screen for one
  onboarding flag, and the activity feed, a goal, the KPI list, a KPI, a person
  and a space for the workspace timezone.
  
  Provisioning gives every member edit on the workspace and reserves full for the
  founder, so a colleague who was invited rather than one who signed up met an
  error page on all eight.
  
  `settings.readForMember` is the fix. It is declared view and returns a named
  list of the two keys those screens need, rather than a filter over the stored
  map: a filter would make the next setting somebody adds member-visible until
  somebody noticed. The admin map is unchanged and still requires full access.
  
  The goal screen had a second cause of the same kind. It read every AI
  provider's configuration, including a masked key hint, to answer whether the
  draft assist could offer anything. `ai.readAvailability` answers that with one
  boolean and carries no provider, key, hint or status in it.
  
  A self-hosted instance published on any port other than 80 can also sign in
  now. The lifecycle helper wrote a bare `http://localhost` into the instance's
  public address whatever port it was serving on, and authentication then refused
  every browser sign-in because the origin a browser sends carries the port. The
  smoke test drives the instance with curl, which sends no origin at all, so it
  had always passed; it now checks the written address instead.

- [#92](https://github.com/open-okr/open-okr/pull/92) [`b257cd8`](https://github.com/open-okr/open-okr/commit/b257cd85713c0eff1278b0f94df3900d5c3de1c4) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - The "outcome, not output" check on an objective now reads its rows in the
  method's own order.
  
  The check is first match wins, and it asked about an output verb anywhere in
  the sentence second to last. So "Grow revenue so that we can launch in Europe"
  passed on its why and never met the warning the method gives for output
  language. The method's order now applies, with one agreed change to the
  method itself: a sentence shaped like an end state is recognised first, since
  the method's own example of one contains an output verb. The conformance check
  now compares every condition table in order, so the two cannot drift apart
  again.

- [#92](https://github.com/open-okr/open-okr/pull/92) [`4c2ae18`](https://github.com/open-okr/open-okr/commit/4c2ae18865a3958c337ac18f17cd41c7dd7024a3) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - A sent invitation no longer leaves its token and email address behind.
  
  The queue that sends email and chat messages kept every row forever, and an
  invitation's row held the raw invitation token and the invitee's address. Both
  are now removed the moment the email is sent, and a daily job deletes sent and
  given-up rows after 30 days. `outbox.retentionDays` (or
  `OPENOKR_OUTBOX_RETENTION_DAYS`) changes the window, and 0 keeps every row.

- [#83](https://github.com/open-okr/open-okr/pull/83) [`3cf2b24`](https://github.com/open-okr/open-okr/commit/3cf2b2406c9269b0320353d5a8c7f662e088a73d) Thanks [@agungksidik](https://github.com/agungksidik)! - The product no longer quotes document section numbers at the people using it.
  
  Forty-eight pieces of text across nine screens cited a clause: "The §4 lists",
  "Stretch honestly (§1 principle 4)", "The corridor defaults to the §11
  registry". Each now says the same thing in ordinary words. Counted in a browser
  before and after: twenty-five of these were visible across the product, and
  none is now.
  
  Four labels showed raw HTML in the middle of a sentence. A dropdown read "each
  member&apos;s own channel" where it meant "each member's own channel". All four
  are fixed, and the sweep found no others.
  
  The Malay translation of these lines still carries the English wording, as it
  did before. Writing the Malay is a separate piece of work rather than something
  to invent while renaming things.

- [#87](https://github.com/open-okr/open-okr/pull/87) [`9818deb`](https://github.com/open-okr/open-okr/commit/9818debb168a472bac9cf79aba6c299c19a3aa0a) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - Progress bars show their real value.
  
  Every progress bar on a page that came from the server drew completely full,
  whatever it stood for: a key result at 0%, a quality score of 79%, a cycle with
  no phase finished. The page's security policy blocked the inline width each bar
  carries, so the bar filled its track. The policy now allows inline style
  attributes, while style sheets still need the page's own one-time key.

- [#92](https://github.com/open-okr/open-okr/pull/92) [`532d127`](https://github.com/open-okr/open-okr/commit/532d12714f52232fc37cc024bebd73b60bca3585) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - An agent's proposal is now decided on the Review screen, by the person it is
  for.
  
  The Champion drafts an overdue check-in for a goal's champion, and proposes a
  recovery objective to a KPI's owner when the metric stays out of its corridor.
  Review listed the drafted check-in as something the champion owed, but its
  button opened the administrators' agent screen. Anybody who was not an
  administrator was turned away there, so they could not publish their own
  drafted check-in. The recovery proposal was worse off: it was listed for
  nobody at all.
  
  Each proposal now sits on its own row in Review. The row shows what applying
  it would change and whether AI wrote the words, with Apply and Dismiss beside
  it. A proposal the Champion sent you in a reminder is yours to decide, and
  nobody else sees it as something they owe. Any other agent proposal goes to
  the people who can edit what it changes. Applying runs the change in your
  name, with your own access, exactly as if you had made it yourself. Only a
  person can apply or dismiss a proposal: an agent never approves its own.
  
  The administrators' queue on the agents screen is unchanged. Both decisions
  are also available to the API and the command line as `proposals.apply` and
  `proposals.dismiss`.

- [#83](https://github.com/open-okr/open-okr/pull/83) [`7848026`](https://github.com/open-okr/open-okr/commit/7848026803de9c48f7cbd203a4e2a2a4f0f92253) Thanks [@agungksidik](https://github.com/agungksidik)! - A key result value that runs to nine digits can be read and typed.
  
  Values are stored in an unbounded `numeric` column and nothing in the product
  caps them, so a measure in rupiah, impressions or units has always been able to
  reach a hundred million. Nothing rendered one legibly. Every key result value
  was printed without grouping, which puts `100000000` one glance away from
  `10000000`, and the inputs that accept them were narrow enough to hold five of
  the nine digits somebody was typing.
  
  The goal detail, the check-in composer, the drafting board, the Work Map panel
  and the review's scoring evidence now group the integer digits of every value,
  baseline and target, and the six inputs are wide enough to show a whole one.
  
  Grouping is done by counting digits rather than by locale formatting, because
  locale formatting rounds to three fraction places by default and would have
  displayed a stored value the product never held.

- [#87](https://github.com/open-okr/open-okr/pull/87) [`4a54678`](https://github.com/open-okr/open-okr/commit/4a5467870b88a0ab485f65457349f0b3d2c953ad) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - The last phase of a cycle, "Review and learn", can now complete. It reads
  whether every key result has its score from the quarterly review and whether
  the review's retrospective holds a note, and names whichever is still missing.
  Before, it said both could not be read, on every cycle.

- [#92](https://github.com/open-okr/open-okr/pull/92) [`59a0292`](https://github.com/open-okr/open-okr/commit/59a0292db3d81a0dad2455f4f5df12015ffee8be) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - The Review count in the sidebar updates while a page is open. When somebody
  publishes a check-in you review, or an agent proposes something for you, the
  number changes within a couple of seconds instead of waiting for the next
  navigation.

- [#83](https://github.com/open-okr/open-okr/pull/83) [`2eeb168`](https://github.com/open-okr/open-okr/commit/2eeb1689f2bcf54734a61626d0b183b4c26b29ce) Thanks [@agungksidik](https://github.com/agungksidik)! - Rules, assists, schedules and channels are named on screen instead of being
  listed by their internal identifiers.
  
  The nudge volume page listed forty-five rules as `checkin.overdue` and
  `quality.sandbagging_draft`. It now says "Check-in overdue" and "Draft targets
  look too safe". The AI console names each assist by what it does for you rather
  than by the function that does it, the agents page says "Every week" instead of
  `schedule.weekly`, and a nudge in your inbox or your review queue says which
  rule sent it in words. So does the label a screen reader announces on each rung
  of an escalation ladder.
  
  Counted across twenty-seven screens: sixty-seven of these were on display, and
  three are now. Those three are not internal names. Two are what the AI models
  are called, and the third is part of a web address an operator has to copy
  exactly.
  
  Nothing about what is stored changed. Every message, every nudge record and
  every audit entry still carries its rule key, and the build still refuses a
  message that cites a rule the method does not define. One consequence worth
  knowing: an administrator reading the method document now matches a row on
  screen by its name rather than by its key.

- [#78](https://github.com/open-okr/open-okr/pull/78) [`1338c0a`](https://github.com/open-okr/open-okr/commit/1338c0aa63443e927e6171af45d302a99e6a0e90) Thanks [@agungksidik](https://github.com/agungksidik)! - A SAML provider can be configured from the admin screen.
  
  SAML sign-in shipped with no way to switch it on. The form wrote OIDC columns
  only, so a SAML connection could be created by editing the database and by no
  other means, and the sign-in path built for it was unreachable.
  
  Three things were in the way and all three are fixed.
  
  The screen now asks which protocol first and shows that protocol's fields.
  A SAML provider takes a sign-on URL, the identity provider's issuer and its
  signing certificate, with an optional audience. What may be stored is decided
  in one place for both protocols, so a refusal names the field to correct
  rather than the database constraint that caught it. A certificate is parsed
  rather than checked for a shape, because a string that is not a certificate
  satisfied the column and would have failed at somebody's sign-in instead. A
  certificate pasted without its BEGIN CERTIFICATE header is accepted, since
  that is how one copied out of a metadata document looks.
  
  Each SAML connection now prints this instance's entity ID, its reply URL and
  the address of its metadata document, which is what an identity provider asks
  for to configure its own side. The document is served after the next restart,
  the same restart every connection on this screen already waits for.
  
  The derived provider table the SAML plugin reads was never written by any
  running instance, so a configured provider could not answer a sign-in. It is
  brought in step at boot and again whenever a connection is created.
  
  Enforcement covers SAML. An enforced domain whose provider speaks SAML could
  not sign in by any route: the password was refused because enforcement claimed
  the address, and the provider was refused because the sign-in was read as a
  local factor. Both SAML paths are recognised now, and the sign-in page starts
  a SAML sign-in the way the protocol requires rather than sending it through
  the OIDC one.
  
  No migration.

- [#77](https://github.com/open-okr/open-okr/pull/77) [`eb4754f`](https://github.com/open-okr/open-okr/commit/eb4754f8f0c030adbf6f16520263035a37263d47) Thanks [@agungksidik](https://github.com/agungksidik)! - An identity provider's SCIM requests now reach the instance.
  
  Every request the directory sent was answered with a redirect to the sign-in
  page, which an HTTP client reads as success at status 200. A provider carries a
  bearer token and no cookie, and the SCIM surface had never been added to the
  list of paths that authenticate themselves. It authenticates itself: a request
  without a live token is refused with 401 in SCIM's own error shape.
  
  Provisioning also works on an invitation-only instance, which is the kind that
  runs a directory. The exception a directory-sync token carries was being set in
  one copy of the server's own code and read in another, so the registration rule
  refused every account with "this instance is invitation-only".

- [#92](https://github.com/open-okr/open-okr/pull/92) [`3b03980`](https://github.com/open-okr/open-okr/commit/3b039802898831b1ce761553929176d2125120fa) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - Search and the copilot's semantic search find a workspace's content after it
  has been moved in from an archive. The import wrote every goal, key result,
  KPI, document and comment, and nothing rebuilt the search or embedding index
  for them, so a moved workspace searched as empty until each item was edited.

- [#83](https://github.com/open-okr/open-okr/pull/83) [`3cf2b24`](https://github.com/open-okr/open-okr/commit/3cf2b2406c9269b0320353d5a8c7f662e088a73d) Thanks [@agungksidik](https://github.com/agungksidik)! - The rhythm and thresholds screen reads as settings rather than as the method
  document.
  
  Fifty-three small "METHOD §3.1" labels sat beside the parameters on that one
  page. They are gone. The sentence explaining what each number does stays, and
  several of those name their own section in passing, so the trail to the
  document is shorter rather than absent.
  
  Every place the screen said "canon" now says "default". It meant the value the
  method ships with, which is what "default" says to anybody who has not read the
  method document.
  
  A workspace can now add its own words to the six quality word lists the coach
  matches on. Type them into the box under each list, comma separated, and they
  are used alongside the built-in terms rather than instead of them. A team that
  runs in another language, or that says "rollout" where the list says "launch",
  can teach the coach its own vocabulary.
  
  The built-in terms cannot be removed, and that is the method's rule rather than
  a limitation of the screen: emptying a list would switch off the quality check
  that reads it, which is a change to the practice rather than a setting.

- [#87](https://github.com/open-okr/open-okr/pull/87) [`d525c02`](https://github.com/open-okr/open-okr/commit/d525c02e236c160cc298484950ce29c8fed756a8) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - A check-in submitted through Slack's form is no longer lost on an instance
  whose database role cannot bypass row-level security.
  
  Every Slack slash command opens a form, so the form is the main way to check
  in from Slack. Finding who submitted it asked the database without saying
  which workspace it was for, and a correctly restricted database answers that
  with nothing, so the check-in was dropped without a reply. It only worked on
  installs that ran as a database superuser, which none do now.

- [#93](https://github.com/open-okr/open-okr/pull/93) [`4c705f3`](https://github.com/open-okr/open-okr/commit/4c705f31e7b67b43f6054dee12c5b6ce258a8f3e) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - The single sign-on screen in administration lists only this workspace's
  connections.
  
  It used to list every connection on the instance, so an administrator could
  see the names, email domains and enforcement of other workspaces' identity
  providers. On a self-hosted instance with one workspace nothing changes. On an
  instance with several, each administrator now sees their own.

- [#77](https://github.com/open-okr/open-okr/pull/77) [`adb03dd`](https://github.com/open-okr/open-okr/commit/adb03ddb616ee33bceb34eab4af061310b404024) Thanks [@agungksidik](https://github.com/agungksidik)! - Single sign-on and directory sync can now read their own configuration.
  
  Both features shipped with a tenant-only row-level security policy on tables
  whose reads run before any workspace is known. The application role is
  `nosuperuser nobypassrls` and owns nothing, so those reads returned nothing on
  every instance with a correctly provisioned database:
  
  - No SSO provider was loaded at boot, so none was ever configured.
  - No SSO button appeared on the sign-in page.
  - Every SCIM request resolved to no workspace and answered 401, and a
    workspace could not issue a SCIM token in the first place.
  - Every directory sync log line was refused, and the refusal was swallowed.
  
  Nothing failed loudly, because a read returning no rows is what a correct
  tenant floor looks like from above.
  
  Two policies fix it, and both keep the floor rather than lifting it.
  `sso_connections` gains a select-only policy for the provider list, which is a
  list rather than a row and is the only key in the product that names no row;
  it opens that one table, cannot write, and the client secrets in those rows
  stay envelope-encrypted. `directory_sync_tokens` admits one row through the
  digest of the bearer token the caller already holds, the same arrangement API
  tokens have used since the REST surface shipped, and its write check stays
  scoped to the workspace.
  
  Upgrading applies migration 0094. An instance that had configured an identity
  provider and seen nothing happen will find it working after the next restart.

- [#98](https://github.com/open-okr/open-okr/pull/98) [`8b5f402`](https://github.com/open-okr/open-okr/commit/8b5f402415bb7f2faf456e12a710faa464390f72) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - A single sign-on connection can be changed, turned off and removed from Admin,
  Single sign-on.
  
  The screen could add a connection and nothing else, so correcting a client ID,
  replacing a client secret, taking a misbehaving provider off the sign-in page
  or retiring one meant somebody running SQL on the database. Each connection
  now has Edit, Turn off or Turn on, and Remove.
  
  Edit opens the same form, filled in. The client secret is never sent back to
  the browser: leave it blank to keep the stored one, or type a new one, which is
  sealed under the root key like the first. The provider ID cannot be changed,
  because it is part of the callback address your identity provider already
  holds, and the form says so.
  
  Turning a connection off takes it off the sign-in page and refuses sign-ins
  through it, and turning it on restores it as it was. Removing one asks first.
  Turning off or removing a connection that enforces single sign-on hands its
  domains back to passwords, and the question names those domains before it
  happens.
  
  Every change works from the next sign-in, within a few seconds, with no
  restart. Each is recorded in the audit log with the administrator who made it,
  and is available to the API and the command line as `sso.listConnections`,
  `sso.updateConnection`, `sso.setConnectionEnabled` and `sso.removeConnection`.
  
  A removed connection's provider ID can be used again. The database kept it
  taken, so a connection removed and added back under the same ID was refused.

- Single sign-on can be turned off in a frozen workspace, a new client secret
  can be set over the API, and removing a connection says it cannot be undone.
  
  - A frozen or read-only workspace still lets an administrator turn a single
    sign-on connection off and on again, so a compromised identity provider can
    be shut out during an incident. Editing or removing one still waits until
    the workspace is active.
  - The API and the command line now seal a new SSO client secret, or a new AI
    key, the same way the screen does. Before, they refused one.
  - The question before removing a connection now says plainly that it cannot
    be undone.

- [#93](https://github.com/open-okr/open-okr/pull/93) [`c419159`](https://github.com/open-okr/open-okr/commit/c419159086018fd88d5dc63794992c44d5736f82) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - A single sign-on connection works from the next sign-in, with no restart.
  
  An OIDC provider added on Admin, Single sign-on used to reach nobody until the
  server restarted, and on a deployment with several server processes, until
  every one of them had. The first SAML provider on an instance waited too, and
  so did its metadata document. A provider changed or removed in the database
  went on answering sign-ins the old way until the same restart.
  
  Each server process now checks for a changed connection every few seconds and
  rebuilds its sign-in client when it finds one. The process that saved the
  change sees it at once, and the others within a few seconds. A new client id,
  new endpoints or a new certificate are used by the next sign-in, and a removed
  or disabled provider refuses it. Nobody already signed in is signed out.
  
  Renaming the instance still reaches authenticator apps and passkey prompts at
  the next restart, as the General screen says.

- [#92](https://github.com/open-okr/open-okr/pull/92) [`83115ae`](https://github.com/open-okr/open-okr/commit/83115ae8575d1e4ca7185b2847e6bdd16df6213b) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - A dependency between two goals can be removed in the alignment studio.
  
  Linking two goals was one click on the canvas, and there was no way to take
  the link apart again. Selecting a goal now lists its dependencies by the other
  goal's title in the details panel, each with a Remove for anybody who can edit
  either end.

- [#87](https://github.com/open-okr/open-okr/pull/87) [`c878230`](https://github.com/open-okr/open-okr/commit/c87823099a1e7e053373da11c2e82e5f4a2790e8) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - The Docker image builds on a machine with 8 GB of memory or less.
  
  `docker build` ran out of memory during Next's own type check on a default
  Docker Desktop, and would have on the 4 GB server the install guide
  recommends, which since the guide changed is also where self-hosters build
  the image. The image build now skips that step. The same type check still
  stands in front of every image: continuous integration runs it on every change
  and on every release tag before an image is built.

- [#87](https://github.com/open-okr/open-okr/pull/87) [`2fca2c7`](https://github.com/open-okr/open-okr/commit/2fca2c7fd4b6d49e1c66eac7ffb0903f3375bb6b) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - The product no longer tells people that finished parts of it are missing.
  
  The first-run wizard, the first screen of every install, said chat channels
  and the AI provider were "Not in this build", long after both had shipped. It
  now says both are optional, which is true: channels are connected per
  workspace after setup, and every feature works without an AI provider. When a
  deployment-wide provider is configured, the wizard names it.
  
  The cycle screen said parts of each phase "arrive at" internal task numbers,
  and four other screens and one API description did the same. All of them now
  say plainly what could not be read, or what the screen is for.

- [#87](https://github.com/open-okr/open-okr/pull/87) [`597cb39`](https://github.com/open-okr/open-okr/commit/597cb399078dc18621007edfbfc7429e725fd8fa) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - The sign-in page no longer tells anybody which organisations use single
  sign-on on this instance.
  
  The list of single sign-on providers the sign-in page reads is public, because
  nobody on that page has signed in. It returned every enabled connection on the
  instance with its workspace id, its email domains and whether it enforces
  single sign-on, and it drew every one as a button. On a self-hosted instance
  that is one organisation's own sign-in page. On a shared instance it was a list
  of every customer and their identity provider.
  
  On a shared instance the page now shows no provider until you type your
  address, and then only the one for your domain. A self-hosted instance still
  shows its own providers straight away. Either way the page learns a provider's
  name and protocol and nothing else.

- [#87](https://github.com/open-okr/open-okr/pull/87) [`db64154`](https://github.com/open-okr/open-okr/commit/db64154f80e9f4468593a3c0d8efcf66fed091eb) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - `/api/status` answers an uptime monitor, as it was designed to.
  
  The status endpoint was built for monitoring and meant to need no sign-in, but
  it was never added to the list of addresses that do not. A monitor asking it
  was sent to the sign-in page, which answers with a 200, so every monitor
  reported a healthy instance whatever state it was in.

- [#92](https://github.com/open-okr/open-okr/pull/92) [`95d067b`](https://github.com/open-okr/open-okr/commit/95d067b41e88dd886181a4b53a6e90b9d96e3b24) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - The rhythm streak counts weeks in which a space held its check-in, as the
  method defines it, and a week with none breaks it.
  
  It counted every closed session of any kind, so a monthly review added a week
  and two check-ins in one week added two, and nothing ever broke it: a space
  silent for a month still showed its old number. A monthly or quarterly close
  also added a point of 0.0 to the weekly confidence trend, drawing a collapse
  that never happened. Weeks are now read in the workspace's own timezone rather
  than UTC.

- [#93](https://github.com/open-okr/open-okr/pull/93) [`523b9d7`](https://github.com/open-okr/open-okr/commit/523b9d7cf289970bf8d45182a1f717d5fbed465f) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - The browser tab shows an icon, a target in the brand indigo, and
  `/favicon.ico` no longer answers 404 on every page.

- [#91](https://github.com/open-okr/open-okr/pull/91) [`9e3b35b`](https://github.com/open-okr/open-okr/commit/9e3b35b3da28f984212ba1dbc857a37a4bbd87d4) Thanks [@agungksidik](https://github.com/agungksidik)! - The Work Map now shows a workspace's own renamed terms, not just the canon.
  
  Renaming Objective to Goal on Admin, Rhythm and Thresholds, Terminology
  saved and survived a reload, and every screen kept saying Objective
  regardless: the setting had a write path and no read path anywhere in the
  application. The Work Map and the goals explorer, which share the same
  table, now read it back. A single word gets an abbreviation from its own
  first letters (Objective stays OBJ, a rename to Goal reads GOA); a
  multi-word term takes one letter per word, the same rule Key result already
  read as KR.
  
  The other thirteen renameable terms, and the many other screens that name
  "objective" or "key result" outright, still read the canon word. Reading
  every one of them back is a larger piece of work across many screens, not
  attempted here.

- [#87](https://github.com/open-okr/open-okr/pull/87) [`bc78b67`](https://github.com/open-okr/open-okr/commit/bc78b67ab454f843d722d8cb2110ebd2fe51140f) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - Seven places that ignored a workspace's own thresholds now read them.
  
  A workspace can tune its method thresholds on the rhythm settings page, but
  several screens and writes used the standard values regardless:
  
  - A new KPI's healthy and watch corridor.
  - The confidence dial in a session. It also labelled 0.4 as "Low", which the
    method calls medium; its shortcuts are now Critical, Medium and High.
  - The goal page's strength score colours.
  - The weekly digest's blocker clock.
  - The impact a carried-forward item gets in the next cycle.
  - The number of annual strategies phase 0 asks for.
  - The status given to a check-in imported from FlowyTeam.

- [#83](https://github.com/open-okr/open-okr/pull/83) [`486c3b7`](https://github.com/open-okr/open-okr/commit/486c3b76b5097625cdf205d07e8e24aa288aa903) Thanks [@agungksidik](https://github.com/agungksidik)! - The branding card looks like a card, and the quality word lists can be read.
  
  The branding admin screen was still the scaffolding it shipped with: a label, a
  line break, a bare input and two browser-default buttons. Tailwind's reset
  strips an input's border, so the one setting on that screen appeared as grey
  placeholder text with no visible field to type in, and the two buttons appeared
  as two lines of plain text. The general settings card had the same problem and
  was rebuilt; this was the copy that pass missed.
  
  It now uses the same card, field and button treatment, with the two controls on
  one row rather than stacked, a swatch showing the colour in force, and a field
  that refuses a value the server would refuse anyway instead of appearing to
  save it.
  
  The rhythm and thresholds screen printed the six quality word lists as one
  paragraph of JSON: 148 terms of quotes, brackets and commas that ran past the
  right edge of the card. They are now six named lists with their term counts,
  and they wrap. They stay read-only, which was a deliberate choice rather than
  an omission.

- [#84](https://github.com/open-okr/open-okr/pull/84) [`58245ae`](https://github.com/open-okr/open-okr/commit/58245ae7a73b04b2dcc0097b5dbfcb598064c2e6) Thanks [@agungksidik](https://github.com/agungksidik)! - `pnpm uat:personas --inbox <address>` gives a fresh workspace the seven
  Northwind people as members who can sign in, for the manual acceptance test.
  
  Each persona joins through a workspace invitation the founder issues, the same
  path somebody clicking an invitation link takes, and the link is revoked when
  the run ends. Their addresses are plus-addresses on the one inbox given, so a
  password reset reaches a mailbox a tester can read. Titles, managers, spaces
  and goals are left empty, because those are what the test builds by hand.
  
  The command refuses a workspace that has anybody in it besides its founder and
  these seven, and a second run changes nothing. `deploy/staging/seed.sh` runs it
  against a Docker Compose stack started with the new `compose.staging.yaml`
  overlay, which publishes Postgres on the loopback address only.
  `deploy/staging/deploy-staging.sh` does the whole deployment in one command:
  it checks the host, builds the image from the same checkout, starts the stack
  with the overlay, and seeds once the setup wizard has run.
  
  `./openokr up` no longer refuses a second stack on the same host. Its check
  for "a database volume but no secrets" looked for the default project's
  volume whatever `COMPOSE_PROJECT_NAME` said, so a demo or staging stack beside
  a normal install was refused over a volume that belonged to the other one.

- [#78](https://github.com/open-okr/open-okr/pull/78) [`18ee23f`](https://github.com/open-okr/open-okr/commit/18ee23f145f0bc7d0952da0aedf171d68be2b7bc) Thanks [@agungksidik](https://github.com/agungksidik)! - Every sentence on screen is one message again.
  
  Moving the interface's text into the message catalogue split every sentence
  that had a number or a name in the middle of it. A catalogue held entries like
  "at", ", and" and "minutes. A shorter window means more messages", each one a
  piece of a sentence fixed in English word order by the markup around it. A
  translator handed "at" has no way to know what it attaches to, let alone where
  their own language puts it.
  
  193 messages now carry named holes, so a sentence is whole and the hole goes
  wherever the language needs it. Nothing a reader sees has changed, with two
  exceptions: on the device approval page and the workspace import card, one word
  that was styled inline is no longer styled, because styling a word inside a
  sentence means cutting the sentence at that word.
  
  A check refuses a new message rendered beside a value, so the pile cannot come
  back.
- Updated dependencies []:
  - @openokr/adapters@0.1.0
  - @openokr/agents@0.1.0
  - @openokr/config@0.1.0
  - @openokr/core@0.1.0
  - @openokr/method@0.1.0
  - @openokr/ui@0.1.0
