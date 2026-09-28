---
"openokr": patch
---

A check-in submitted through Slack's form is no longer lost on an instance
whose database role cannot bypass row-level security.

Every Slack slash command opens a form, so the form is the main way to check
in from Slack. Finding who submitted it asked the database without saying
which workspace it was for, and a correctly restricted database answers that
with nothing, so the check-in was dropped without a reply. It only worked on
installs that ran as a database superuser, which none do now.
