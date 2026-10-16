# @openokr/ui

## 0.3.1

### Patch Changes

- Updated dependencies []:
  - @openokr/formats@0.3.1
  - @openokr/method@0.3.1

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

- [#121](https://github.com/open-okr/open-okr/pull/121) [`18bcbe9`](https://github.com/open-okr/open-okr/commit/18bcbe95fd03358e7c60a728813762d323b13263) Thanks [@agungksidik](https://github.com/agungksidik)! - A drafting assist that gets nothing back no longer blames the wording.
  
  When the AI provider refused or did not answer, "Draft from an ambition" said
  "Nothing was drafted from that. Try saying what changes.", which sent people
  rewriting a sentence that was never the problem. The notices now say the
  provider may not have answered, and the assists' notices are translated like
  the rest of the screen.

- [#120](https://github.com/open-okr/open-okr/pull/120) [`c4bd792`](https://github.com/open-okr/open-okr/commit/c4bd792505d9a9e4f641512ed328bc38b1a604ee) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - One-time codes are typed one character per cell, and send themselves.
  
  The six-digit code at sign-in and when turning on an authenticator, and the
  backup code, are now drawn as cells, one per character. Typing fills them in
  order, pasting fills them all whatever separates the characters, and the code
  is checked as soon as the last cell is filled, with no button to press. A code
  that is refused empties the cells and says why, ready for the next one. A
  phone's one-time-code autofill and a password manager still see one field.
  
  The terminal login page, opened without the link, now takes the code the
  terminal printed, typed into the same cells: it upper-cases what is typed and
  drops the characters the codes never use. It does not send itself, because the
  next page says which terminal is asking before anything is granted.

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

- [#120](https://github.com/open-okr/open-okr/pull/120) [`26845fd`](https://github.com/open-okr/open-okr/commit/26845fd21b91520ad01b84cec49876dd6bc6364f) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - Confidence is shown the way your workspace chose.
  
  The practice setting "Confidence shown as" now does what it says. With the
  default, "x in 10", a confidence of 0.7 reads "7 in 10" wherever it is typed
  or shown; "0.0 to 1.0" shows 0.7, and "Percent" shows 70%. It is still stored
  as 0.7.
  
  Every place confidence is set uses one field: the check-in composer, the
  OKR drawer's check-in, a key result on its goal page, a confidence vote and
  the correction on the check-in history. The sliders, which never showed
  their value, are gone. The field names the confidence band beside the number
  (High, Medium or Low), from your workspace's own thresholds.
  
  Fixed: emptying the confidence on a check-in, a correction or a vote used to
  record a confidence of 0. Publishing or voting now asks for one, and a
  correction keeps the confidence it had.

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

- [#120](https://github.com/open-okr/open-okr/pull/120) [`c3f2d2b`](https://github.com/open-okr/open-okr/commit/c3f2d2b4b9a269046bb4421b2d296d4f78856beb) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - Sign-in, sign-up, password reset, setup and the welcome wizard check an email
  address with the server's own rule.
  
  An address like `priya@northwind`, which the browser accepts and the server
  refuses, is now caught when you leave the field, with a sentence saying what
  it needs, and the form does not send it. The forgot-password page used to say a
  reset link was on its way for such an address. A space a phone's autocomplete
  adds after the address is taken off.
  
  Every password field, on sign-in and reset too, now has a "Show what you typed"
  toggle. Password fields stop at 128 characters, where the server does, and a
  field near its limit says how much of it is used. These screens, the backup
  code page and the single sign-on form share one field style, with the error
  and the hint read out with the field.

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

- [#120](https://github.com/open-okr/open-okr/pull/120) [`fa1e580`](https://github.com/open-okr/open-okr/commit/fa1e5808188883be09d431245ce573fc7b8db6e6) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - A check-in's narrative can be formatted.
  
  The narrative box on the check-in screen and in the OKR drawer is now the
  same small editor comments use: bold, italic, strikethrough, code, bulleted
  and numbered lists, and links. The check-in history shows each narrative as
  it was written, lists and all, rather than as one line of text.
  
  Correcting a check-in from its history now opens the narrative itself, with
  its formatting. The old one-line box could only replace a narrative of several
  paragraphs with a single line. Leave it as it is, and the narrative is kept.
  
  Bulleted and numbered lists show their bullets and numbers again, in the
  editor and wherever rich text is read: comments, check-ins and a person's
  bio. Inline code has a background, and links are coloured.

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

- [#120](https://github.com/open-okr/open-okr/pull/120) [`f96ba67`](https://github.com/open-okr/open-okr/commit/f96ba6743d62ff947edaac82d6589c9c06cbce84) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - Documents have a formatting toolbar.
  
  The document editor shows the same toolbar as comments, plus Heading 1,
  Heading 2, Quote and Insert a table, which the `/` menu already offered.
  A button is greyed out where what it makes could not be saved: there is no
  heading inside a list item, and a table cell holds text and lists only.
  
  A review's written-up minutes open in the document editor, so a draft can be
  given headings and lists before it is saved as a document.
  
  Fixed: a document with a heading, and a comment, check-in note or review
  note with a link or a mention, could not be saved. The editor handed those
  parts over in a shape the server could not read, so the save was refused.

- [#121](https://github.com/open-okr/open-okr/pull/121) [`003b152`](https://github.com/open-okr/open-okr/commit/003b152e47374fec02f036d5842acf41b42d9575) Thanks [@agungksidik](https://github.com/agungksidik)! - A guest with no space is told what they can see, not that something was lost.
  
  A guest invited to no space yet saw "No spaces yet ... an empty list means it
  was archived." on Spaces and "You do not have access to this workspace. Ask a
  workspace administrator to restore it." on Inbox. Both now say that their
  access is limited to what they were invited to.

- [#121](https://github.com/open-okr/open-okr/pull/121) [`390ebea`](https://github.com/open-okr/open-okr/commit/390ebead58e57b299363b220b8c1b9457a9c0b0b) Thanks [@agungksidik](https://github.com/agungksidik)! - Inbox rows for a check-in to review, a mention or a comment say what they are.
  
  A check-in waiting for acknowledgement, and a comment on something followed,
  reach the inbox without an activity behind them, so every such row read
  "Something happened here." They now say what they are, from their reason.

- [#121](https://github.com/open-okr/open-okr/pull/121) [`200c017`](https://github.com/open-okr/open-okr/commit/200c0170b061a43f6499b76a9f150676ff2746e5) Thanks [@agungksidik](https://github.com/agungksidik)! - A KPI's ID is shown on its page, and the grid links to that page.
  
  The kpi-records import names each KPI by its ID, and no screen showed one, so
  a spreadsheet filled in with KPI titles had every row skipped. The ID is now
  under the KPI's title on its own page, and each title in the KPI grid opens
  that page, which before could only be reached from a tree.

- [#120](https://github.com/open-okr/open-okr/pull/120) [`149f16e`](https://github.com/open-okr/open-okr/commit/149f16ea69d791c1e6d4b6abcd84c14f13cc9dc7) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - KPI numbers are easier to type and check.
  
  The KPI add form, a tree's new driver, how a KPI is judged, the KPI grid,
  the suggestion and a recovery's from and to all use number fields that show
  numbers grouped the way you read them and step with the arrow keys. In the
  grid the arrow keys still move between cells.
  
  Adding a KPI or a driver now asks for its unit, suggesting the units your
  KPIs already use and common ones. How a KPI is judged says straight away when
  its red value sits on the wrong side of green, with the same sentence a save
  would be refused with, and shows the KPI's unit beside each value. A range's
  band is labelled "Green from" and "Green to", where the second was only "to".

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

- [#122](https://github.com/open-okr/open-okr/pull/122) [`d8d4f9d`](https://github.com/open-okr/open-okr/commit/d8d4f9d89fa81137f7a0c4c9706ffd09eb339b61) Thanks [@agungksidik](https://github.com/agungksidik)! - Account security lists the passkeys an account holds, each with the date it
  was added and a way to remove it. Adding a passkey used to leave nothing on
  the page to show it had worked, and a lost device's passkey could not be
  taken away.

- [#120](https://github.com/open-okr/open-okr/pull/120) [`91dfef3`](https://github.com/open-okr/open-okr/commit/91dfef374fe56afcd684f31f4ee526e97cf5b1e8) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - Every session and KPI field is labelled, limited, and sized for what it holds.
  
  The session stages' notes and answers (the coordinator's note, the monthly
  review's shifts and decision, a management answer, a private stage note, a
  retro note) grow with the text and count near their limit, where several
  were boxes of a fixed size or one line. Every title, reason and note on the
  session and KPI screens stops at the length the server accepts, rather than
  being refused after the press. The room pulse asks for one word and says so
  as you type a second. The fixed lists on these screens keep the browser's
  own dropdown, and the score slider stays the browser's own, with the same
  labelling as every other field.

- [#120](https://github.com/open-okr/open-okr/pull/120) [`48dee0a`](https://github.com/open-okr/open-okr/commit/48dee0a3e4aeea11d0c16afd5ff3b35d75314d78) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - Comments, and your bio, can be formatted.
  
  The comment box is now a small editor with a toolbar: bold, italic,
  strikethrough, code, bulleted and numbered lists, and links. Type `@` to
  mention somebody, who is told. Editing a comment keeps the formatting it had;
  the old box turned every edit back into plain text. Comments are shown as
  they were written, with their formatting, lists and links.
  
  Rich text can now hold underlined text, and every screen, email and export
  shows it. Nothing can add it yet: that arrives in the next release, once every
  running copy of the app can read it.

- [#120](https://github.com/open-okr/open-okr/pull/120) [`000d621`](https://github.com/open-okr/open-okr/commit/000d621124e294ece6d98c3259c64b5d00545acc) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - Reasons get room to be written, and every goal and cycle field is labelled and limited.
  
  A goal's close reason, the gate override reason, a strategy's meaning, a
  frame revision's reason and the revalidation notes are now boxes that grow
  with the text, with a count as you near the limit, where several were one
  line that scrolled sideways out of sight. Every title and reason on the goal
  and cycle screens now stops at the length the server accepts, rather than
  being refused after Save.
  
  The annual frame's strategies are labelled, where only a placeholder named
  them. The fixed lists on these screens (status, outcome, decision, level,
  kind, impact, direction) keep the browser's own dropdown, and take the same
  look and labelling as every other field. The cycle's publication deadline
  is the date field every other date uses.

- [#118](https://github.com/open-okr/open-okr/pull/118) [`07da458`](https://github.com/open-okr/open-okr/commit/07da458fd132b25ce590918713b1c473c02c824a) Thanks [@agungksidik](https://github.com/agungksidik)! - The people directory lists the OKR Coach and the OKR Champion.
  
  Both are members of every workspace and the org chart on the same screen
  already named them, but the Directory tab filtered them out. They are now
  listed with an Agent badge, and their profile carries the same badge.

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

- [#120](https://github.com/open-okr/open-okr/pull/120) [`67c66d6`](https://github.com/open-okr/open-okr/commit/67c66d6ff63f6c8f57304988f080ad95a99aae5a) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - A timezone is chosen from a list rather than typed.
  
  The welcome wizard, Admin > General and your profile now offer every timezone
  the server knows, each shown with its city, its offset today and its name, and
  grouped by region. Type a city, an offset such as `+8` or `GMT+8`, or the zone's
  everyday name ("Malaysia Time") to find one, and use this device's zone in one
  press. A timezone saved before that is not on the list still shows, marked, and
  nothing is changed until you pick another.
  
  The server now accepts only a name on that list. It used to accept anything the
  runtime could resolve, such as `EST`, `+08:00` or a name in the wrong case, and
  stored it exactly as typed.

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
- Updated dependencies [[`ad1f083`](https://github.com/open-okr/open-okr/commit/ad1f083d07829f761422dafbae254ddce81c55e2), [`c4505e0`](https://github.com/open-okr/open-okr/commit/c4505e06aa128f848173cf6c431388426683934f), [`f1ef43b`](https://github.com/open-okr/open-okr/commit/f1ef43b8d9d92fec98a794dcd482eb57e90805e3), [`149f16e`](https://github.com/open-okr/open-okr/commit/149f16ea69d791c1e6d4b6abcd84c14f13cc9dc7), [`ba0488e`](https://github.com/open-okr/open-okr/commit/ba0488e4787f05b21570d30f9e30d39bdfa962da), [`dd08538`](https://github.com/open-okr/open-okr/commit/dd08538ffd39a6313b88bb2a646f9128a520aca1), [`da23cfd`](https://github.com/open-okr/open-okr/commit/da23cfd3f6f65ba2dbc2f0c0690684b12d7e9701), [`32249ab`](https://github.com/open-okr/open-okr/commit/32249ab9c1dedc24cce58dabc8071a5e9100e9d0)]:
  - @openokr/formats@0.3.0
  - @openokr/method@0.3.0

## 0.2.0

### Patch Changes

- Updated dependencies [[`fecd1c1`](https://github.com/open-okr/open-okr/commit/fecd1c18556e938627c4f5094b22a751297aedca), [`bf256ef`](https://github.com/open-okr/open-okr/commit/bf256eff36f8e8b601559bc381c624b2fa2ad9eb), [`fa5b9d2`](https://github.com/open-okr/open-okr/commit/fa5b9d2d03e12d93b22014facd8adb3d5de4d1d7)]:
  - @openokr/method@0.2.0

## 0.1.2

### Patch Changes

- Updated dependencies []:
  - @openokr/method@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies []:
  - @openokr/method@0.1.1

## 0.1.0

### Patch Changes

- Updated dependencies []:
  - @openokr/method@0.1.0
