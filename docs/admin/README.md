# Administrator guide

For the person who owns an OpenOKR instance or a workspace inside one.

Everything an administrator can change lives under **Admin** in the left
navigation. Every screen there needs full access, which is what the owner
account has and what an administrator can grant to somebody else.

## The screens, and what each one owns

| Screen | What you decide there |
|---|---|
| **General** | Timezone, language, trusted email domains, the second-factor policy, the workspace state, and whether to open the first-day setup again. Reopening it keeps every answer, and every administrator is sent to it from the Work Map until somebody finishes it |
| **Plan and seats** | The plan and how many seats it carries. Cloud only; a self-hosted instance is never seat-limited |
| **Support access** | Whether the vendor may look, for how long, and with what reason. Cloud only |
| **Single sign-on** | An OIDC or SAML 2.0 provider, which email domains it claims, and whether it is enforced. Each connection can be changed, turned off and removed there too. See [Security](security.md#single-sign-on) |
| **Directory sync** | The SCIM endpoint and its bearer token, so an identity provider provisions people |
| **Audit trail** | Verify the hash chain, browse the trail newest first, and export it, with one filter for both |
| **Branding** | The workspace's own colour, which every screen of the workspace is drawn in. See [Settings](settings.md) |
| **Rhythm and thresholds** | The cadence, the staleness grace, the numbers the coaching rules fire on, and the workspace's own words for the method's terms. See [Terminology](settings.md#terminology) |
| **Channels** | Slack, Microsoft Teams, WhatsApp and Telegram, and the templates each one uses |
| **Nudge volume** | Which proactive messages are on, and how loudly they escalate |
| **Invitations** | Links that let somebody join, and what they are worth |
| **Deleted items** | Bringing back a goal, initiative, task or document somebody deleted. See [below](#bringing-something-back) |
| **Import** | Bringing a quarter of history in from a spreadsheet or from FlowyTeam, starting from a downloadable template. See [Importing](../import/README.md#templates) |
| **AI** | Whether AI is on at all, whose key, which models, the cost caps, and what may leave for a provider off your network: how much context, whether addresses and phone numbers are replaced first, a no-training request, and which hosts may be reached |
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

## Bringing something back

A delete in OpenOKR destroys nothing. A deleted goal, initiative, task or
document leaves every list and every search, and its history stays readable.

| When | How |
|---|---|
| Straight after the delete | The page you land on shows **Undo** for six seconds. Press it and you are back where you were |
| Any time later | **Admin**, **Deleted items**, then **Restore** on the row. The list says who deleted each one and when |

What comes back with it:

| Deleted | Comes back with |
|---|---|
| A goal | Its key results, except any removed before the goal was deleted |
| An initiative | Its links to key results. Publish gate five counts it again |
| A task | Its assignees and its checklist |
| A document | Its versions, which the delete never touched |

Two limits, both deliberate:

- **You see what you could have deleted.** Restoring asks the same access the
  delete asked: full access to the workspace and to the item itself. A goal
  you are not the champion of is not on your list.
- **A parent comes back first.** A task on a deleted initiative, or a document
  on a deleted goal or initiative, is refused until that parent is restored,
  and the refusal names it.

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
