# Good first issues

For the maintainer opening them, and for the contributor picking one up.

**A good first issue is real work with a named file to start in.** Busywork
dressed up as an on-ramp wastes the contributor's evening and the maintainer's
review. Everything below is something the project actually wants, small enough
to finish in one sitting, and self-contained enough that getting it wrong
breaks nothing else.

Each one names where to start. That is the part that turns an issue into an
on-ramp: a newcomer's hardest problem is not the change, it is finding the file.

## What makes one

| It is | It is not |
|---|---|
| One file, or one file and its test | A change that touches the Operation pipeline, `can()`, or a migration |
| Behaviour somebody noticed | A refactor nobody asked for |
| Testable with the existing harness | Something needing a new kind of test |
| Reviewable in ten minutes | A task from `IMPLEMENTATION-PLAN.md` |

Never label a task from the implementation plan as a good first issue. Those
have a Definition of Ready, a design gate behind some of them, and an execution
protocol; they are not an introduction to the project.

## The ones that are open now

These are written as a maintainer would paste them into an issue. Delete a row
when it is done, and add one whenever you notice something that fits.

### A goal page line that is wrong for one case

`apps/web/app/goals/[id]/page.tsx` tells an objective with a parent and no
contribution statement that "publish gate 3 is red". The gate is right and the
sentence is not: gate 3 asks for a statement only on an objective with **no**
parent. One condition. `DEMO-SCRIPT.md` describes how to reproduce it.

### The quarterly review's stage list is not keyboard-reachable in one place

`e2e/s43b-accessibility-keyboard.spec.ts` drives the primary flows with the
keyboard alone. Add the quarterly review's stage rail to it, and fix what the
spec finds. Start by running the spec.

### The seed says a note that is no longer true

`packages/core/src/demo/builder.ts` prints notes after a seed, "worth knowing
before you present it". Some describe a limitation that a later task removed.
Read them against the product and delete the ones that have stopped being true.
This is a good way to learn what the demo contains.

### A threshold quoted in prose rather than read from the registry

`pnpm check:docs` checks every number `docs/handbook/numbers.md` quotes against
the method registry. Other pages quote numbers in passing and are not checked.
Find one, and either make it read from the registry or replace it with a link.

### The command line has no shell completion

`packages/cli` reads `contract/cli.json` and nothing else, so completion can be
generated from the same file that generates the commands. One new subcommand
printing a bash or zsh completion script. No new dependency.

### An empty state that says nothing useful

Pick any screen, empty its data, and read what it says. Several say only that
there is nothing. A good empty state says what would put something there.
`UIUX-PLAN.md` §9 is the quality bar.

## Labelling

Label them `good first issue`, and add one of `area:ui`, `area:core`,
`area:docs` or `area:cli` so somebody can pick by what they enjoy.

Do not assign them. A newcomer who has to ask for permission before starting
usually does not start.

## Related

- [Contributing](../../CONTRIBUTING.md)
- [Governance](../../GOVERNANCE.md)
