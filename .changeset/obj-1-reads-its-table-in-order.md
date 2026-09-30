---
"@openokr/web": patch
---

The "outcome, not output" check on an objective now reads its rows in the
method's own order.

The check is first match wins, and it asked about an output verb anywhere in
the sentence second to last. So "Grow revenue so that we can launch in Europe"
passed on its why and never met the warning the method gives for output
language. The method's order now applies, with one agreed change to the
method itself: a sentence shaped like an end state is recognised first, since
the method's own example of one contains an output verb. The conformance check
now compares every condition table in order, so the two cannot drift apart
again.
