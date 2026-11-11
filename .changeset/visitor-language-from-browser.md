---
"@openokr/web": patch
---

Signed-out pages, such as sign-in, sign-up, password reset and the email confirmation page, now use the browser's language when OpenOKR ships it, today English and Malay. A Malay browser on an English instance used to read them in English. A browser in any other language reads them in the instance's language, as before. Once signed in, the member's own language and then the workspace's still decide.
