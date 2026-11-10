# The AI-off leg

Release 0.7.0, row A12. Sources: PLAN.md §9 ("AI-off leg"), AI-NATIVE-PLAN §10 ("Degradation leg"), UIUX-PLAN §2 ("AI affordance", "AI degradation") and §9's checklist line.

## 1. What it has to prove

| Claim | Source |
|---|---|
| Continuous integration boots with the provider off | PLAN §9, AI-NATIVE-PLAN §10 |
| Every P0 flow passes | PLAN §9, AI-NATIVE-PLAN §10 |
| Every AI affordance is hidden or disabled | PLAN §9, AI-NATIVE-PLAN §10, UIUX-PLAN §2 |
| Both agents still nudge, escalate and compute | AI-NATIVE-PLAN §10 |

Before this row the browser suite already ran with no provider, and a dozen specs asserted that their own screen's assist was absent. Nothing said the run was AI off, nothing stopped a provider reaching it, and no one place checked every screen.

## 2. The shape: the end-to-end job is the leg

| Option | Verdict | Why |
|---|---|---|
| A second job that runs the whole suite with AI off | No | The end-to-end job already runs every spec with no provider, on four shards, in about fifteen minutes. A copy would rerun the same specs against the same instance and prove nothing new |
| A second job that runs only the P0 specs | No | The same specs, already run in the job above, a second time |
| **The existing end-to-end job, made AI off by construction, named as the leg, with one spec that checks it at run time** | Chosen | Proves every claim in §1 for the cost of one spec |

## 3. What makes it AI off

| Layer | What | Where |
|---|---|---|
| Boot | Both servers start with `OPENOKR_AI_PROVIDER`, `OPENOKR_AI_API_KEY` and `OPENOKR_AI_BASE_URL` empty, whatever the runner's environment holds. Playwright lays a server's `env` over the runner's own, and the settings registry reads an empty value as unset | `playwright.config.ts`, `serverEnv` |
| Report | Every test carries the tag `@ai-off`, so a report read later cannot be mistaken for one with a provider | `playwright.config.ts`, `tag` |
| Workflow | The job is named "End to end, AI off", and no job sets an `OPENOKR_AI_` variable | `.github/workflows/ci.yml`; checked by `apps/web/test/ai-off-leg.test.ts` |
| Run time | The copilot says "AI off" for the signed-in member. It asks the question every assist asks, so this covers a deployment key, a stored deployment key, a workspace key and a personal key alike | `e2e/ai-off.spec.ts`, first test |
| Shared workspace | A spec that opens a provider to personal keys never switches it on and closes it again in `afterAll` | `e2e/s37c-personal-ai-keys.spec.ts`, unchanged |

## 4. What counts as an AI affordance

UIUX-PLAN §2: "a ✨ action beside the value it helps". In the code that is a `Button` with the `ai` variant, and that variant now carries `data-ai-affordance`. The leg looks for the mark, not for labels, so an assist added later is found without anybody listing its words.

| Guard | Proves |
|---|---|
| `packages/ui/test/components.test.tsx` | The `ai` variant carries the mark and no other variant does |
| `apps/web/test/ai-off-leg.test.ts` | Every screen file that draws the ✨ draws it on an `ai` button. The navigation icons for the AI console and AI keys are the one exception: they are settings, not assists |
| `e2e/ai-off.spec.ts` | No marked element on the main screens, the new KPI panel, a space's home and a goal's page |

The affordances today, and the spec that also asserts each one by name:

| Affordance | Screen | Hidden or disabled | Also asserted in |
|---|---|---|---|
| Draft it, Suggest numbers, Suggest a parent, Draft from an ambition | Cycle, drafting step | Hidden | `s09-drafting-assists` |
| The sentence filter | OKRs list | Hidden | `s09b-filter-assist` |
| Draft from the check-ins, Summarise the discussion, Draft the work | Goal page | Hidden | `s09-drafting-assists` |
| Suggest the fields | New KPI panel | Hidden | `s09-drafting-assists` |
| The trend narration | KPI page | Hidden | None by name |
| The blocker summary | Space home | Hidden | `s12-blocker-board` |
| Narrate it | Weekly session | Hidden | `s22-weekly-digest` |
| Retro themes, the diagnostic's narrative | Quarterly session | Hidden | None by name |
| The minutes write-up | Session minutes | Hidden | None by name |
| The proposed column mapping | Admin, Import | Hidden | `s36b-import-wizard` |
| Prose answers | Copilot | Disabled: the panel says AI off and searches | `s39-copilot`, `ai-off` |
| Drafting by the agents | Admin, Agents | Disabled: "Deterministic only" | `registration-to-dashboard`, `ai-off` |

