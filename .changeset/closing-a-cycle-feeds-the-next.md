---
"openokr": minor
---

Closing a cycle is one act now, and it feeds the next cycle by itself.

The method says that at the close the product hands the next cycle its
inheritance automatically. It did not. Recording the result was a button on the
scorecard, handing over to the next cycle was another, and nothing ever marked a
cycle closed, so a cycle stayed open for good and the next one inherited only
what somebody remembered to press. The feed-forward button on phase 7 did not
work at all.

Phase 7 now has **Close the cycle**, and the scorecard offers the same close for
a cycle that has stopped being current. It waits until every key result is
scored and the retrospective is written, and lists what is still missing until
then. Closing records the result on the scorecard, marks the cycle closed and
feeds the next cycle: every score and each carried item into phase 2, the
learnings into the phase 1 input pack, and the lowest-scoring process-health
statement into phase 3.

**The next cycle does not have to exist yet.** The review comes before anybody
drafts the next cycle, so usually it does not, and when it is created it
receives the same inheritance then. Phase 7 of a closed cycle shows its result,
its verdict and what the next cycle received.

**The lowest process-health statement is a phase 3 priority again**, as the
method's table says, rather than a phase 2 issue. Existing issues written the
old way are left where they are.

For API clients: `cycles.close` is new. `cycles.feedForward` stays as a re-run,
and its result reports `processPriority` (the statement, or null) in place of
the `processHealthIssue` flag. `cycles.snapshot` refuses a closed cycle, whose
result was fixed when it closed, and `cycles.feedForward` refuses to feed into
one.
