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
| `branding` | The product's own palette | You want the workspace to carry your colour |
| `trustedEmailDomains` | None | Anybody with a company address should be able to join without being invited. Joining is by invitation until you set this |
| `requireSecondFactor` | Off | Your organisation mandates a second factor. It holds you too. See [Security](security.md) |
| `storageQuotaBytes` | 5 GiB | A team whose files outgrow it |
| `exportInlineRowLimit` | Set by the registry | A list export is large enough to be built in the background instead of handed over directly |
| `importRowLimit` | Set by the registry | An import is bigger than the default ceiling |
| `messageLogRetentionDays` | Set by the registry | Your policy says chat message records live for a different span |
| `agentRunCostCapUsd` | Set by the registry | You want a harder or softer ceiling on what an agent run may spend |

## Space

| Setting | Default | What it does |
|---|---|---|
| `teamVoting` | On | The confidence round in the weekly session, with a vote per member |
| `coachStrictness` | Set by the registry | How hard the Coach pushes on quality |
| `defaultCheckInFrequency` | Set by the registry | How often a new goal in this space expects a check-in |

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
| `mail.transport` | `console` | The console driver writes each message to the process log instead of sending it. **Change this.** A password-reset link in a log is a credential, and the General screen shows a banner while it is the case |
| `registration.policy` | Computed | Open until somebody claims the instance, invitation-only afterwards. A managed cloud stays open. Set it explicitly to override |

## The two rules behind all of this

**Every setting has a working default**, which is why a fresh instance is
usable before anybody visits a settings screen.

**A threshold the method owns is not a setting.** The numbers the coaching
rules fire on live in the method specification and are administered on the
Rhythm and thresholds screen, not invented per instance. That is what keeps a
coaching message able to cite the rule behind it.

## Next

- [Security](security.md)
- [Operations](operations.md)
