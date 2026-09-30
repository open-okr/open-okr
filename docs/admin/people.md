# People and access

## How somebody joins

| Way in | Where | Good for |
|---|---|---|
| An invitation link | Admin, Invitations | Almost everybody. A link can be for one person or reusable |
| A trusted email domain | Admin, General | An organisation where anybody with a confirmed company address should be able to join without being asked. They are offered the workspace when they sign in and join with one press. See [Trusted email domains](settings.md#trusted-email-domains) |
| Single sign-on | Admin, Single sign-on | An organisation that already has an identity provider. First sign-in creates the account and puts them in this workspace |
| Directory sync | Admin, Directory sync | An organisation whose identity provider should own the member list outright |

Registration is closed on a self-hosted instance the moment the owner account
exists. An invitation, single sign-on and directory sync are the exceptions
that create an account there. A trusted domain is not one of them: it admits
people who already have an account, or who can create one because
registration is open, as it is on a managed cloud.

## Access levels

Four, and they compose: where two grants overlap, the higher one wins.

| Level | Can |
|---|---|
| **View** | Read what has been shared with them |
| **Comment** | That, and take part: comments, reactions, confidence votes |
| **Edit** | That, and do the work: goals, check-ins, initiatives, tasks, exports |
| **Full** | That, and administer: settings, people, access, the admin screens |

Access is a relationship, not a role list: a grant is on a named space, goal or
KPI tree, and every read goes through one access-aware getter that returns
not-found rather than forbidden. A suspended member is excluded everywhere.

## When somebody leaves

**Suspend them.** Admin, People, then the member. Suspension takes back every
access immediately: their sessions stop working, their API tokens stop working,
and every grant they held stops answering. What they wrote stays, attributed to
them, because a check-in whose author vanished is a falsified record.

Directory sync does the same thing automatically: a person removed from the
directory is suspended on the next synchronisation, never deleted.

**The last administrator cannot be suspended.** A workspace nobody can
administer cannot be recovered, so the product refuses and says why. Appoint
somebody else first.

**Erasure is a separate, deliberate act.** It anonymises rather than deletes:
authorship is preserved, personal data is not. It exists for a legal request,
not for offboarding.

| What erasure does | Detail |
|---|---|
| The member | Renamed "Erased member", profile cleared, suspended, unlinked from their account |
| The feed | No entry names them any more, including entries written before the erasure |
| Their sign-in account | Anonymised, signed out everywhere and its password, passkeys and second factor removed, **but only when this was their only workspace**. If they belong to another workspace the account is left for it, and the audit entry says how many other workspaces there are |
| Their data | Handed to you as one document before anything is removed |

Anybody can take the same document about themselves at any time from **Account,
Security, Your data**. Nobody is asked or told.

## Guests

A guest is a member of a narrower kind: somebody from outside the organisation
who sees what they were invited to and nothing else. A guest never reaches
anything through the workspace or a space's standard groups, only through a
grant that names them, and a guest is not a seat.

| How somebody becomes a guest | What they reach |
|---|---|
| **Admin, Invitations, Invite a guest.** One address, one space, used once | View on that one space. Nothing on the workspace itself |
| **Converting a member**, from their profile | Nothing, until somebody puts them in a space |
| **Putting a guest in a space**, from the space's management card | View on that space. Taking them out of it takes the view back |
| The cloud support session | The level the customer chose on the workspace, for the window the customer set |

A guest who signs in lands on the list of spaces they can open, because the
Work Map is the whole workspace's and nothing on it is theirs to read. A guest
sees the space's home, its members and the KPIs the space owns. A goal
carries an access grant of its own, and a guest reaches a goal only through a
grant that names them. There is no screen yet for sharing one goal with a
guest, so today a guest sees a space's goals list as empty.

Somebody who is already a member and accepts a guest invitation stays a
member: an invitation never demotes anybody. They are put in the space.

`can()` answers for a guest exactly as it answers for anybody else, so there is
no second authorisation path that could disagree with the first.

## Next

- [Security](security.md) for single sign-on, directory sync and the second-factor policy.
- [Settings](settings.md) for trusted domains.
