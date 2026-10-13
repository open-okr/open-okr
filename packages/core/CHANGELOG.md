# @openokr/core

## 0.3.0

### Patch Changes

- [#123](https://github.com/open-okr/open-okr/pull/123) [`13d99be`](https://github.com/open-okr/open-okr/commit/13d99be2b275b8b46f320551e41b3515d252c6d1) Thanks [@agungksidik](https://github.com/agungksidik)! - The password reset and email confirmation mails have an HTML part in the
  product's layout, beside the plain text, and are written in the instance's
  language. One renderer builds both parts from the same content, so they
  cannot differ; it escapes every value and fetches nothing, so it works on an
  air-gapped instance. The other mails move to it next.

- [#120](https://github.com/open-okr/open-okr/pull/120) [`ad8a192`](https://github.com/open-okr/open-okr/commit/ad8a1929697ff892f88d2b85568f152064e5a3cc) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - Every admin, account and operator field is labelled and sized for what it holds.
  
  The operator's reasons and the site message grow with the text and count near
  their limit. Numbers (a token's expiry, a link's uses and expiry, a budget,
  a model's context window and costs, a tier's temperature and token limit,
  the ladder rungs, the rhythm thresholds, a plan's seats) are number fields
  in the reader's locale, with their unit beside them where they have one.
  Keys and passphrases are masked with a way to show what was typed. The nudge
  ladder's rungs are named ("Then the coordinator", in days) where their keys
  were shown, and each term label says which term and number it is.
  
  A link's expiry is now at most 365 days. API clients sending
  `invitations.createPersonalLink` or `invitations.createWorkspaceLink` with a
  longer expiry get a refusal.

- [#121](https://github.com/open-okr/open-okr/pull/121) [`ddbdb29`](https://github.com/open-okr/open-okr/commit/ddbdb294dc95416d9e1f9c15ef7dd1569e84cc45) Thanks [@agungksidik](https://github.com/agungksidik)! - The AI screen tests a provider key when it is stored, and on request.
  
  Every key stayed "unverified" for good, working or not, so an administrator
  could not tell a working key from a wrong one. Storing a key now sends one
  request of a few tokens, carrying no workspace content, to the provider's
  cheapest model: an answer marks the key verified, a 401 or 403 marks it
  invalid, and a provider that cannot be reached leaves it unverified and says
  so. "Test the connection" runs the same test again.

- [#121](https://github.com/open-okr/open-okr/pull/121) [`89a8ef7`](https://github.com/open-okr/open-okr/commit/89a8ef7d66ed717b2fb72d9edde62f8423897e47) Thanks [@agungksidik](https://github.com/agungksidik)! - Archiving a cycle asks first, and an open cycle that still holds goals is
  closed before it can be archived.
  
  One click archived the current cycle with no question, and a second click
  archived the next one, leaving the workspace with no cycle and an empty work
  map; nothing on any screen brings an archived cycle back. The button now asks
  for confirmation, and the server refuses to archive a cycle that has goals
  and has not been closed on the scorecard, so its result is recorded first.
  A cycle with no goals still archives straight away.

- [#120](https://github.com/open-okr/open-okr/pull/120) [`ad52c4d`](https://github.com/open-okr/open-okr/commit/ad52c4d98758caf45cea2e3540d850433c858f3f) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - Moving a workspace with its archive keeps its own AI models and every
  revision of an agreed annual frame.
  
  The import wrote a list held in a Postgres array column as JSON, which the
  column refused, and counted the row as skipped. A workspace's custom AI
  models and each frame revision, with its written reason, were left behind.
  The import now asks the database which of a table's columns are arrays and
  writes those as arrays, so a column added later is written too.

- [#120](https://github.com/open-okr/open-okr/pull/120) [`7eaa3a9`](https://github.com/open-okr/open-okr/commit/7eaa3a95e1652c13c4008b4aebac79f190f870e2) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - Moving a workspace with its archive now points every mention and attachment
  at the new workspace's members and files.
  
  The import rewrote them in some rich text and not in the rest: a mention in
  a check-in narrative, the annual frame, a cycle's baseline health or its
  capacity cuts, or a KPI tree's description still named the member from the
  workspace it came from. Each of these is now rewritten, as is what an agreed
  annual frame held before a revision. A test reads the database and fails
  when a table the archive carries gains a rich text column the import does
  not rewrite.

- [#121](https://github.com/open-okr/open-okr/pull/121) [`6b1d4a8`](https://github.com/open-okr/open-okr/commit/6b1d4a8673551d518dff5c3f4908a8b2fcabed79) Thanks [@agungksidik](https://github.com/agungksidik)! - A goal's champion and reviewer are told about comments and changes on it
  without pressing Watch.
  
  Comment notifications went to subscribers only, and nobody subscribed the
  people who answer for the goal, so a question left on an objective reached
  nobody unless it mentioned them. They now count as watching from the start,
  the Watch control says so, and turning it off keeps them out. Turning a watch
  back on after turning it off also works again: it used to stay off.

- [#125](https://github.com/open-okr/open-okr/pull/125) [`1a89c72`](https://github.com/open-okr/open-okr/commit/1a89c72bedafc2793d70cd11b24e1853f213706b) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - The chat `status` command answers with all three things its help promises:
  the goal's health, how far it is, and when its next check-in is due.
  
  It read field names the goal does not have, so it answered with the health
  alone, written as a code ("health off_track"). It now says, for example,
  "health off track, 42% of the way, next check-in 2026-10-16".

- [#121](https://github.com/open-okr/open-okr/pull/121) [`4c56446`](https://github.com/open-okr/open-okr/commit/4c56446682dd38d2001f8472c275c1cbc39965ca) Thanks [@agungksidik](https://github.com/agungksidik)! - An operator's plan catalogue can be set with `OPENOKR_CLOUD_PLANS`.
  
  The plans offered on the operator console were read from a settings row that
  nothing wrote and no page described, so a cloud instance offered Free and
  nothing else. The variable now bootstraps the catalogue as JSON, a stored
  catalogue still wins, and the cloud install page says how.

- [#120](https://github.com/open-okr/open-okr/pull/120) [`ad1f083`](https://github.com/open-okr/open-okr/commit/ad1f083d07829f761422dafbae254ddce81c55e2) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - The brand colour can be picked, and each channel's form names its own fields.
  
  Branding has a colour picker beside the hex box, and a colour that reads as
  red, amber or green is refused as it is picked rather than after Save. Reset
  to defaults works whatever the box holds.
  
  Each channel's connect form now asks for what its provider calls things:
  Slack's Bot User OAuth Token, Signing Secret and Workspace ID; Teams'
  Application (client) ID, client secret and Directory (tenant) ID; WhatsApp's
  access token, app secret, verify token and phone number ID; Telegram's bot
  token, webhook secret and bot ID. Ids are shown as typed, Teams' App ID
  included, which was masked. WhatsApp's verify token has its own box: it was
  typed after the app secret in one box, split on a space. The hints are
  translated.

- [#122](https://github.com/open-okr/open-okr/pull/122) [`3e6780e`](https://github.com/open-okr/open-okr/commit/3e6780e6538e32ea9c37e439f75a369623eb249f) Thanks [@agungksidik](https://github.com/agungksidik)! - The session schedule form marks the company space, whose quarterly review
  grades every objective in the cycle, the workspace's own included. Nothing
  said so, so a review was booked in another space and the company's
  objectives looked as if they could not be scored. `spaces.list` returns
  `isCompany` for each space.

- [#121](https://github.com/open-okr/open-okr/pull/121) [`8286bd1`](https://github.com/open-okr/open-okr/commit/8286bd1afe19f4d39ef6f31bf891b5c5d722f1d7) Thanks [@agungksidik](https://github.com/agungksidik)! - Confirming a dependency you do not provide says whose call it is.
  
  Somebody outside the providing space who pressed Confirm was told "No such
  space, or you do not have access to it." about a space named on the same
  row. They are now told that only that space's people can confirm what they
  will deliver, and that they can ask them or name a risk owner.

- [#120](https://github.com/open-okr/open-okr/pull/120) [`f016bdb`](https://github.com/open-okr/open-okr/commit/f016bdb9bb7a078b80f9d43c57354ea363bed5ea) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - Dates say when they are.
  
  Due dates, cycle and planning-session dates, a new cycle's date, task and
  board due dates, a recovery's due date and a session's actions now say the
  date in words beside the field: "in 12 days", "today", "3 days ago", or
  "Sep 2027" for a date further away.
  
  A key result due outside its cycle is warned about in the OKR list and drawer,
  and is still saved: nothing in the method forbids it.
  
  For API clients: a task's due date and an initiative's start and end must be
  written as YYYY-MM-DD, as a key result's due date already had to be. Anything
  else is refused with a message.

- [#120](https://github.com/open-okr/open-okr/pull/120) [`c4505e0`](https://github.com/open-okr/open-okr/commit/c4505e06aa128f848173cf6c431388426683934f) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - Date ranges say when they do not fit.
  
  An initiative's start and end, a member's leave, a space's holidays and the
  audit filter are now one range: the end's calendar opens from the start, and
  an end before the start says so under the end straight away.
  
  An initiative that ends before it starts is refused with a sentence instead of
  a database error, on creation and when either date changes. This applies to
  API clients too.
  
  Imports no longer fail on such an initiative. Both the FlowyTeam and the
  spreadsheet importer keep its start, leave out the end, and name each one in
  the report, with both dates.
  
  The audit filter's days now run midnight to midnight in the workspace's
  timezone, the zone the rows are shown in, instead of in UTC. The screen says
  which zone.
  
  A form that adds one row after another (a key result, a KPI reading, a task,
  an initiative) is empty again after each save. Before, a date, a number, a
  confidence or a unit typed into the last row stayed in the form and was sent
  with the next.

- [#120](https://github.com/open-okr/open-okr/pull/120) [`553c840`](https://github.com/open-okr/open-okr/commit/553c840c2ab7fcae6bf08b11d9fe1ec7f0ede131) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - People, spaces, roles and admin settings are found by typing, and no id is pasted.
  
  A member's manager, a leave delegate, adding somebody to a space, a new
  space's manager, a member's role, the audit filter's "who", a guest's space
  and a reminder's channel template are now lists you can search.
  
  Three admin fields asked for an id or a model name to be pasted or typed. An
  agent's scope now finds its space, KPI tree or goal by name (goals by
  searching, since a workspace can hold thousands). A budget names whose it is,
  the whole workspace, a person or an agent, in one choice, and the budget
  list shows that name instead of part of an id. A tier's model is chosen from
  the catalogue on the same page, and the choice carries its provider.
  
  For API clients: `search.entities` takes an optional `kinds`, to search only
  some kinds of thing.

- [#120](https://github.com/open-okr/open-okr/pull/120) [`21c5a00`](https://github.com/open-okr/open-okr/commit/21c5a004c4f32901beda610a771705d8bd218ff2) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - People, spaces, cycles, key results and KPIs are found by typing.
  
  On the OKR list, drawer and diagram, the goal page and decompose, choosing a
  champion, an owner, a space, a cycle, a key result or a KPI is a list you
  can search, not a long drop-down. Type part of a name, or a member's title or
  a KPI's short id, and choose with the mouse or the keyboard. A member is shown
  with their initials and title, and an agent is marked as one. Somebody who has
  left the directory still shows as who they are.
  
  In a workspace of more than two hundred members, the list asks the server as
  you type rather than loading everyone.
  
  For API clients: `people.directory` takes an optional `search` (words found in
  a member's name or title), `kinds` and `limit`.

- [#120](https://github.com/open-okr/open-okr/pull/120) [`e43d670`](https://github.com/open-okr/open-okr/commit/e43d6700f63c9cca65fa15f0b9fe0679eff8b228) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - Every field in the product is now drawn the same way, and the search page no longer breaks on a long phrase.
  
  The last screens move onto the field kit: spaces, people, search and the
  command palette, the board, check-ins, the copilot, documents, initiatives,
  the OAuth consent, the scorecard, tasks and the workspace switcher. A space's
  mission grows with the text. The search boxes are search fields, held to the
  length the search takes, and the search page cuts a longer phrase from its
  address to that length instead of failing to draw.

- [#121](https://github.com/open-okr/open-okr/pull/121) [`2edd845`](https://github.com/open-okr/open-okr/commit/2edd845d18662a0647efbb0e97696239764d09bb) Thanks [@agungksidik](https://github.com/agungksidik)! - A new objective can be filed under a space when it is drafted.
  
  The drafting form on phase 4 created every objective with no space, so a
  space's weekly session had no key results to vote on, its page listed no
  goals, and a quarterly review in it could grade nothing. The form now has a
  space picker, and "Open drafting" on a space's page starts it on that space.
  
  Filing a new objective under a space asks edit on that space, the same
  question moving one there already asks, and refuses a space that is not in
  the workspace.

- [#122](https://github.com/open-okr/open-okr/pull/122) [`37a1fdc`](https://github.com/open-okr/open-okr/commit/37a1fdc1cbb3369deefc3985cc31e82ec40f5276) Thanks [@agungksidik](https://github.com/agungksidik)! - The account the setup wizard creates is verified, so an instance with mail
  configured before its first run no longer locks its operator out.
  
  With mail configured, a verified address is required to sign in, and the
  wizard's account was created unverified: finishing setup failed, and every
  later sign-in was refused with the same words as a wrong password. The first
  account is now created verified and signed in straight away. The data-change
  `0025_verify_first_account` verifies the earliest account on an existing
  instance (run `pnpm db:change`). A correct password on an unverified address
  now says to open the confirmation link instead of "Those details did not
  match".

- [#120](https://github.com/open-okr/open-okr/pull/120) [`58dda46`](https://github.com/open-okr/open-okr/commit/58dda46ac532e1c57dc60f87676c8509f03e7b9a) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - The cycle's written fields can be formatted: the annual frame's mission,
  vision, strategy and what is not being done, phase 2's three baseline health
  columns, and phase 5's record of what was cut.
  
  Each is the same small editor as comments and check-ins, and opens on what
  was written, formatting included. Before, the frame and the baseline columns
  opened as plain text, and saving them turned any formatting written through
  the API back into plain paragraphs. Where the cycle is read rather than
  edited, the text is shown as it was written.
  
  Baseline health columns and what was cut take up to 4000 characters, as they
  did. The limit is now held by the server as well as the screen, so
  `workflow.setBaselineHealth` and `workflow.setCapacityNotes` refuse a longer
  document, saying how long it is. `workflow.read` also returns the stored
  documents, as `baselineHealthDocuments` and `capacityCutsDocument`, beside
  the plain text it already returned.

- [#120](https://github.com/open-okr/open-okr/pull/120) [`f1ef43b`](https://github.com/open-okr/open-okr/commit/f1ef43b8d9d92fec98a794dcd482eb57e90805e3) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - A goal's retrospective, an initiative's description in the decompose panel,
  and what the number does not show in a quarterly review can be formatted.
  
  All three use the same small editor as comments and check-ins: bold, italic,
  strikethrough, code, bulleted and numbered lists, and links. The closed goal
  and the review stage show what was written with its formatting, where they
  showed one line of plain text.
  
  The decompose panel still takes up to 1000 characters for each description.
  Near the limit the field counts what is used, and past it says how much to
  take out, and Create waits until it fits. The limit applies to that panel
  only: an initiative created through the API or an import keeps its whole
  description.
  
  A retrospective of nothing but spaces is refused, as an empty one always was.

- [#122](https://github.com/open-okr/open-okr/pull/122) [`d7d812d`](https://github.com/open-okr/open-okr/commit/d7d812dfac7a928908ee5e1eda969fa80f0ca93f) Thanks [@agungksidik](https://github.com/agungksidik)! - The inbox says who commented and what. A comment's notification carried no
  activity, so it read "Something new here, which you follow." It now reads,
  for example, "Priya Raman · Commented on a goal: Blocked?". Every notification
  a write makes in its own words is linked to that write's activity.

- [#122](https://github.com/open-okr/open-okr/pull/122) [`760b0a7`](https://github.com/open-okr/open-okr/commit/760b0a7d5cd65266688d9770afaf87394894bd0b) Thanks [@agungksidik](https://github.com/agungksidik)! - A KPI's healthy and watch thresholds follow the workspace unless the KPI sets
  its own, so moving them on Rhythm recolours existing KPIs.
  
  Each KPI used to copy the workspace's thresholds when it was created, so a
  change on /admin/rhythm reached only KPIs created afterwards. Migration 0139
  makes both columns optional, where empty means the workspace's current value,
  and changing either threshold recomputes every KPI that follows it. A KPI
  given its own line through `kpis.update` keeps it; sending null returns it to
  the workspace. Run `pnpm db:change` after upgrading: data change
  `0026_kpi_corridor_follows_workspace` clears every stored line that equals
  the workspace's current one or the canon's 90 and 70, and rereads the band
  of each KPI judged on the ratio.

- [#121](https://github.com/open-okr/open-okr/pull/121) [`9229546`](https://github.com/open-okr/open-okr/commit/9229546ea329e52152c9bc18ddc3072ca22b026a) Thanks [@agungksidik](https://github.com/agungksidik)! - A mail relay without TLS can be used when somebody chooses to.
  
  The instance always required STARTTLS, so a local relay such as Mailpit,
  which the staging guide recommended, failed every send. A new instance
  setting, `mail.requireTls` (`OPENOKR_MAIL_REQUIRE_TLS`), turns that off. It
  stays on by default, and the staging guide says when not to turn it off.

- [#123](https://github.com/open-okr/open-okr/pull/123) [`e00d918`](https://github.com/open-okr/open-okr/commit/e00d9185b2fda42956f56911e019724816e430a9) Thanks [@agungksidik](https://github.com/agungksidik)! - Agents built on the current MCP SDK can connect and read the tool list.
  
  The handshake echoed a protocol version the endpoint then refused on the
  next request, so a client asking for 2025-11-25 failed right after
  connecting; it is now answered with 2025-06-18. One tool's input schema had
  no object type at the top, which made the whole tool list unreadable to the
  official client. `resources/list` answers with an empty list instead of
  "method not found".

- [#124](https://github.com/open-okr/open-okr/pull/124) [`cb18797`](https://github.com/open-okr/open-okr/commit/cb18797ad48ff0715a051e57821f51e38ea186a3) Thanks [@agungksidik](https://github.com/agungksidik)! - An agent can open the four prompts the MCP endpoint lists (weekly check-in,
  review against the quality checks, prepare my review, what do I owe). The
  endpoint listed them but answered "method not found" when a client asked for
  one; each now answers with its starting question and the tools that answer it.

- [#121](https://github.com/open-okr/open-okr/pull/121) [`dd0db12`](https://github.com/open-okr/open-okr/commit/dd0db12b8c7f3b6ddca31997d5c5713c231d33cf) Thanks [@agungksidik](https://github.com/agungksidik)! - Nudge volume counts what quiet hours held back.
  
  A reminder due inside a member's quiet hours waits for the window to end,
  which is right, but Nudge volume's "Why it stayed quiet" never listed quiet
  hours, so an administrator could not see that anything had waited. It now
  counts them under "Quiet hours".

- [#120](https://github.com/open-okr/open-okr/pull/120) [`ba0488e`](https://github.com/open-okr/open-okr/commit/ba0488e4787f05b21570d30f9e30d39bdfa962da) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - Numbers on the OKR screens are easier to type and read.
  
  Values, targets, baselines and weights in the OKR list, drawer and diagram,
  on a goal's page and in drafting show numbers grouped the way you read them
  (1,234.5), step with the arrow keys, and show the measure's unit beside them.
  A value field also says where the measure starts and where it is going, for
  example "from 40 to 75 %". Emptying a field records nothing rather than 0.
  
  The unit field suggests the units the cycle already uses, then common ones
  (%, people, US$, days, hours, points), and still takes any unit you type.
  
  Breaking for API clients: a weight must be from 0 to 100. A goal or key
  result sent with a weight outside that range is now refused with a message,
  where it used to be stored as 0 or 100 without saying so. Both importers
  still bring a weight outside the range in as 0 or 100, as before.

- [#120](https://github.com/open-okr/open-okr/pull/120) [`4cf905e`](https://github.com/open-okr/open-okr/commit/4cf905e430ce611d630c1d2601aa6228a8339291) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - A refused save says why.
  
  Four forms failed quietly. An operator's lifecycle change and a site message
  left the form as it was when refused, and an administrator's edit of somebody
  else's name, title or manager threw its answer away, so a refused save and a
  saved one looked the same. Each now says why under its button, keeps what was
  typed so it can be corrected, and says so when it worked.
  
  An operator's plan change no longer goes to the error page when a value is
  refused, and a refused support request now says the refusal in a sentence
  instead of as raw validation output.
  
  For API clients: a member's name of only spaces is refused with "A member
  needs a name."

- [#120](https://github.com/open-okr/open-okr/pull/120) [`04bddd1`](https://github.com/open-okr/open-okr/commit/04bddd137037b8427c32c6af5248c6114f7eda9c) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - A weekly session's note for leadership is written with the editor.
  
  The coordinator's note can carry bold, lists and links. The digest, its
  narration and a post to the space's channel still carry it as one line
  after "For leadership:". Migration 0142 adds a document column beside it,
  and data change 0031 (`pnpm db:change`) turns every note written before
  into a document with the same paragraphs; until it runs, each reads exactly
  as before.
  
  For this release the note is written twice, the document and its plain
  text, so the release before still reads it during an upgrade.
  `sessions.setCoordinatorNote` takes editor JSON, and still takes plain
  text, which is wrapped as a document; `sessions.digest` returns
  `noteDocument` beside the plain `note`. The plain column, and the plain
  text input, go a release later. `RichTextField` takes `hideLabel`, for a
  field a heading beside it already names.

- [#120](https://github.com/open-okr/open-okr/pull/120) [`0020453`](https://github.com/open-okr/open-okr/commit/0020453719e5ac8bf330e4d185f9f7e46322be81) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - A monthly review's shifts note and its decisions are written with the editor.
  
  The resource or priority shifts and each decision can carry bold, lists and
  links, and a decision shows as written on the review, the goal page and the
  cycle page. Migration 0140 adds a document column beside each, and data
  changes 0027 and 0028 (`pnpm db:change`) turn every note and decision
  written before into a document with the same paragraphs; until they run,
  each reads exactly as before.
  
  For this release both are written, the document and its plain text, so the
  release before still reads them during an upgrade. `sessions.setShifts` and
  `sessions.recordDecision` take editor JSON, and still take plain text, which
  is wrapped as a document; the read actions return `shiftsDocument` and each
  decision's `textDocument` beside the plain text. The plain columns, and the
  plain text input, go a release later.

- [#120](https://github.com/open-okr/open-okr/pull/120) [`376b799`](https://github.com/open-okr/open-okr/commit/376b799a9ff7223868645d8050cc9fc233b60d7c) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - A quarterly review's management retro answers and the facilitator's private
  stage notes are written with the editor.
  
  Each answer and each note can carry bold, lists and links, and an answer
  shows as written on the review. The minutes still give each answer on one
  line. Migration 0141 adds a document column beside each answer, and data
  changes 0029 and 0030 (`pnpm db:change`) turn every answer and stage note
  written before into a document with the same paragraphs; until they run,
  each reads exactly as before.
  
  For this release an answer is written twice, the document and its plain
  text, so the release before still reads it during an upgrade. A stage note
  lives in a map with no second column, so the release before shows a note
  written in this one as empty; the facilitator alone reads it.
  `sessions.setManagementAnswer` and `sessions.setStageNote` take editor JSON,
  and still take plain text, which is wrapped as a document;
  `sessions.managementRetro` returns each answer's `bodyDocument` beside the
  plain text, and `sessions.read` returns each stage note as a document. The
  plain column, and the plain text input, go a release later.

- [#120](https://github.com/open-okr/open-okr/pull/120) [`832595b`](https://github.com/open-okr/open-okr/commit/832595bf39d5f4996567a3bb7d1813a4fec34a32) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - A quarter's revalidation notes, what changed and the focus areas, are
  written with the editor.
  
  Both notes can carry bold, lists and links. A member who cannot edit the
  cycle sees them as written rather than as a form they cannot submit.
  Migration 0143 adds a document column beside each, and data change 0032
  (`pnpm db:change`) turns every note written before into a document with
  the same paragraphs; until it runs, each reads exactly as before.
  
  For this release each note is written twice, the document and its plain
  text, so the release before still reads it during an upgrade.
  `workflow.setRevalidation` takes editor JSON, and still takes plain text,
  which is wrapped as a document; `workflow.read` returns
  `revalidationDocuments` beside the plain `revalidation`. The plain columns,
  and the plain text input, go a release later.

- [#121](https://github.com/open-okr/open-okr/pull/121) [`f43618d`](https://github.com/open-okr/open-okr/commit/f43618de2c5a5e5d86dd312c9be48b4a4e0e5e46) Thanks [@agungksidik](https://github.com/agungksidik)! - A space name that is already taken is refused with a sentence.
  
  Creating or renaming a space to a name another space holds sent the screen to
  "We could not load the spaces" with a reference number. It now says the name
  exists and asks for another, the same way roles already do.

- [#122](https://github.com/open-okr/open-okr/pull/122) [`4e214f3`](https://github.com/open-okr/open-okr/commit/4e214f35761330cb722a995c3a9af70db2f95c33) Thanks [@agungksidik](https://github.com/agungksidik)! - An operator can be let into a workspace again after an earlier support
  session ended. The guest the first session left was taken for a membership,
  so every later request answered "You are already a member of this
  workspace". It is now woken by the next grant, at that grant's level.

- [#122](https://github.com/open-okr/open-okr/pull/122) [`f96cfd4`](https://github.com/open-okr/open-okr/commit/f96cfd40c5561aead7f2d256b0321f09005e164f) Thanks [@agungksidik](https://github.com/agungksidik)! - A support session sees the workspace as a member does, never past the level
  the customer granted.
  
  A read-only support session saw no goals and no spaces: its binding was on
  the workspace alone, and every goal and space has access of its own. The
  operator now gets the built-in Viewer role (Member for an edit grant), and
  access treats them like a member up to the granted level, so a read-only
  session reads everything a member reads and still changes nothing.

- [#120](https://github.com/open-okr/open-okr/pull/120) [`dd08538`](https://github.com/open-okr/open-okr/commit/dd08538ffd39a6313b88bb2a646f9128a520aca1) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - Times say whose clock they are on.
  
  A site message's window is now read on the operator's own clock. Before, the
  two times were read in the server's zone, so a message set for 09:00 in Kuala
  Lumpur on a server running in UTC went up at 17:00 there. The form names the
  zone beside each time.
  
  Scheduling a session names the workspace zone beside its date and time, and
  booking a cycle beside its hour. The daily summary's time has a full label and
  names your own zone.
  
  Quiet hours, on the profile and on Where to reach you, open on the saved
  window, which may run overnight (22:00 to 07:00). Setting one time without
  the other is held back with a message under the empty one, instead of being
  sent and refused.
  
  A save on a form now leaves it showing what was just saved. Before, the quiet
  hours just saved could be shown as the ones they replaced.
  
  For API clients: quiet hours, the daily summary time and a cycle booking's
  time follow one rule. A time is HH:MM from 00:00 to 23:59. "9:30" is accepted
  and stored as "09:30", and a time such as "99:99", which quiet hours used to
  accept, is refused with a message.

- [#120](https://github.com/open-okr/open-okr/pull/120) [`da23cfd`](https://github.com/open-okr/open-okr/commit/da23cfd3f6f65ba2dbc2f0c0690684b12d7e9701) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - Lists of domains, hosts, scopes and terms are entered one entry at a time.
  
  Trusted email domains, a link's allowed domains, SSO's scopes and email
  domains, the hosts an AI request may reach, and a workspace's own word-list
  terms now turn each entry into a chip as you type or paste. A wrong entry is
  marked where it stands and says why, and the form will not save while one is
  there. Each word list's box is now named with its list.
  
  A link's allowed domains and an SSO connection's email domains must now be
  domains, like example.com, as trusted domains already had to be. Before, any
  word was stored and matched nobody's address. API clients sending
  `invitations.createWorkspaceLink` with an entry such as "@example.com" now
  get a refusal that says so.

- [#120](https://github.com/open-okr/open-okr/pull/120) [`32249ab`](https://github.com/open-okr/open-okr/commit/32249ab9c1dedc24cce58dabc8071a5e9100e9d0) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - Addresses and ids are checked as they are typed, and the server checks them too.
  
  Single sign-on's discovery, authorization, token and user info addresses
  must now be whole https addresses, or plain http on localhost only, and the
  screen marks one that is not before Save. Nothing checked them before, so a typo was stored and found at
  somebody's sign-in. A refusal now shows on the field it is about, including
  the three addresses that had nowhere to show one. The provider ID lowers
  capitals as you type and marks anything that is not a lowercase letter, a
  number or a hyphen.
  
  An AI provider's base URL must be a whole http or https address, and a
  custom model's id one word of at most 200 characters. A refusal on the AI
  screen is now a sentence rather than a block of JSON.
  
  A space's Slack and Teams channel ids are drawn monospace, without
  spellcheck, and marked when they hold a space, the rule the server already
  applied.
  
  The audit filter's action and target type are chosen from the names this
  workspace's trail holds, rather than typed. A new read action,
  `audit.names`, answers them.
  
  API clients sending `ai.updateProviderConfig` with a base URL that is not a
  whole address, or `ai.addCustomModel` with a model id holding a space, now
  get a refusal that says so.

- [#123](https://github.com/open-okr/open-okr/pull/123) [`ca715ae`](https://github.com/open-okr/open-okr/commit/ca715aee40d0595062eb1f87afe8f0d77ba8f11c) Thanks [@agungksidik](https://github.com/agungksidik)! - The invitation, the notification digest and every agent nudge sent by email
  now arrive in the product's mail layout, beside the plain text, in the
  workspace's name, colour and language (English or Malay).
  
  The invitation names the workspace and who sent it, and when it expires. The
  digest says who did what, with a chip for why it reached you, and its "and N
  more" line is now in the HTML part as well as the text. A nudge shows the
  agent that sent it, the action as a button, and the rule it follows; the
  daily summary lists its rows. Every link opens a page the instance serves.
- Updated dependencies [[`ad1f083`](https://github.com/open-okr/open-okr/commit/ad1f083d07829f761422dafbae254ddce81c55e2), [`c4505e0`](https://github.com/open-okr/open-okr/commit/c4505e06aa128f848173cf6c431388426683934f), [`37a1fdc`](https://github.com/open-okr/open-okr/commit/37a1fdc1cbb3369deefc3985cc31e82ec40f5276), [`f1ef43b`](https://github.com/open-okr/open-okr/commit/f1ef43b8d9d92fec98a794dcd482eb57e90805e3), [`760b0a7`](https://github.com/open-okr/open-okr/commit/760b0a7d5cd65266688d9770afaf87394894bd0b), [`149f16e`](https://github.com/open-okr/open-okr/commit/149f16ea69d791c1e6d4b6abcd84c14f13cc9dc7), [`ba0488e`](https://github.com/open-okr/open-okr/commit/ba0488e4787f05b21570d30f9e30d39bdfa962da), [`04bddd1`](https://github.com/open-okr/open-okr/commit/04bddd137037b8427c32c6af5248c6114f7eda9c), [`0020453`](https://github.com/open-okr/open-okr/commit/0020453719e5ac8bf330e4d185f9f7e46322be81), [`376b799`](https://github.com/open-okr/open-okr/commit/376b799a9ff7223868645d8050cc9fc233b60d7c), [`832595b`](https://github.com/open-okr/open-okr/commit/832595bf39d5f4996567a3bb7d1813a4fec34a32), [`dd08538`](https://github.com/open-okr/open-okr/commit/dd08538ffd39a6313b88bb2a646f9128a520aca1), [`da23cfd`](https://github.com/open-okr/open-okr/commit/da23cfd3f6f65ba2dbc2f0c0690684b12d7e9701), [`32249ab`](https://github.com/open-okr/open-okr/commit/32249ab9c1dedc24cce58dabc8071a5e9100e9d0)]:
  - @openokr/formats@0.3.0
  - @openokr/db@0.3.0
  - @openokr/method@0.3.0
  - @openokr/config@0.3.0

## 0.2.0

### Minor Changes

- [#110](https://github.com/open-okr/open-okr/pull/110) [`fecd1c1`](https://github.com/open-okr/open-okr/commit/fecd1c18556e938627c4f5094b22a751297aedca) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - Stage 9 of the quarterly review is "Keep, modify, abandon or defer"
  (METHOD.md §8.8). An objective now closes as one of five decisions:
  achieved, keep, modify, defer or abandon, each with its meaning on the
  screen. An unfinished aspirational objective shows "Proposed: Keep" where
  the workspace carries forward, and the room still chooses.
  
  A deferred objective is fed forward to the next cycle's issue list when the
  cycle is archived, at the carry-forward impact, once.
  
  Migration 0136 widens the close decision on goals and on review decisions.
  Every stored decision stays valid.

- [#110](https://github.com/open-okr/open-okr/pull/110) [`bf256ef`](https://github.com/open-okr/open-okr/commit/bf256eff36f8e8b601559bc381c624b2fa2ad9eb) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - Closing a cycle carries every kept or modified objective into the next one
  as a draft (METHOD.md §8.9). Each key result starts from the last value it
  recorded, with the same target. A milestone already done stays behind, and
  a measured baseline comes back as a metric with its target to set. The
  draft is an ordinary objective: it passes Phase 4's checks and Phase 5's
  gates like any other, and one somebody deletes stays deleted. An objective
  whose champion has left is named on the closed cycle instead of carried.
  
  A deferred objective reaches the issue list whether it was deferred at the
  review or from its own page, whichever was decided later. The lowest
  process-health statement is now called the next cycle's improvement action
  in phase 3.
  
  Stage 10 of the quarterly review is "Learnings". The minutes report the
  committed key results met apart from the cycle score, on the screen and in
  both exports.
  
  Migration 0137 adds `goals.carried_from_goal_id`, nullable, with a unique
  index per cycle. `cycles.feedForward` and `cycles.close` report `drafts`
  and `notCarried`, and `workflow.read`'s closure reports `carriedDrafts` and
  `notCarried`. `sessions.minutes` reports `summary.committed`.

- [#110](https://github.com/open-okr/open-okr/pull/110) [`fa5b9d2`](https://github.com/open-okr/open-okr/commit/fa5b9d2d03e12d93b22014facd8adb3d5de4d1d7) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - METHOD.md is the revised method in full. The facilitator notes on every
  phase follow its §9, and a nudge for a situation METHOD.md §10 names now
  carries the coach's line under its headline, in the document's own words:
  a stale check-in says "This goal is stale. It cannot quietly stay green."
  
  The terminology card offers "Owner" beside "Champion". It fills both fields
  and saves only when the card is saved. The terms' explanations follow the
  revised method.
  
  `packages/method` exports `COACH_LINES`, `coachLineFor`, `coachSentence`
  and `suggestedTerm`, and the conformance suite now compares §9's guidance
  and §10's lines with the package, both ways.

- [#110](https://github.com/open-okr/open-okr/pull/110) [`a3bf087`](https://github.com/open-okr/open-okr/commit/a3bf0873f72572a82a51b3caf73977f21b3729d0) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - The demo is now Northwind Labs' year. `pnpm db:seed` builds the scenario in
  `docs/scenarios/northwind-year` as of today: every step dated before today
  has happened and nothing after it exists, so a public demo moves through the
  year with the calendar. `pnpm db:seed --quarter` builds the smaller
  one-quarter demo the walkthrough follows. `pnpm demo:prepare` and the
  demo sign-in page now offer twelve people, the year adding Hugo, Nadia,
  Kofi, Leo and Yuki to the original seven.

- [#110](https://github.com/open-okr/open-okr/pull/110) [`1aaf715`](https://github.com/open-okr/open-okr/commit/1aaf715b768d646ce6a0c3fce52ad0f763651dab) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - `pnpm db:seed --year` now closes the year. 2028's planning opens in
  November and its offsite replaces the achieved strategy; the annual review
  of 2027 runs before 2028 is drafted, grades the annual objectives on their
  latest values with A4's eased target beside its original, and closes the
  year into 2028, whose annual set publishes in December. Q4 is graded,
  reviewed and closed with the margin recovery achieved, and Q1 2028's
  company set is drafted from what was kept and published.
  
  A KPI's recovery now follows its objective across a cycle's close: kept,
  the recovery continues in the next cycle's draft; closed as achieved,
  abandoned or deferred, it ends and the KPI leaves the recovery board.

- [#110](https://github.com/open-okr/open-okr/pull/110) [`8ff439e`](https://github.com/open-okr/open-okr/commit/8ff439e5cf01c77503d89f387f6218e02d3e758c) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - `pnpm db:seed --year` now runs Q1 and closes it. Every objective checks in
  weekly from the teams' publication to the week before the review, Marketing
  once on a Wednesday, inside the grace. Tickets per account turns unhealthy
  and C2.3 is added for it on 1 February as the KPI's answer. Two monthly
  reviews each record a decision, a blocker on guided setup is raised and
  resolved, and both milestones are ticked done on their own days. The review
  on 18 March grades every key result, with one adjustment, names the causes,
  reads "results delivered", decides all fourteen objectives and closes Q1
  with eleven drafts in Q2.
  
  A review recorded after its day now reads that day. The diagnostic measures
  the rhythm as of the review's day rather than when it was written up, so the
  check-ins due since are not counted as missed. A decision is dated by its
  session's day. A milestone that an imported check-in marks done is dated by
  that check-in.
  
  The quarterly review in the company space now covers every objective in the
  cycle, so one review can decide them all, as METHOD §8 has it. A team's
  review still covers only its own.

- [#110](https://github.com/open-okr/open-okr/pull/110) [`a0319a9`](https://github.com/open-okr/open-okr/commit/a0319a96071d699ca29ddd304de190f69b867806) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - `pnpm db:seed --year` now runs Q2 to its close. Brightline launches in week
  6; two days later a leadership session starts C5, stops C4, moves CS2 and
  M1, makes C2 aspirational and eases S2.1, each with its reason and its day.
  Ben leaves and S2.1 moves to Jonas, the questionnaires meet a decision and a
  trust-centre page, and C5.1 finds the win rate C5.4 aims from. The review and
  the retrospective are held two days apart, the diagnostic reads a strategy
  or OKR-quality problem at 0.59 with the rhythm kept, and Q3's revalidation
  eases A4's win rate and revises the not-doing list.
  
  `sessions.create` takes a `part`, so a review held in two sessions can be
  scheduled by hand as booking schedules it. Revising the annual frame keeps
  its strategies, and the objectives aligned to them, when the strategies did
  not change. A stopped objective's key results no longer hold up a cycle's
  close, and the scorecard shows an eased target beside the target the plan
  published with rather than a draft's.

- [#110](https://github.com/open-okr/open-okr/pull/110) [`2df3862`](https://github.com/open-okr/open-okr/commit/2df386225b3c25704dffe531e743eca74cdc0d72) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - `pnpm db:seed --year` now plans Q4 and runs it to December. Expansion comes
  back first on the issue list as C8, CS1 rises to company level as C7 for
  renewal season, and C2 becomes Customer Success's CS3; both steps publish.
  Mei returns and takes E1 back, the failover outage of 3 December turns
  uptime unhealthy and is answered with a task rather than a recovery, and
  November's margin reads healthy with the recovery still open.
  
  A company objective can now be moved into a space, where it becomes that
  space's objective, as a modified objective carried to the team that will
  run it next. A person's objective still cannot.

- [#110](https://github.com/open-okr/open-okr/pull/110) [`fe540d2`](https://github.com/open-okr/open-okr/commit/fe540d2beede8d9ea51d61faa2fb5e8865488bca) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - Stage ten of the quarterly review, Learnings, no longer drafts the next
  cycle (METHOD.md §8.10: hold the review before drafting). The draft form
  and the assist that proposed drafts from the carried learnings are gone;
  a line under the learning composer says an idea for the next cycle is a
  learning marked to carry, which reaches the next cycle's issue list, and
  kept or modified objectives reach its Phase 4 as drafts on their own.
  Drafts written before still show, read-only, and in the minutes.
  
  `sessions.draftNextCycle` and `sessions.proposeFromLearnings` are
  deprecated and will be removed in 0.3, with the `next_cycle_drafts`
  table.

### Patch Changes

- [#110](https://github.com/open-okr/open-okr/pull/110) [`214ffc7`](https://github.com/open-okr/open-okr/commit/214ffc717c27e4b123c2090a7ff0015f838caa36) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - The demo shows what 0.2.0 ships. Its current quarter holds a milestone key
  result beside the metrics, Amara's agreed definition of a 90-day renewal,
  alongside its committed and aspirational objectives. Its finished quarter
  has an objective started in week three, which the scorecard counts among
  what moved and whose check-ins begin that week. The user guide describes
  writing and changing OKRs, the kinds, the three responses to an unhealthy
  KPI and the quarterly review as 0.2.0 has them.

- [#110](https://github.com/open-okr/open-okr/pull/110) [`1766c7c`](https://github.com/open-okr/open-okr/commit/1766c7c2eb98858dface92e91495522949dcd27f) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - `pnpm db:seed --year` builds the Northwind year: the scenario in
  `docs/scenarios/northwind-year` placed on the real calendar, with every
  event dated on or before today written and nothing after it. Each date
  keeps its distance from its quarter's first Monday, so a Monday check-in
  stays a Monday in any year.
  
  This first part writes the year's frame: fourteen people with the days they
  arrive and leave, nine spaces with Support archived and Growth formed on
  their own dates, "Team" in terminology, the year's practice settings
  changes on their dates, eleven KPIs judged by their own thresholds with a
  reading for every month as it is recorded, and the annual frame with its
  four objectives, published. The quarters follow in later parts.

- [#110](https://github.com/open-okr/open-okr/pull/110) [`43b8b6d`](https://github.com/open-okr/open-okr/commit/43b8b6db386387a900195c21f146e5b3547b4944) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - `pnpm db:seed --year` now writes the pilot quarter and Q1's plan. The pilot
  runs with Product and Customer Success, checks in every Monday from
  October, takes Tomás's confidence down to 3 in 10 in week five, is reviewed
  with two learnings for Q1's input pack, and closes at 0.55, its scores
  landing in Q1's prior-cycle list. Q1 opens four weeks ahead, ranks four
  issues, revalidates the frame, books its rhythm, publishes the company set
  first and the teams' set on 15 January, with the peer review's rewrites,
  its two objectives turned into initiatives, a deleted duplicate, two
  confirmed dependencies and the capacity cut on record.

- [#110](https://github.com/open-okr/open-okr/pull/110) [`330dac8`](https://github.com/open-okr/open-okr/commit/330dac8c9f5cbbc51c42d5e2a88ce99db9a2dd03) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - `pnpm db:seed --year` now plans Q2 and runs it to its first monthly review.
  The eleven objectives Q1 kept or modified come back as Q2's drafts, each key
  result starting where Q1 left it, and are redrafted: retargeted, given Q2's
  due dates and capacity verdicts, aligned again, and joined by four new
  objectives. The company set publishes on 29 March and the teams' on
  15 April, past OBJ-1 with the override reason on record. Engineering's third
  objective becomes an initiative, Yuki follows Product's objective, and
  Customer Success's dependency on Product is escalated and confirmed. The
  company checks in from week 1, the teams from week 3, and the May review
  gives each company objective a trend.

- [#110](https://github.com/open-okr/open-okr/pull/110) [`2299409`](https://github.com/open-okr/open-okr/commit/229940932ba8624e2e81a45cd273370084c8f717) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - `pnpm db:seed --year` now runs Q3 to its close. Product marks two holiday
  weeks and checks in nothing in them, Amara stands in for Sara and Leo for
  Mei, Support merges into Customer Success with SU1 moved first, and the
  Growth team starts G1 with a baseline and sets its target once it is found.
  F3's milestones and the SOC 2 report land on their days, and the review and
  retrospective, held apart, grade 0.66 with seven of eleven commitments met
  and read results delivered with the holiday weeks left out.
  
  A retrospective scheduled by hand now names the review scheduled before it,
  rather than a review booked later for the same cycle.

- [#110](https://github.com/open-okr/open-okr/pull/110) [`86ea55e`](https://github.com/open-okr/open-okr/commit/86ea55e61c0df2126f18bdf23a1203accc02c8b7) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - `pnpm db:seed --year` now plans Q3 and launches the margin recovery. Q2's
  kept and modified objectives are redrafted for Q3 beside the deferred
  expansion on Phase 2's list, C2 is committed again, and the company step
  publishes on 28 June. On 6 July C6 is launched from the operating margin
  KPI, which has read unhealthy for two months: committed, at company level,
  its first key result the KPI itself from 7.6% to 13.5%, with the renewal
  discount in place of two drivers other objectives already own, and the
  expansion KPI answered by C6.2. The teams add S3 and F3 and publish on
  14 July, and Sales checks in every two weeks.
- Updated dependencies [[`fecd1c1`](https://github.com/open-okr/open-okr/commit/fecd1c18556e938627c4f5094b22a751297aedca), [`bf256ef`](https://github.com/open-okr/open-okr/commit/bf256eff36f8e8b601559bc381c624b2fa2ad9eb), [`fa5b9d2`](https://github.com/open-okr/open-okr/commit/fa5b9d2d03e12d93b22014facd8adb3d5de4d1d7)]:
  - @openokr/db@0.2.0
  - @openokr/method@0.2.0
  - @openokr/config@0.2.0

## 0.1.2

### Patch Changes

- Updated dependencies []:
  - @openokr/config@0.1.2
  - @openokr/db@0.1.2
  - @openokr/method@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies []:
  - @openokr/config@0.1.1
  - @openokr/db@0.1.1
  - @openokr/method@0.1.1

## 0.1.0

### Patch Changes

- Updated dependencies []:
  - @openokr/config@0.1.0
  - @openokr/db@0.1.0
  - @openokr/method@0.1.0
