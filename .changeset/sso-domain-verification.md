---
"@openokr/core": minor
"@openokr/db": minor
"@openokr/adapters": minor
"@openokr/web": minor
---

A single sign-on domain can be proved with a DNS TXT record. Enforcement can be turned on only for verified domains, a free-mail domain can never be verified, one workspace on an instance owns a verified domain, and a new password sign-up on a verified, enforced domain is refused. Verified domains are checked again every day and lose verification after three failed checks. Connections that already enforce keep enforcing for their members. An instance administrator can mark a domain verified by hand on an instance with no public DNS.
