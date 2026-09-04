# Demo script

How to stand a fresh OpenOKR instance up with demo content, and what to say when you walk somebody through it.

Two things this document will not do: claim a screen exists that does not, or hide a gap behind a phrase like "coming soon". Where the product is unfinished, the script says so and turns it into a point, because a product that tells you what it cannot judge is more convincing than one that quietly guesses.

Everything here reflects the build as of the last commit that touched this file. If a screen has moved on, the script is wrong and the product is right.

---

## 1. Set it up

About five minutes from a clean checkout. This is CONTRIBUTING.md's local setup with one command on the end.

```sh
export DATABASE_URL=postgres://postgres:postgres@localhost:55432/openokr

pnpm db:up                        # Postgres on 55432, in Docker
docker exec openokr-test-postgres-1 psql -U postgres -c "CREATE DATABASE openokr;"
pnpm db:migrate
pnpm dev                          # the app on http://localhost:3000
```

The compose stack ships no application database, which is why the `CREATE DATABASE` line is there. `pnpm db:migrate` and `pnpm db:seed` read the process environment rather than `apps/web/.env`, so either export `DATABASE_URL` as above or pass it inline on each command.

Open <http://localhost:3000>. An empty database sends you to the first-run wizard. Register yourself there: that account claims the instance and gets a workspace. **Use your real name.** The seed makes you the Chief Executive of the invented company, and a demo where the presenter cannot find themselves in the org chart is a worse demo.

Then, in another terminal:

```sh
pnpm db:seed
```

It prints what it wrote and a short list headed **"Worth knowing before you present it"**. Read that list. It is the same set of caveats as section 5 below, printed there so nobody meets one for the first time on stage.

**The compose database keeps its data in memory.** `pnpm db:down`, a Docker restart or a reboot wipes it, workspace and all. That is deliberate for a test stack, and it means a demo instance is something you rebuild rather than something you keep. Rebuilding is the block above, wizard included.

Seeding is idempotent. A workspace that already has company objectives is left alone and the command says so.

---

## 2. The company you are showing

**Northwind Labs**, a mid-market business-to-business software company, six weeks into a quarter.

Its problem is specific, and every objective and metric traces back to it: accounts that reach value inside a month renew, accounts that take longer than ninety days churn, and the median new account takes fourteen days. Meanwhile support cost per account is growing faster than revenue per account, so the company cannot serve its way out of the problem by hiring.

| | |
|---|---|
| People | 8, in a three-deep manager chain |
| Spaces | Product, Sales, Customer Success, Engineering |
| Cycle | The current quarter, in phase 5, Align and commit |
| Objectives | 7 across all four levels, plus 1 recovery objective the KPI engine launched |
| Key results | 15, plus the recovery objective's own |
| KPIs | 12 in 4 categories, with 6 months of monthly readings, in 2 driver trees |
| Check-ins | 6 published, 1 acknowledged, 1 draft still open |

---

## 3. The walkthrough

Twenty minutes at a normal pace. Each beat names the screen, the thing to point at, and the sentence that makes it land.

### Beat 1 — Overview, and the strip that will not go away (2 min)

Land on `/`.

Point at the **strip under the topbar**: `Phase 5 · Align and commit · Gate 5 is red: Capacity is checked, and nothing is left exceeding it · 51 days overdue`.

> "Before we look at a single objective, the product has already told me three things: which phase of the cycle we are in, exactly what is blocking it, and that we are past the date we said we would publish by. Nobody typed that. It is computed, and it follows me onto every page until it is fixed."

Then the **work map** below it: eight objectives, their key results, health rolled up from the measures, ownership on every row.

> "Progress here is never self-reported. Each key result's progress comes from its baseline, its target and its current value. Each objective's comes from its key results by weight. Each parent's comes from its children. There is no field anywhere called 'percent complete'."

### Beat 2 — Review, or what you personally owe (2 min)

Go to `/review`. The sidebar badge already told you the number.

> "Notifications tell you what happened. This tells you what you owe. It is grouped overdue first, and it is computed on the server so the badge and the page cannot disagree."

Two acknowledgements are waiting on you as the reviewer of record, and one check-in is coming up that you owe as champion.

Point at the panel headed **"Not here yet"**, which lists four more sources of obligation with the task each one arrives at.

> "That panel is the reason I trust this screen. It could have looked complete while quietly failing to tell me about a blocker I own. Instead it names what it cannot show me yet."

### Beat 3 — The cycle, and six gates (4 min)

Go to `/cycle`. This is the centrepiece.

