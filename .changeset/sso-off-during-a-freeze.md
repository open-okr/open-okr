---
"openokr": patch
---

Single sign-on can be turned off in a frozen workspace, a new client secret
can be set over the API, and removing a connection says it cannot be undone.

- A frozen or read-only workspace still lets an administrator turn a single
  sign-on connection off and on again, so a compromised identity provider can
  be shut out during an incident. Editing or removing one still waits until
  the workspace is active.
- The API and the command line now seal a new SSO client secret, or a new AI
  key, the same way the screen does. Before, they refused one.
- The question before removing a connection now says plainly that it cannot
  be undone.
