---
"openokr": minor
---

A trusted email domain now lets people join.

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
