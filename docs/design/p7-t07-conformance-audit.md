# P7-T07: the method conformance audit

What the conformance suite checked before this task, what it checks now, and
the five findings the audit produced. Written 11 September 2026.

Nothing in METHOD.md was changed. Every finding below is a question for a
human, because a rule, a threshold, a word list and a coaching message are
all human decisions under CLAUDE.md.

## 1. What the suite checked before, and the gap

`pnpm method:check` verified five things: the rule keys, the §11 threshold
registry, the §4.1 and §4.2 word lists, the approved corpus, and §8.2's read
of the room.

Every one of those is a rule that fires or a number it fires on. **Not one
of METHOD.md's enumerations was checked**, and those are most of what §2, §7
and §8 are made of.

| Now checked | Section | Items | Compared on |
|---|---|---|---|
| The eight phases | §2.2 | 8 | title, in order |
| The root causes | §8.4 | 8 | text, in order |
| The blocker taxonomy | §7.3 | 5 | label and definition |
| The three rituals | §7.1 | 3 | length, frequency, purpose |
| The process-health statements | §8.5 | 3+ | text, in order |
| The management retro questions | §8.7 | 4 | text, in order |
| The review stages | §8.1 | 11 | title, act, purpose |
| The weekly steps | §7.2 | 4 | title, in order |
| The close decisions | §8.8 | 3 | label and meaning |
| The rhythm diagnostic | §8.6 | 3 | diagnosis and prescription |
| The publish gates | §4.5 | 6 | count only, see finding 5 |

Eighteen comparisons in all. Every one runs in both directions: a list item
in the document and not in the package fails, and so does the reverse.

**Each check was proved by breaking it.** A conformance check that has never
failed is a check nobody knows works. Five deliberate one-word edits were
made and reverted, and each produced the expected failure naming the
position, the document's text and the package's.

Why order is compared and not only membership: the phase a workspace is in is
stored as a number, so a reordered list would renumber every cycle in the
database. The review stages are an agenda people walk through. For the rest,
a list that reads in one order in the document and another on the screen is
the same problem as a missing item.

### What is deliberately not compared

The quarterly stage minutes. §11 lists "Quarterly stage minutes" as a
parameter in the same registry that says the stage order cannot change, so
they are a threshold and the registry check already owns them.

## 2. Reading twenty real drafts

`pnpm method:verdicts` runs twenty drafts through the quality canon and
prints every verdict with the rule that produced it. The drafts are the
shapes real teams write, not inputs built to trip a rule: activity disguised
as an outcome, a target buried in the title, a set of eleven, a moonshot, an
individual objective that is really a job description.

Each draft is scored at two moments, and the difference between them is the
point.

| Moment | Clean | Warnings | Refusals |
|---|---|---|---|
| As first typed: the sentence and nothing else | 0 of 20 | 27 | 70 |
| With what the sentence plainly states filled in | 0 of 20 | 47 | 21 |

## 3. The five findings

### Finding 1. OBJ-1 warns on sixteen of twenty objectives

**The most consequential finding.** §4.1's OBJ-1 has a "Cannot tell" fallback
row that warns with *"Could you complete this without anything actually
improving? If yes, rewrite around the improvement."*

An objective reaches `pass` on OBJ-1 only by matching the movement-with-a-why
shape or by containing one of the twenty-two **state words**: become, be the,
delight, delighted, loved, trusted, leading, best, strongest, profitable,
sustainable, engaged, thriving, world-class, prefer, preferred, go-to,
healthiest, excellence, dominant, known for, famous for, proud.

So a natural and well-formed English outcome, *"Make the support queue
something the team can keep on top of"*, matches nothing and warns. So does
*"Make the platform something an auditor can verify unaided"*. Sixteen of
twenty real drafts landed in "Cannot tell", including every one written
deliberately as an outcome.

A check that fires on nineteen objectives out of twenty (sixteen warnings
plus three refusals) is not coaching. It is a banner.