**The phase rail**: eight phases, three green, with the count computed rather than self-reported. Click through phases 1, 2 and 3 to show they are filled in — the seven-item input pack, the three-column baseline health reading, four ranked strategic issues, two of them promoted into priorities.

> "Two of the four issues were deliberately not promoted. A diagnosis that turns every issue into an objective has not prioritised anything."

**The publish gates**, on phase 5. Four green, two not.

Gate 5, red, naming the exact row:

> `"Lift self-serve deflection from 12 per cent to 35 per cent" still exceeds capacity`

> "This is the whole product in one line. Somebody marked that key result as exceeding the team's capacity, and rather than let it be quietly carried into the quarter, the product refuses to publish the set and names the row. The choice in front of the leadership team is to cut the target or make the hire. It will not let them choose neither."

Gate 2, which cannot be judged at all:

> `Cannot be judged yet: the §4 quality engine arrives at P4-T01`

> "That is the honest version of an unfinished feature. The quality engine is the next phase of the build. Rather than pass the gate on an empty check, the product treats a gate it cannot evaluate exactly like a red one. A gate that checks nothing must not pass."

**The live fix.** If you want a moment where the product moves under your hands: open the objective *Serve twice the accounts on the cost base we have today*, change that key result's capacity from `exceeds` to `tight`, come back to `/cycle`, and watch gate 5 turn green. Gate 2 still holds publication, which is the point.

### Beat 4 — An objective, end to end (4 min)

Open *A new account proves the product to itself in its first thirty days* from `/goals`.

- **Roles**: Priya champions it, you review it. Both are access-bearing — moving a role rebinds access with it rather than just changing a name.
- **The contribution statement**, which is what publish gate 3 checks on any objective with no parent.
- **Three key results**, leading and lagging side by side, with weights.
- **"One value so far. A trend needs a second."** Type a second value and the trend appears. (See section 5 for why the seed leaves only one.)
- **Supported by**: three objectives below it, across two departments and one individual.
- **Discussion**: a comment and a reaction, on the objective itself.
- **Dependency register**: empty on this one, and it says what belongs there.

Then open *Onboarding runs without us in the room* to show the other side: a department objective with a parent, and a dependency on Engineering that is **not confirmed** but **is** risk-owned by Mei.

> "Publish gate 4 asks that every dependency is either confirmed by the team providing it, or logged with a named person carrying the risk. Three entries in this set, and they pass three different ways: one confirmed, one risk-owned inside the company, one naming an outside party the company cannot confirm with. Nobody is allowed to just not answer."

### Beat 5 — Alignment (2 min)

Go to `/goals/studio`.

The alignment health score is **79**, above its threshold of 75, so the set is healthy — and there are still four open findings, including one at high severity.

> "Healthy is not the same as finished. The high-severity finding is a team objective with no parent, which supports nothing above it. The score does not hide it, and the score is not a grade — it is a prompt."

### Beat 6 — KPIs, and an objective the product wrote (4 min)

Go to `/kpis`. Twelve measures in four categories, six months of readings each, entered like a spreadsheet.

Show the five states on one screen: **healthy**, **watch**, **unhealthy**, **recovering**, and one measure with **no data** at all.

> "A KPI nobody has recorded is unmeasured, not failing. It says `no data` rather than showing zero, because zero is a claim and this product does not make claims it cannot support."

Point at **Support cost per ticket**, marked `calculated`. Its value comes from a formula over two other KPIs — a typed expression tree, never a parsed string, so there is nothing here that can be talked into running code. Its cells are read-only, because the next evaluation would overwrite anything typed.

Go to `/kpis/trees`. Two driver trees, drawn by depth and health.

> "Read it the way the method says to: find the unhealthy branch, then look at the leading drivers at its edge. Those drivers are what you can actually pull."

Go to `/kpis/recovery`. **Operating margin** is below its corridor and shows as `recovering`, with an objective under it: *Bring Operating margin back to 15*.

> "Nobody wrote that objective. The metric fell through its corridor floor, and the engine walked the unhealthy branch of its driver tree breadth-first and turned the leading drivers at the edge into key results. This is the product proposing work rather than waiting to be told."

Point at the card showing **both** the projected figure and the real one.

> "While a recovery is open, the KPI reads better than it is, because the recovery's own progress counts toward it. The card shows you both numbers side by side, so nobody mistakes a recovery in progress for a metric that recovered."

The other six unhealthy measures each carry a **Launch recovery** button. Click one to show the engine drafting live.

### Beat 7 — Spaces and people (1 min)

`/spaces`: four team homes, with managers, one coordinator each, and membership that is what actually grants the right to work in them.

> "Every space is visible to everyone. Being in one is what lets you work in it. That is the access model, not a setting."

