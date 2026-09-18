---
"openokr": minor
---

A public demonstration instance, and a reset that rebuilds it from nothing.

`deploy/demo/` is an overlay on the Compose target rather than a second
deployment. It changes two things: the sign-in page names the seven people
anybody may sign in as and publishes the password they share, and Postgres is
published on the loopback address so the seed can reach it. Nothing is switched
off, no gate is loosened, and no feature is hidden.

`deploy/demo/reset.sh` destroys the demo compose project including its volumes,
starts it again with fresh secrets, waits for health, claims the instance,
seeds the organisation and gives the cast their accounts. Put it in cron and
the instance is the same one every visitor sees.

It destroys everything every time. An instance strangers can write to
accumulates whatever they wrote, and a reset that deleted only what visitors
added would be a delete path across 129 tables that nobody exercises. The
compose project name is fixed in the script rather than read from the
environment.

Also fixes a defect this work sat next to: `/api/sso-providers` has been
fetched by the sign-in page since single sign-on shipped and was never on the
proxy's public list, so on a deployed instance every request for it was
answered with a redirect to the sign-in page. The page caught the failure and
rendered no buttons, which is why nobody saw it: an instance with single
sign-on configured showed no way to use it, and no error either.