Three ways out, and the choice is a human's:

1. Grow the state-word list. Cheap, and it will always be behind English.
2. Recognise the shape rather than the vocabulary. "Make X something Y" and
   "Reach the point where X" are end-state sentences with no state word in
   them.
3. Make "Cannot tell" a `pass` with no prompt, and let OBJ-1 speak only when
   it has actually seen output language or a bare metric.

### Finding 2. KR-4 warns on all twenty

§4.2's KR-4 warns when every measure in a set is lagging. Twenty of twenty
drafts warn, because outcome measures usually *are* lagging and a team
writing good ones will hit this every time.

The warning is right on the practice: METHOD.md wants a leading indicator so
a team finds out before the quarter ends. The question is whether a warning
that is always on is a warning anybody reads, and whether the prompt should
say what a leading indicator for *this* set would look like rather than only
that there is none.

### Finding 3. Nothing reads a baseline out of the member's own sentence

The quality engine reads `baselineValue`, `targetValue`, `direction` and
`indicatorType` from the key result's own columns. With the AI provider off
there is nothing that offers those from what the member has already typed.

So *"Raise trial-to-paid conversion from 11% to 18%"* is refused by KR-2,
KR-3 and KR-7 for three facts its own sentence states. Across twenty drafts
that is the 70-to-21 gap in the table above: **forty-nine refusals that a
deterministic parse of "from X to Y" would clear.**

The harness has such a parser, in about ten lines, deliberately placed there
rather than in the product so that this finding could be measured rather than
asserted. Whether the product should offer the values, pre-fill them, or keep
refusing until a member types them is a product decision.

This is the single largest contributor to the false-positive rate the task
asks to be tuned.

### Finding 4. The canon has no duplicate-measure and no compound-measure check

Two drafts passed with no refusal that a practitioner would send back:

- Draft 10 carries *"Cut median first response time from 9 hours to 2 hours"*
  and *"Reduce average first response time from 11 hours to 3 hours"*. Two of
  three key results measure the same thing.
- Draft 18 carries *"Cut time to offer from 38 days to 21 days and raise
  offer acceptance from 62% to 80%"*. One key result that is two.

**The code is right and the document is silent.** §4.2 declares exactly seven
checks, KR-1 to KR-7, and neither case is among them. This is not drift. It
is a question about whether the canon should cover them, which only a human
may answer.

### Finding 5. Four publish-gate titles are worded differently

§4.5's six gates and the package's `GATE_TITLES` carry the same six rules in
the same order. Four are worded differently.

| # | METHOD.md §4.5 | packages/method |
|---|---|---|
| 1 | Every objective has a title, a named champion and a named reviewer. | Every objective has a title, a champion and a reviewer |
| 2 | Every key result passes the §4.2 checks. | Every key result passes the quality checks |
| 3 | Alignment is mapped. Each objective states what it contributes to. | Alignment is mapped: each objective states what it contributes to |
| 5 | Capacity is checked. Nothing is left marked as exceeding capacity. | Capacity is checked, and nothing is left exceeding it |

Gates 4 and 6 match apart from a full stop.

**Not resolved in either direction, on purpose.** The document's second
sentence is *"Every key result passes the §4.2 checks"*, and a section
reference is not something to put beside a publish button, so verbatim is
the wrong answer here. The conformance check therefore asserts the count and
that no gate has been added or removed, which is the part a machine can
judge, and this table is the part a human should rule on.

## 4. Acceptance

> The conformance suite is complete, and a human confirms that a sample of
> twenty real OKR drafts receive verdicts they agree with.

The first half is done: eighteen enumerations, five rule families and the
threshold registry, each proved by being broken.

The second half is **outstanding and cannot be closed by this side.** Run
`pnpm method:verdicts`, read the twenty, and rule on findings 1 to 5. A
verdict you disagree with is a change to a word list, a threshold or a
coaching message, and all three are yours.
