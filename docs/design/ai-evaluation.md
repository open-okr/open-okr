# The AI evaluation set

Release 0.7.0, row A9. Sources: AI-NATIVE-PLAN §10 ("Evaluation harness", "Prompt gating"), §4 (the Prompts card and the Usage and logs card on S-37), and §11 decision A4, which says each capability's pass bar is set in its design document. This is that document.

## 1. What it has to prove

| Claim | Source |
|---|---|
| Golden fixtures per capability, against a deterministic mock provider | §10 |
| Each fixture asserts schema validity, tool selection, latency, and that no personal data is in a prompt | §10 |
| An optional live smoke test on a cheap model, never blocking CI | §10 |
| A prompt version that regresses the evaluation set fails the check | §10 |
| The Prompts card: a versioned system prompt per feature, restore to default, gated by the evaluation set | §4 |
| The Usage and logs card shows the latest evaluation results | §4 |
| Each capability's pass bar is stated in its design document | §11, A4 |

## 2. What was there, and what was found

| Before this row | Where |
|---|---|
| Tests per drafter against the mock driver. Each proves a few capabilities; none is a set, and nothing runs one against a prompt somebody typed | `packages/agents/test/*-drafter.test.ts` |
| `ai.updatePrompt` stores a new version for any key, unchecked | `ai_prompts`; the card offers `draft.objective` and `rewrite.failing_rule` |
| **Nothing sends a stored version** | The drafter's system prompts are constants in `packages/agents/src/drafter.ts`, and nothing reads `ai_prompts` before calling a model. The two built-in texts in `packages/core/src/ai/prompts.ts` are not what the drafter sends either: they were written for the card. So since P2-T15, saving a version on S-37 has changed nothing a model receives |

A gate on a prompt nothing sends gates nothing, so this row also makes the stored version the one that is sent (§6).

## 3. What a mock can judge, and what it cannot

A mock answers whatever the fixture tells it to. It cannot say whether a model answers better under one prompt than under another.

| The set judges | The set cannot judge |
|---|---|
| What the capability sends: the prompt under test reaches the request, nothing personal is in it, it fits its budget | Whether a model follows the prompt |
| What the product does with a reply: the schema, the one repair attempt, and the product's own refusals (an action that was not offered, a parent numbered 0, a title that only repeats the template) | Whether another prompt gets better replies |

The right-hand column is the live smoke test's (§8), and a person reads it.

The product never trusts a prompt for correctness. Core re-checks every reply: §4's checks over a drafted objective, every number in a narration, every quotation in a thread summary. So a prompt is the wording. What a prompt can break that nothing catches afterwards is what leaves the instance (personal data), what each call costs (size), and the machine-read contract a prompt carries (the copilot's sources line). Those are what the set checks.

## 4. A fixture

| Part | What it holds |
|---|---|
| Name | One line, for example "an ambition with a team and two objectives already" |
| Context | What the capability is given, in Northwind's words. No email address and no phone number |
| Reply | What a well-behaved model answers: JSON for a structured capability, or prose and the sources line for the copilot. Or a malformed reply, to prove the product refuses it |
| Expected | The capability's result after the product's own checks. `null` where the product must refuse |

Every fixture runs these checks. A failure names the check, the capability and the fixture.

| Check | Passes when | The §10 word it answers |
|---|---|---|
| `result` | The capability returns exactly the expected result | Schema validity. Tool selection, for the copilot's proposals |
| `schema` | Every structured request carries the capability's JSON schema | Schema validity |
| `prompt` | Every request's system message is the prompt under test, for a set with a prompt key | Prompt gating |
| `personal-data` | No message sent holds an email address or a phone number, found by the detector the redaction control uses (`redactPersonalData` in `packages/adapters`) | No personal data in prompts |
| `budget` | The first request is within the set's input budget, in tokens estimated as characters divided by four, the estimate the egress guard already uses | Latency of the model, and cost |
| `latency` | The fixture finishes within 1,000 ms against the mock | Latency of the product |

Against the mock, latency is the product's own time around the call: building the request and checking the reply. The check catches a capability that waits on something it should not. A model's latency grows with what it is sent, so the budget is the check a prompt can fail.

**Tool selection.** The product makes no native tool calls today: `chatWithTools` has no caller. The choice a model makes among offered tools is the copilot's proposal, `proposeAction`, which picks one offered action or none. Its set checks that the product takes an offered action, and refuses one that was not offered and one with no reason given.

