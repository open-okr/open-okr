---
"openokr": minor
---

A workspace can require everybody to hold a second factor.

One-time codes and passkeys have been available since the first release, and
until now a workspace could only ask people to use them. Switching the new
setting on holds anybody without one in their security settings at their next
page load: they can enrol, or sign out, and nothing else.

**Off unless an organisation asks for it**, so nothing changes on upgrade.

**The administrator who switches it on is held by it too.** That is what makes
it a policy rather than a suggestion, and the setting says so beside the box.

**An account managed by an identity provider is exempt.** The provider already
enforces whatever second factor the organisation chose, and a second one here
would be a factor the organisation cannot administer or reset.
