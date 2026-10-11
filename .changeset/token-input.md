---
"@openokr/web": patch
"@openokr/ui": patch
"@openokr/core": patch
"@openokr/formats": patch
---

Lists of domains, hosts, scopes and terms are entered one entry at a time.

Trusted email domains, a link's allowed domains, SSO's scopes and email
domains, the hosts an AI request may reach, and a workspace's own word-list
terms now turn each entry into a chip as you type or paste. A wrong entry is
marked where it stands and says why, and the form will not save while one is
there. Each word list's box is now named with its list.

A link's allowed domains and an SSO connection's email domains must now be
domains, like example.com, as trusted domains already had to be. Before, any
word was stored and matched nobody's address. API clients sending
`invitations.createWorkspaceLink` with an entry such as "@example.com" now
get a refusal that says so.