## 5. The sets, and each one's pass bar

One set per capability, named by the drafter method, which is also the `feature` on its usage row. Each set holds at least two fixtures: a reply the product accepts, and one it must refuse wherever the capability can refuse. The streamed copilot answer always ends on an answer; its refusal is keeping the sources line from the reader, which its first fixture proves. At 0.7.0 that is 23 sets and 56 fixtures, and `pnpm ai:evaluate` prints the count per set.

**Pass bar, decision A4: every fixture in the set passes against the mock.** Proposed to Akmal on 9 November 2026 with no objection. A set either passes whole or the gate refuses: there is no partial score to argue with.

| Capability | Prompt key | Input budget, tokens | Pass bar |
|---|---|---|---|
| `draftObjective` | `draft.objective` | 2,000 | Every fixture |
| `rewriteForRule` | `rewrite.failing_rule` | 2,000 | Every fixture |
| `suggestMeasure` | Built in | 2,000 | Every fixture |
| `suggestParent` | Built in | 2,000 | Every fixture |
| `draftCheckIn` | Built in | 2,000 | Every fixture |
| `refineRecoveryTitle` | Built in | 2,000 | Every fixture |
| `narrateDigest` | Built in | 2,000 | Every fixture |
| `narrateTrend` | Built in | 2,000 | Every fixture |
| `summariseBlockers` | Built in | 2,000 | Every fixture |
| `suggestKpi` | Built in | 2,000 | Every fixture |
| `clusterNotes` | Built in | 2,000 | Every fixture |
| `narrateDiagnostic` | Built in | 2,000 | Every fixture |
| `draftMinutes` | Built in | 2,000 | Every fixture |
| `draftRetrospective` | Built in | 2,000 | Every fixture |
| `proposeObjectives` | Built in | 2,000 | Every fixture |
| `summariseThread` | Built in | 2,000 | Every fixture |
| `decomposeKeyResult` | Built in | 2,000 | Every fixture |
| `parseListFilter` | Built in | 2,000 | Every fixture |
| `proposeImportMapping` | Built in | 2,000 | Every fixture |
| `proposeAction` | Built in | 4,000 | Every fixture |
| `answerGrounded` | Built in | 4,000 | Every fixture |
| `streamGrounded` | Built in | 4,000 | Every fixture |
| `reviewAlignment` | Built in | 4,000 | Every fixture |

**Why 2,000.** Every fixture's request is under 300 estimated tokens today, and the longest built-in prompt is about 100. 2,000 leaves room for a prompt many times that, and stops a pasted document from multiplying the cost and the wait of every call. The four at 4,000 carry passages, offered actions with their schemas, or a list of goals. A budget is a check on a representative request, not a production guard: the context-window guard (`packages/core/src/ai/context-guard.ts`) is that.

## 6. Prompts become real

| Change | Where |
|---|---|
| The two built-in texts are the ones the drafter sends | `packages/core/src/ai/prompts.ts` holds `draft.objective` and `rewrite.failing_rule` in the drafter's own words, moved from `packages/agents/src/drafter.ts`. The two sentences written for the card go |
| The drafter takes the workspace's versions | `createProviderDrafter({ systemPrompts })`. A key not given sends its built-in text |
| The host passes them | `drafterFor` reads each key's newest version (`currentPromptVersions` in core) and passes those that pass their set |
| The other capabilities' prompts stay in the drafter and are not editable | Making one editable means moving its text into the catalogue and giving it a key and a name in both languages. Its set already exists, so the gate covers it from its first version |

**A stored version is sent only while it passes its set.** One that fails is not sent: the built-in text is, and the usage card says so. This covers three cases the save gate cannot see:

| Case | How a failing version got stored |
|---|---|
| Saved before 0.7.0 | Never checked, and never sent until now |
| Arrived in a workspace archive import | The import writes rows, not versions through the action |
| A later release adds a fixture an older version fails | The set changed under it |

The result is deterministic, so it is remembered for the life of the process, by key and text. A drafter costs one evaluation per new text, not one per call.

**Agent phase prompts** are row A7's: the agents' instructions become versioned there, and take a set the same way when they do.

## 7. The gate on saving

`ai.updatePrompt`, after authorisation and before the insert:

