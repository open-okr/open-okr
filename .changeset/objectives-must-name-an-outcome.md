---
"openokr": minor
---

An objective that names an output now blocks publishing, and the drafting
phase says when it is done.

Publish gate 2 used to judge key results only, so an objective such as
"Launch the new mobile app" could be published without a word. It now also
refuses an objective that fails the outcome-not-output check, as the
requirements always said it should. A warning still does not block, and an
administrator can still publish over a red gate with a recorded reason.

Phase 4 ("Draft OKRs") is now computed from the drafted set: it names each
objective that still fails a quality check, and which checks. Phase 5's gate
list now judges gate 2 as the publish button does, instead of reporting it as
impossible to check.
