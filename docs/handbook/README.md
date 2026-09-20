# The OKR handbook

For the person running the practice, not for the person building the product.

Everything here is what OpenOKR actually enforces, taken from
[METHOD.md](../development-plan/METHOD.md), which is the specification the code
compiles from. When this page quotes a number, `pnpm check:docs` checks it
against the registry that number lives in, so the handbook cannot drift from
the product.

| Page | What it covers |
|---|---|
| [Writing objectives and key results](writing.md) | What a good one looks like, and the checks that fire on a bad one |
| [The weekly rhythm](weekly.md) | The four-step session, blockers, commitments, and what happens between sessions |
| [The quarterly cycle](quarterly.md) | Eight phases, the publish gates, scoring and the closing diagnostic |
| [The numbers](numbers.md) | Every threshold the practice runs on, and where each comes from |
| [Ways of working](ways-of-working.md) | Four shapes of organisation mapped onto spaces, cycles and initiatives |

## The five ideas underneath it

**The rhythm is the product.** Objectives written in January and reviewed in
December are a wish list. What makes OKRs work is a weekly cadence somebody
actually keeps, which is why the product runs the sessions rather than
reminding you to.

**Quality is checked as you type.** A key result that is really a task, an
objective with no measure, a confidence score that never moves: these are the
failures, and they are all visible at the moment of writing. Twenty-six checks
run in the browser as you type, on the server before any write, and inside the
agents.

**Alignment is contribution, not copying.** A team objective that restates the
company objective aligns nothing. Contribution means this goal moves that one,
and the product scores how well the tree holds together and names each gap.

**Confidence is a number somebody has to own.** Reported health that never
changes is the commonest lie in OKR software. Staleness overrides it: a goal
nobody has checked in on is shown as outdated whatever its owner last claimed.

**The close asks one question.** Did we miss because the strategy was wrong, or
because the cadence broke? Every executive asks it and almost no tool answers
it. The diagnostic reads the cycle score against the rhythm score and returns a
verdict with a prescription.

## Where to start

Running your first cycle: [the quarterly cycle](quarterly.md).

Running your first week: [the weekly rhythm](weekly.md).

Fixing objectives you already have: [writing](writing.md).

Deciding how to lay the workspace out: [ways of working](ways-of-working.md).