### Beat 8 — The scorecard, and what is honestly missing (1 min)

Go to `/scorecard`. It is empty, and it explains itself:

> "Nothing is written before a cycle is archived, because a score is a judgement somebody makes rather than a number the product computes."

> "I could have seeded numbers here. I did not, because scoring happens at the quarterly review and that session is the next phase of the build. A number on this screen that no review agreed on would be the exact failure mode this product exists to prevent."

---

## 4. The one-minute version

If you have sixty seconds, do beat 3 only. Open `/cycle`, point at gate 5 naming the key result that exceeds capacity, and say:

> "Most OKR tools are a place to type objectives. This one runs the practice. It knows what phase you are in, it knows what is blocking it, and it will not let you publish a plan that does not fit the team you have. That refusal is a rule from the method, compiled into the product, and every message it shows you resolves back to the paragraph it came from."

---

## 5. What the demo does not have, and why

Say these before somebody notices them. Each one is a consequence of a rule worth defending, and each is a better answer than a workaround would have been.

**Nobody can sign in as Priya.** The demo people are members with no user accounts. Registration closes once an instance is claimed, so inventing sign-in credentials would mean working around a rule rather than demonstrating it. They own objectives, champion and review them, hold space roles and appear in the org chart. There is just nobody behind them.

**Every row was written by you.** An action resolves its author from the acting user, so the audit trail and the activity feed name you rather than naming Priya for something Priya did not do. The narratives are written in each person's voice; the authorship is honest about who typed them.

**Key results have one reading each, not a history.** This works around a real defect and it is worth being straight about it. The trend forecast fits a line over a key result's values and projects it to the end of the cycle, and the fit has no minimum time span. A seed writes its readings milliseconds apart, so the fitted line is near-vertical and the page reads *"On this trend: -269082230.39"*. A real user hits the same thing by typing a value and correcting it a second later. So the seed writes one reading per key result, which leaves the forecast honestly silent. Type a second value on any key result to bring the trend back.

**The KPI charts are real, though.** `kpis.record` takes the period date, so those six-month series are genuinely spaced and their charts are true trends.

**The strip says the set is 51 days overdue.** Publish gate 6 asks for a publication deadline before day one of the cycle, and the demo sits mid-quarter, so a compliant deadline is necessarily in the past. It is a true statement about a set that has not been published — and it stops counting the moment you publish. You cannot publish today, because gate 2 cannot be evaluated.

**The scorecard is empty.** It reads key result scores, and scoring at the quarterly review arrives with that session.

**Four of the six review-inbox sources are not built.** The page names each one and the task it arrives at, rather than looking complete.

**`/check-in` is empty.** It lists a goal when its next check-in is due or within two days of it, and the seed publishes a check-in on almost everything, so nothing is due yet. Come back in a week and the page fills up on its own. Show the check-in composer from a goal page instead.

**One goal-page line is wrong, and the seed steers around it.** An objective with a parent but no contribution statement reads *"No parent and no contribution statement, so publish gate 3 is red."* The gate itself is right — it asks for a statement only on an objective with **no** parent, and it is green across this set — but the sentence on the page does not make that check. Every objective in the demo carries a contribution statement, so you will not meet it here. Write a new objective without one during a demo and you will. The fix is one condition in `apps/web/app/goals/[id]/page.tsx`.

---

## 6. Rebuilding, and changing the story

The seed lives in `packages/core/src/demo/`:

| File | What is in it |
|---|---|
| `cast.ts` | The people, the spaces, the annual frame, the diagnosis and the capacity note |
| `okrs.ts` | The objectives, key results, dependencies, check-ins, votes and comments |
| `metrics.ts` | The KPIs, their readings, the driver trees and the recovery metric |
| `builder.ts` | The machinery that writes all of it through the action registry |

Change the story in the first three; change how it is written in the fourth. Every write goes through the same action registry the application uses, so a demo objective gets the same access bindings, activity row, audit row and outbox row a real one does. There are no shortcut inserts, which is why the demo is worth showing: what you are looking at is the product, not a fixture.

To rebuild from nothing:

```sh
pnpm db:down && pnpm db:up
docker exec openokr-test-postgres-1 psql -U postgres -c "CREATE DATABASE openokr;"
pnpm db:migrate
pnpm dev                          # register through the wizard again
pnpm db:seed
```

The builder's own tests are in `packages/core/test/demo.test.ts`. They assert the things this script promises: all four objective levels present, gate 5 red for exactly one reason, gate 2 unevaluable, every KPI state on the grid, a three-deep manager chain, a dependency register that passes gate 4 three different ways, and one value point per key result so no nonsense trend appears.
