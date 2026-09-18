# People and access

## How somebody joins

| Way in | Where | Good for |
|---|---|---|
| An invitation link | Admin, Invitations | Almost everybody. A link can be for one person or reusable |
| A trusted email domain | Admin, General | An organisation where anybody with a company address should be able to join without being asked |
| Single sign-on | Admin, Single sign-on | An organisation that already has an identity provider. First sign-in creates the account and puts them in this workspace |
| Directory sync | Admin, Directory sync | An organisation whose identity provider should own the member list outright |

Registration is closed on a self-hosted instance the moment the owner account
exists. That is the rule these four routes are exceptions to, and the reason
there is no fifth.

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

## Guests

A guest is a member of a narrower kind, used for the cloud support session: the
vendor's operator gets a real member row, bound at the level the customer
chose, for the window the customer set. `can()` answers for them exactly as it
answers for anybody else, so there is no second authorisation path that could
disagree with the first.

## Next

- [Security](security.md) for single sign-on, directory sync and the second-factor policy.
- [Settings](settings.md) for trusted domains.
