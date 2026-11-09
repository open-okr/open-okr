# Settings

**Nothing has to be configured before the product works.** Every setting
resolves to a working default, and no screen blocks waiting for a choice. This
page is about the ones worth changing on purpose.

Settings live at three scopes. A workspace setting is an administrator's. A
space setting belongs to the space. A member setting is that person's own, and
no administrator overrides it.

## Workspace

| Setting | Default | Change it when |
|---|---|---|
| `timezone` | The registering browser's, falling back to UTC | Almost always, on the first day. Every rhythm date is read in it, so a wrong one sends Monday's nudges on Sunday night |
| `language` | Inherited from the instance default, which is English | Your workspace works in Bahasa Melayu |
| `branding` | The product's own palette, the initials tile and the product icon | You want the workspace to carry your colour. It becomes the buttons, links, progress bars and focus rings on every screen of the workspace, in light and dark. A colour too light for white text is darkened for buttons, and the card says which shade is used. Red, amber and green are refused, because they mean off track, at risk and on track. The sign-in page and email do not carry it. The same screen takes a logo for the sidebar and a favicon for the browser tab, each a PNG, JPEG or WebP of up to 2 MB |
| `trustedEmailDomains` | None | Anybody with a company address should be able to join without being invited. Joining is by invitation until you set this. See [Trusted email domains](#trusted-email-domains) for what it takes |
| `requireSecondFactor` | Off | Your organisation mandates a second factor. It holds you too. See [Security](security.md) |
| `storageQuotaBytes` | 5 GiB | A team whose files outgrow it |
| `exportInlineRowLimit` | 5,000 rows | A list export above it is built in the background instead of handed over directly |
| `importRowLimit` | 1,000 rows | An import in the browser is bigger than the default ceiling. The command line has no ceiling |
| `messageLogRetentionDays` | 0, which keeps everything | Your policy says chat message records live for a set span |
| `agentRunCostCapUsd` | 2.00 US dollars a run | You want a harder or softer ceiling on what an agent run may spend |
| `agentToolCallRetentionDays` | 90 days | You want the record of what external agents called kept for longer, or for good with 0. It never holds what the agent sent or read back |
| Practice: a profile and its settings | Recommended, nothing changed | Your organisation runs OKRs differently from the defaults: a formal planning process (Governed), tracking without the planning workflow (Lightweight), Google's playbook or Radical Focus. Admin, Practice compares the five side by side under "Compare profiles", links to the method behind them, shows what a profile changes before it is applied, keeps anything the workspace changed itself, lets any one setting be changed on its card, and resets a card to the profile. A profile that sets a number, such as Lightweight's fortnightly check-ins, moves it on Rhythm and thresholds too |

`storageQuotaBytes`, `exportInlineRowLimit`, `importRowLimit`,
`messageLogRetentionDays` and `agentRunCostCapUsd` are on the Limits card on
Admin, General, with a button that returns all five to their defaults. On a
managed cloud the storage quota and the agent cost cap are your provider's to
set: the card shows them and who sets them, and the provider changes them
from their operator console.

### Trusted email domains

Somebody whose **confirmed** address is at one of these domains is offered the
workspace when they sign in, and joins it with one press. Nobody is added
without pressing it.

| Who | What they see |
|---|---|
| Somebody with no workspace yet | A page listing the workspaces their domain admits, and a button to start one of their own instead. Nothing is made for them until they choose |
| A member of another workspace | The same offer at the top of their Home |
| Somebody whose address is not confirmed | Nothing. Anybody can type an address at your company into a sign-up form |
| A member you suspended, or one who was removed | Nothing. Only an invitation brings them back |

**Confirming an address needs mail.** An instance with no mail server confirms
nobody, so a trusted domain admits nobody there.

**It does not open registration.** On an invitation-only instance a trusted
domain lets people who already have an account join. Creating an account there
still takes an invitation or single sign-on.

The seat limit still applies: a full workspace refuses the join and says so.

## Space

| Setting | Default | What it does |
|---|---|---|
| `teamVoting` | On | Votes in the space's sessions: the confidence round, with a vote per member, and the retro's voting stage |
| `coachStrictness` | The workspace's | `advisory`, `warn` or `strict`. `strict` raises every quality check on this space's goals to block. The workspace's own switch for the same is strict mode, under Admin, Practice |
| `defaultCheckInFrequency` | The workspace's check-in frequency | How often a new goal in this space expects a check-in |
| `slackChannel`, `teamsChannel` | None | The channel the space's weekly digest is posted to, as Slack's or Teams' own channel ID rather than its name. Offered only for a provider the workspace has connected, and the bot has to be a member of the channel. The coordinator posts each closed week's digest from the session, once per channel |

## Member

Their own, not yours: theme, density, language, primary channel, quiet hours,
notification routing, whether a mention interrupts, the batch window, and the
daily summary and its hour.

Quiet hours are respected by every proactive message. A snooze quietens a
message and never hides the obligation behind it.

## Instance

Above every workspace, and set by instance administration rather than by a
workspace.

| Setting | Default | Detail |
|---|---|---|
| `instance.name` | `OpenOKR` | What people see in the tab title, on the sign-in page, and in every email and chat message. Set it with `OPENOKR_INSTANCE_NAME`, in the wizard, or on General in admin. A name saved on General wins over the variable; clear the field to hand the choice back to it. Authenticator apps and passkey prompts show a new name after the next restart. Not on General on a managed cloud, where the name is the operator's |
| `instance.sourceUrl` | The upstream repository | Where every member is offered the source, in the account menu. Set it with `OPENOKR_SOURCE_URL`. If you changed the code and offer it over a network, point this at your own: AGPL-3.0 §13 asks for that |
| `instance.termsUrl`, `instance.privacyUrl` | Empty | Named on the sign-up page once set, with `OPENOKR_TERMS_URL` and `OPENOKR_PRIVACY_URL` |
| `instance.supportEmail` | Empty | Who a customer writes to about their plan. Set it with `OPENOKR_SUPPORT_EMAIL` |
| `mail.transport` | `console` | The console driver logs each message instead of sending it. **Change this.** In production it logs only the masked recipient and the subject, because a password-reset or invitation link in a log is a credential; on a development machine it logs the whole message. The General screen shows a banner while it is the case |
| `registration.policy` | Computed | Who may create an account. Set it on General in admin: **Invitation only**, **Company email addresses** (anybody may sign up with a company address and start a workspace; Gmail, Yahoo, Outlook and other free mail addresses need an invitation), or **Anyone**. Stored as `invite_only`, `company_domains` or `open`. With nothing saved it follows `OPENOKR_REGISTRATION`, and with that unset it is open until somebody claims the instance and invitation-only afterwards. A managed cloud stays open unless a policy is set, and its operator sets one on the console's Instance screen. A value saved on General wins over the variable. The setup wizard saves none from 0.7.0. Every change is in the instance audit chain |
| `scan.clamd.host` | Empty, meaning no virus scan | Name a ClamAV daemon (clamd) with `OPENOKR_CLAMD_HOST` and every uploaded file waits as "being checked" until clamd has scanned it. A file it flags is held back and never served. See [Security](security.md#uploaded-files) |
| `webhooks.allowPrivateTargets` | Off | Whether a webhook may post to an address inside the network: a private range, loopback or `localhost`, and over plain `http` there. Set it with `OPENOKR_WEBHOOKS_ALLOW_PRIVATE=true` on a self-hosted instance whose receivers are on its own intranet. Ignored with the cloud flag on. Cloud metadata addresses are refused either way |
| `scan.clamd.port` | `3310` | clamd's own default. Set it with `OPENOKR_CLAMD_PORT` when yours listens elsewhere |
| `observability.errors.dsn` | Empty, meaning no error report leaves the instance | Name the DSN of a tracker that speaks Sentry's protocol (Sentry, GlitchTip, Bugsink) with `OPENOKR_ERROR_DSN`, in the deployment's secrets, and every unexpected error is also sent there. Environment only, with no screen, because its key lets anyone write into the tracker. A value that is not a DSN stops the instance starting. See [Sending errors to a tracker](../runbooks/observability.md#sending-errors-to-a-tracker) |
| `observability.errors.environment` | `production` | Which deployment a report came from, with `OPENOKR_ERROR_ENVIRONMENT`. Set `staging` on a staging instance that shares production's tracker |

## The two rules behind all of this

**Every setting has a working default**, which is why a fresh instance is
usable before anybody visits a settings screen.

**A threshold the method owns is not a setting.** The numbers the coaching
rules fire on live in the method specification and are administered on the
Rhythm and thresholds screen, not invented per instance. That is what keeps a
coaching message able to cite the rule behind it.

## Terminology

The Terminology card on Rhythm and thresholds renames a term the method
already has: an objective can be an ambition, a space a team. The rename shows
in the sidebar and in the main screens' headings, create buttons, counts and
empty states, for every member and in every language, because it is your
organisation's own word. A term you have not renamed reads in each person's
own language.

Coaching messages, rule names and the method page keep the method's words, so
a message still cites the rule it comes from. Longer explanatory sentences,
emails and chat messages keep them too for now.

## Next

- [Security](security.md)
- [Operations](operations.md)
