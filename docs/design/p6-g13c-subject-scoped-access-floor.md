# P6-G13c: the access floor measures the subject, not the workspace

Status: approved by Agung on 9 September 2026, implemented the same day.
Decided by Agung on 9 September 2026: measure the floor against the task's
subject context. The two alternatives, a narrow workspace grant for agents and
`scoped_direct` as proposals-only, were declined.

**One deviation, recorded at implementation.** The floor takes the **higher**
of the workspace level and the subject level, rather than the subject's
instead of the workspace's. See "The design" below, which says why.

## The defect

`runOperation` refuses a write when the actor's level is below the action's
declared `access`. It resolves that level against the **workspace's own
context**, with a comment saying the floor is coarse and per-resource
authorisation happens inside through `getAccessScoped`.

Those two sentences disagree. A floor measured against the workspace is not a
coarse version of "may this actor act on this thing"; it is a different
question with a different answer.

It does not bite humans. Every active member holds `edit` on the workspace's
own context through `workspace_standard` at provisioning, so the floor is
satisfied for everybody and the real check is the one inside.

It bites agents, because an agent gets bindings on named spaces, goals and KPI
trees only, and no `workspace_standard`. Measured at P6-G13b: an agent bound to
one space at level 100, running `spaces.update` on that same space, is refused
with "needs a higher access level than you hold."

So CLAUDE.md's least-privilege rule and the pipeline cannot both stand. P6-G13b
enforced the rule, six of thirty-four agent tests failed, and the refusal was
withdrawn rather than ship an autonomy mode no agent can act in.

## Why the obvious fix does not work

The floor is checked **before** `execute` runs. The subject is only known
**after** it returns, because `outcome.activity.subjectType` and `subjectId`
come out of `execute`. There is nothing to measure against at the moment the
measurement happens.

That is why the workspace context was used, and it is the real constraint any
design has to answer.

## The design

**An operation declares its subject up front, when it has one.**

`OperationSpec` gains an optional `subject`:

```ts
readonly subject?: {
  readonly type: string;
  readonly id: string;
};
```

Most write actions already know it from their own input before `execute`:
`goals.update` has `input.id`, `spaces.update` has `input.id`,
`tasks.setStatus` has `input.id`. The action passes it beside `action` and
`workspaceId`.

**The floor takes the higher of the two, and falls back.**

| Case | Floor measured against |
|---|---|
| `subject` declared and resolvable | the higher of the workspace level and the subject's |
| `subject` declared, `resolveSubjectContext` has no resolver for its type | the workspace, as today |
| No `subject` | the workspace, as today |
| `bootstrap: true` | skipped, as today |

**Why the higher of the two, and not the subject's instead.** This design said
"measure against the subject", and replacing one with the other turned out to
be the wrong reading of it, for two reasons found while writing the code.

A replacement narrows the floor for every actor who holds the workspace and
nothing on the row in front of them. Those refusals are answered today by
`getAccessScoped` with `not_found`, deliberately, so that a caller cannot tell
a row they may not see from a row that does not exist. Moving them to a
`forbidden` from the floor turns every action that declares a subject into an
existence oracle.

It also contradicts this document's own "not a widening, not a narrowing"
paragraph and its acceptance criterion that a human's writes are unchanged.

Taking the maximum adds a way to pass the floor and removes none. The agent
case, which is the whole reason for the task, is answered: an agent holds
nothing on the workspace, so the subject's level is the only one it has and
the maximum is that. The real check inside is untouched and remains the one
that decides.

**A destructive action declares no subject, and that was measured.** With
`initiatives.delete` declaring one, `initiatives.test.ts` failed on the case it
was written for: a delete asks two gates, `full` on the workspace and `full` on
the row, and the maximum collapses the first into the second, so the owner of
an initiative could delete it while holding nothing else. That test has said
since P5-T10a that owning a thing does not make somebody able to delete things.
So `goals.delete`, `initiatives.delete` and `tasks.delete` keep the workspace
floor, and the five that declare a subject are all `edit`.

The fallback matters: forty-odd write actions do not name a subject before
executing, and this design does not require them to. Nothing about them
changes. What changes is that an action which *does* declare one is measured
against the thing it is about.

**Then the refusal comes back.** `agents.bindScope` refuses
`resourceType: "workspace"`, `run-executor.test.ts` binds a space again, and
`scoped_direct` becomes a mode an agent can act in.

## What this is not

- Not a change to `getAccessScoped`. Per-resource authorisation is unchanged,
  and it remains the real check.
- Not a widening. An actor who passes the floor against a subject still meets
  every check inside. An actor who passed the floor against the workspace but
  holds nothing on the subject was already refused inside; this refuses them
  one step earlier and with a truer message.
- Not a migration. No column, no policy, no data.

## Rollout

One task, one commit, in this order:

1. `OperationSpec.subject`, the floor change, and the fallback. Every existing
   test stays green, because no action declares a subject yet.
2. The agent write paths declare theirs. `packages/agents`' six executor tests
   move back to a space binding and pass.
3. `agents.bindScope` refuses the workspace again, with its own test.
4. Actions whose subject is knowable declare it, one file at a time. Optional,
   and not this task's: each one narrows a floor that is currently coarse.

## Test plan

- An agent bound to one space at `full` performs a direct write inside it.
- The same agent is refused in another space. The refusal comes from the floor,
  not from `getAccessScoped`: an agent holds nothing on the workspace and
  nothing on that space, so the maximum is zero and the floor answers first.
  That is the same answer an agent got before this change, so it leaks nothing
  that was not already visible.
- An agent bound to nothing writes nothing.
- A human member's writes are unchanged across the whole `packages/core` suite,
  which is the evidence that the fallback is doing its job.
- `agents.bindScope` refuses `workspace` and has a test saying so.
- The seeded Champion and Coach, bound per space at provisioning, are
  unaffected.

## Acceptance

Given an agent in `scoped_direct` bound to one space, when it runs a task
against a goal in that space, then the write lands; and when it runs one
against a goal in another space, then it is refused.

Given any human member, when they perform any write they could perform before
this change, then it still lands.

## Documents this touches

- `TECHNICAL-PLAN.md` §8.1, which describes the pipeline's layers: the floor's
  subject needs one sentence.
- Nothing in `METHOD.md`. This is not a practice rule.
- Nothing in `AI-NATIVE-PLAN.md` §6. `scoped_direct` keeps the meaning it was
  given; this is what makes it true.
