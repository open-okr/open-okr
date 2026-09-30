---
"openokr": patch
---

A single sign-on connection works from the next sign-in, with no restart.

An OIDC provider added on Admin, Single sign-on used to reach nobody until the
server restarted, and on a deployment with several server processes, until
every one of them had. The first SAML provider on an instance waited too, and
so did its metadata document. A provider changed or removed in the database
went on answering sign-ins the old way until the same restart.

Each server process now checks for a changed connection every few seconds and
rebuilds its sign-in client when it finds one. The process that saved the
change sees it at once, and the others within a few seconds. A new client id,
new endpoints or a new certificate are used by the next sign-in, and a removed
or disabled provider refuses it. Nobody already signed in is signed out.

Renaming the instance still reaches authenticator apps and passkey prompts at
the next restart, as the General screen says.
