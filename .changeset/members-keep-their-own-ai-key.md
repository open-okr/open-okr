---
"openokr": minor
---

A member can keep their own AI key, and their own requests use it.

An administrator could already let members supply their own key for a
provider, and nothing in the product let a member do it. There is now a
**Your AI keys** page in every member's account menu. For each provider the
workspace opens to personal keys, a member pastes a key once, and from then on
sees only whether one is stored, its last four characters, its status and the
date it was stored. They can replace it or remove it. Nobody, including an
administrator, can read it back.

The key is used for that member's own requests: the assists they run and
Copilot's answers to them. The workspace's key still answers everybody else,
and the Coach and the Champion always run on the workspace's key. On a
workspace that holds no key of its own, the assists now appear for a member
who has stored one and stay hidden for everybody else.

A key with a space, a line break or curly quotes inside it is now refused when
it is pasted, for a workspace key as well as a personal one, instead of being
stored and then refused by the provider on every request. The AI console says
where members keep their keys, beside the setting that allows them.

For the API: `ai.readOwnCredentialStatus` now says when each key was stored
(`setAt`), and `ai.readAvailability` counts the caller's own key.