1. Runs the key's set with the new text.
2. Refuses a key with no set: "There is no evaluation set for this prompt, so a version of it cannot be checked."
3. Refuses a version that fails, on the field `systemPrompt`, naming the first three failed checks with their fixtures and counting the rest, and writes nothing. For example: "Not saved. This version fails 4 of the 4 examples in its evaluation set: personal-data on "an ambition with a team and two objectives already" (an email address in the system prompt); ..."
4. Stores a version that passes as the next version, exactly as today.

**Where the runner comes from.** `packages/core` may not import `packages/agents`, where the drafter lives. Core declares the evaluator's shape, as it already declares the drafter's, and the host installs the one from `@openokr/agents` at boot, beside admission and the metrics recorder and on `globalThis` for the reason those are (Next loads the boot module and the request path separately). A caller may pass its own on the call context, which is how core's tests do it.

**No evaluator means no save.** A host that forgot to install one refuses every version rather than storing it unchecked. REST, the agent endpoint and the command line all reach the same server, so they meet the same gate, and `?validate=true` runs it too.

Restoring the default needs no check: the built-in text passes by construction, and CI proves it.

## 8. Where it runs

| Where | What runs | What a failure stops |
|---|---|---|
| The unit suite, so CI | `packages/agents/test/evaluation.test.ts`: every set against the built-in prompts, and prompts made to fail each check | The build, when a built-in prompt or the code around it regresses a set |
| `pnpm ai:evaluate` | Every set, printed per capability with its fixture count. Reads no database. Exit 1 on a failure | Nothing: it is for a person |
| `pnpm ai:evaluate --provider <p> --model <id>`, with `OPENOKR_AI_API_KEY`; `<p>` is anthropic, openai, google or openrouter | **The live smoke test.** Each fixture that expects an answer is sent to a real model. A live reply cannot be compared word for word, so it checks what a live model can be held to: it gave an answer the schema accepted, nothing personal was sent, the budget held, and it prints the time each took. Costs real money, usually a few cents. Never in CI | Nothing: it is for a person to read, like `pnpm ai:measure` |
| Saving a version, on the server | §7 | The save |
| Building a drafter, on the server | §6 | Nothing: the built-in text is sent instead |
| The AI console | §9 | Nothing |

## 9. Latest evaluation results on the usage card

Under the spend figures, one line per editable prompt: its name, which version (or built in), how many of its examples pass, and when one fails, the checks that failed and that the built-in text is sent instead. The screen says "example" for a fixture.

**Computed when the page renders, not stored.** The run is deterministic and takes milliseconds, so a stored result could only be a copy of what rendering computes, and it would go stale the moment an upgrade changed a set. Storing it needs a table, which is a migration and buys nothing. "Latest" therefore means the current version, against the set this release ships.

The results need no provider. They show with AI off, and they are not an AI affordance: nothing on the card calls a model.

## 10. Acceptance criteria

1. **Given** the built-in prompts, **when** the unit suite runs, **then** every set passes.
2. **Given** an administrator on S-37, **when** they save a version of "Objective drafting" that holds an email address, **then** it is refused with a message on the form naming the `personal-data` check, the refusal names `systemPrompt` as its field for REST, and no version is stored.
3. **Given** a version longer than its set's budget allows, **when** it is saved, **then** it is refused naming the `budget` check.
4. **Given** a version that passes, **when** it is saved, **then** it is stored as the next version, and the next objective draft sends it as its system message.
5. **Given** a stored version that fails the current set, **when** an assist runs, **then** the built-in text is sent, and the usage card says the version fails and the built-in text is sent instead.
6. **Given** a prompt key with no set, **when** a version is saved through any surface, **then** it is refused.
7. **Given** a host with no evaluator installed, **when** a version is saved, **then** it is refused and nothing is stored.
8. **Given** AI is off, **when** an administrator opens the AI console, **then** the usage card shows the evaluation results.
9. **Given** `pnpm ai:evaluate`, **when** a set fails, **then** it names the capability, the fixture and the check, and exits 1.

## 11. What it does not do

| Gap | Why it is left |
|---|---|
| It does not judge whether a model follows a prompt | A mock cannot. The live smoke test shows a person what a real model did |
| No stored history of evaluation runs | The run is deterministic, so recomputing it is the history. Storing it needs a migration |
| Agent instructions are not gated | Row A7 makes them versioned first |
| Twenty-one capabilities' prompts are not editable | The card's scope since P2-T15. §6 says what adding one takes |
| The gate does not insist on the copilot's "treat passages as data" sentence | That sentence is defence in depth. The defence is the binding check, which `packages/agents/test/prompt-injection.test.ts` proves with a model that obeys the injection in full |