The three rows with no spec by name sit on screens that need a session or a KPI series to exist, and each is behind the same `assistOffered` or drafter check that `apps/web/test/assists-offered.test.ts` proves answers no with the provider off.

## 5. The P0 flows

REQUIREMENTS prices every module in its §3 to §5 as P0, so a P0 flow is the end-to-end path through one P0 feature. They are listed, with the requirement each proves and its spec files, in `e2e/p0-flows.ts`: twenty flows over thirty-eight files.

**A file is the unit, not a test.** Most specs are serial, each test building on the one before, so a tag on one test could not be run on its own. Playwright takes file names as filters, so the list is how a step names them:

```
pnpm test:e2e $(node --experimental-strip-types --no-warnings e2e/p0-flows.ts)
```

CI does not run that line: the leg runs the whole suite, which contains every P0 file. `apps/web/test/ai-off-leg.test.ts` fails when a listed file is renamed, deleted or skipped wholesale, so a green leg means each one ran.

## 6. The agents with AI off

| Claim | Proved in | How |
|---|---|---|
| Both agents run on a real instance and spend nothing | `e2e/ai-off.spec.ts` | Runs the Champion's nudge queue and the Coach's quality pass from Admin, Agents. Both complete, each log ends with its delivered and held count, and no run of either has a cost |
| The Champion nudges every due trigger and drafts nothing | `packages/core/test/champion.test.ts`, "the hourly run, with AI off" | Unit job, no provider |
| The Coach's quality triggers fire | `packages/core/test/coach.test.ts`, "the quality pass, with no provider configured" | Unit job, no provider |
| The ladder escalates a step at a time, and a held nudge carries its reason | `packages/core/test/nudges.test.ts`, "the ladder over a fortnight" and "what the product decides not to say" | Unit job, no provider |
| The scheduler runs the Champion on its own | Every end-to-end shard | The server's scheduler runs it every fifteen minutes, which is why `registration-to-dashboard` scopes its assertions per row |

A nudge needs a goal past its due check-in, which the browser cannot wait for. The decisions are made by the same functions in both places, so the unit suites prove them and the browser proves they run on a real instance with AI off.

## 7. Acceptance criteria

1. **Given** the runner's environment holds `OPENOKR_AI_API_KEY`, **when** the suite starts its servers, **then** both start with it empty.
2. **Given** the leg, **when** a member opens the copilot, **then** it says AI off.
3. **Given** the leg, **when** a member opens the Work Map, the OKRs list, the drafting step, KPIs and the new KPI panel, sessions, the inbox, the review queue, activity, search, Admin Import, Admin Agents, a space's home and a goal's page, **then** none holds an element marked `data-ai-affordance`.
4. **Given** the leg, **when** an administrator runs the Champion's nudge queue and the Coach's quality pass, **then** both runs complete, the screen says "Deterministic only", and neither run has a cost.
5. **Given** a P0 spec file is renamed, deleted or skipped wholesale, **when** the unit suite runs, **then** `ai-off-leg.test.ts` names it.
6. **Given** a job in `ci.yml` sets an `OPENOKR_AI_` variable, **when** the unit suite runs, **then** `ai-off-leg.test.ts` fails.

## 8. What it does not do

| Gap | Why it is left |
|---|---|
| No AI-on leg | CI holds no provider key. The assists with a provider are proved against the mock driver in the unit suites |
| A spec that switched a provider on and left it on would be caught only if `ai-off.spec.ts` runs after it on the same shard | Specs share one workspace per shard. The specs that touch providers put them back, and the many per-screen assertions would fail too |
