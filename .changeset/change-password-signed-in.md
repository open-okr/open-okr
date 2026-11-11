---
"@openokr/web": minor
---

You can change your password while signed in, on Security: the current one, the new one twice, and "Sign out my other devices", ticked by default, which ends every other session and leaves API tokens and connected apps working. An account that signs in only by single sign-on can set a password there instead, within ten minutes of signing in. Every change, set and completed reset now mails the account's address and writes `auth.password_changed` to the instance audit chain, including a direct call to `/api/auth/change-password`. A wrong current password, and every other password check behind a session, counts toward the sign-in hold, and password changes are limited to ten a minute per network. Demonstration accounts can no longer change their password or turn a one-time code on or off.
