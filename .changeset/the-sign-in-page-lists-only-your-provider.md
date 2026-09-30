---
"@openokr/web": patch
---

The sign-in page no longer tells anybody which organisations use single
sign-on on this instance.

The list of single sign-on providers the sign-in page reads is public, because
nobody on that page has signed in. It returned every enabled connection on the
instance with its workspace id, its email domains and whether it enforces
single sign-on, and it drew every one as a button. On a self-hosted instance
that is one organisation's own sign-in page. On a shared instance it was a list
of every customer and their identity provider.

On a shared instance the page now shows no provider until you type your
address, and then only the one for your domain. A self-hosted instance still
shows its own providers straight away. Either way the page learns a provider's
name and protocol and nothing else.
