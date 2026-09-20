# Administrator guide

For the person who owns an OpenOKR instance or a workspace inside one.

Everything an administrator can change lives under **Admin** in the left
navigation. Every screen there needs full access, which is what the owner
account has and what an administrator can grant to somebody else.

## The screens, and what each one owns

| Screen | What you decide there |
|---|---|
| **General** | Timezone, language, trusted email domains, the second-factor policy, and the workspace state |
| **Plan and seats** | The plan and how many seats it carries. Cloud only; a self-hosted instance is never seat-limited |
| **Support access** | Whether the vendor may look, for how long, and with what reason. Cloud only |
| **Single sign-on** | An OIDC provider, which email domains it claims, and whether it is enforced |
| **Directory sync** | The SCIM endpoint and its bearer token, so an identity provider provisions people |
| **Audit trail** | Verify the hash chain, and export the trail with a filter |
| **Branding** | The workspace's own colour |
| **Rhythm and thresholds** | The cadence, the staleness grace, and the numbers the coaching rules fire on |
| **Channels** | Slack, Microsoft Teams, WhatsApp and Telegram, and the templates each one uses |
| **Nudge volume** | Which proactive messages are on, and how loudly they escalate |
| **Invitations** | Links that let somebody join, and what they are worth |
| **Import** | Bringing a quarter of history in from a spreadsheet or from FlowyTeam |
| **AI** | Whether AI is on at all, whose key, which models, and the cost caps |
| **Agents and runs** | What the Coach and the Champion may do, and what they have done |

## The four decisions that matter most

**Who can get in.** Invitations by default, trusted email domains if you want
a domain to self-serve, single sign-on if your organisation already has an
identity provider. See [People and access](people.md).

**Whether the instance can speak.** Mail and chat channels are how the product
reaches people. With neither, the practice depends on somebody opening the
product, which is exactly the failure mode OpenOKR exists to fix. See
[Settings](settings.md).

**Whether AI is on.** Off by default. On adds drafting and semantic review,
never a decision: every gate, score, corridor and nudge is deterministic and
runs with the provider off, and continuous integration proves it.

**What happens when somebody leaves.** Suspension removes every access and
keeps their authorship. Deletion is not the tool for this, and the product
will not offer it as one. See [People and access](people.md).

## What an administrator cannot do

Worth knowing, because each is a deliberate limit rather than a missing
feature.

| Cannot | Why |
|---|---|
| Edit or delete an audit row | The trail is append-only, enforced in the database against every connection including an owner's. [Security](security.md) |
| Change an OKR quality rule | The rules are the method, compiled from one specification. Thresholds are administrable; the rules are not |
| Read another workspace | The tenant floor is in the database, not in the interface |
| Suspend the last person with full access | A workspace that nobody can administer is a workspace nobody can recover |
| Turn off an agent's audit trail | Every proactive message is a recorded row with the rule that sent it |

## Pages

- [People and access](people.md)
- [Security](security.md)
- [Settings](settings.md)
- [Operations](operations.md)
