---
"@openokr/web": patch
---

A key result drafted on the cycle screen can now name its owner and due date.

The quality check that asks for a baseline, a target, a due date and an owner
failed on every key result drafted in the browser, because the form offered
neither. New key results now default to the objective's champion and the
cycle's last day, and existing ones can be changed in place. The starter
template gives its key results an owner and a date too, so a fresh workspace
no longer starts with failing checks. An owner must be a member of the
workspace, and a due date must be a date. Agents and unclaimed members are no
longer offered as champions, reviewers or owners.
