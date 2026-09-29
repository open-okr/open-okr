---
"openokr": patch
---

Assigning a task to the person who imported it, or handing them an imported
initiative or space, no longer fails with a database error.

An import gives the person running it edit access to what it creates, so it
can finish writing the rows it started. Giving that same person the task or
the initiative later granted the access a second time, and the database
refused the duplicate. The existing grant is now raised to the higher level
instead.
