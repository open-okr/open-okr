---
"openokr": patch
---

An identity provider's SCIM requests now reach the instance.

Every request the directory sent was answered with a redirect to the sign-in
page, which an HTTP client reads as success at status 200. A provider carries a
bearer token and no cookie, and the SCIM surface had never been added to the
list of paths that authenticate themselves. It authenticates itself: a request
without a live token is refused with 401 in SCIM's own error shape.

Provisioning also works on an invitation-only instance, which is the kind that
runs a directory. The exception a directory-sync token carries was being set in
one copy of the server's own code and read in another, so the registration rule
refused every account with "this instance is invitation-only".
