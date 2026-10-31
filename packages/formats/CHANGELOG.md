# @openokr/formats

## 0.4.0

No changes in this release.

## 0.3.1

No changes in this release.

## 0.3.0

### Patch Changes

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
