# The method

| | |
|---|---|
| URL | `/product/method` |
| Audience | OKR leads, PMOs, facilitators, and OKR practitioners checking whether we know what we are talking about |
| The page's one job | Prove the practice is real, written down and enforceable, and that it bends to how you work |
| Primary CTA | Start free |
| Secondary CTA | Read METHOD.md |
| Page title | The OKR method, built in: twenty-six checks, eight phases, six gates · OKRGoal |
| Meta description | OKRGoal ships the full OKR practice as rules that run: a guided eight-phase cycle, twenty-six quality checks as you type, publish gates, an alignment score and a closing diagnostic. Every rule is public and changeable. |

## Section structure

| # | Section | Layout |
|---|---|---|
| 1 | Hero | H1, subhead, two buttons, a rule card image |
| 2 | One document | Short text beside a code-style excerpt of METHOD.md |
| 3 | The eight phases | Numbered vertical list |
| 4 | Twenty-six checks | Four columns by group, each check one line |
| 5 | Anatomy of a coaching card | Annotated image |
| 6 | Alignment that means something | Text and a three-band scale |
| 7 | Committed, aspirational, and four kinds of key result | Two small tables |
| 8 | Defaults, not dogma | Profile cards and a sample of settings |
| 9 | Built on published practice | Source list |
| 10 | Argue with it | Short text and a GitHub link |
| 11 | Final CTA | Headline and buttons |

---

## 1. Hero

**Eyebrow:** The method

# Practice, not a template.

Most OKR tools give you a form and a help article. OKRGoal gives you the practice itself, as rules that run while you work: a guided cycle, twenty-six quality checks as you type, six publish gates, an alignment score, and an honest diagnosis at the close.

**Buttons:** `[ Start free ]` `[ Read METHOD.md ]`

**Image:** the rule card ([03b-rule-card.png](../../mockups/png/03b-rule-card.png)).

## 2. One document

## The whole practice, in one public document.

Every rule, threshold, band, gate, session agenda and diagnostic OKRGoal enforces lives in one document, METHOD.md, published with the open source OpenOKR code. It compiles into a small library with no database, no network and no AI. The same rules run in your browser as you type, on the server before anything is saved, inside the agents, and in the importer.

A test compares the document and the code on every change. If they disagree, the build fails. So what the documentation says is what the product does.

**Beside it, a styled excerpt:**

```text
KR-3 Complete.
Block when the target, the due date or the owner is missing.
Warn when a metric key result has no baseline.
  "A target but no baseline. Without the from, you cannot prove movement."
If a baseline is unknown, establishing it can be its own key result.
```

## 3. The eight phases

## A cycle that knows where it is.

The product knows which phase you are in, what is missing, who owes what, and how many weeks are left before the publication date. Completion is computed from the work, not ticked by hand.

| Phase | What happens |
|---|---|
| **0. Annual strategy** | Once a year. Mission, vision, two to five annual strategies, up to five annual objectives, and the year's not-doing list |
| **1. Prepare** | A sponsor and a facilitator, every session booked, and the seven-item input pack gathered |
| **2. Diagnose** | Score last cycle, read the KPI baselines, rank five to ten strategic issues by impact |
| **3. Set direction** | Three to five priorities, each with what will be measurably different in twelve months. Then the not-doing list |
| **4. Draft** | Objectives and key results, with the quality checks running on every line |
| **5. Align and commit** | Map contribution, confirm dependencies, check capacity, clear the publish gates |
| **6. Run the rhythm** | Weekly check-ins, monthly reviews, a decision log, and one optional mid-cycle calibration |
| **7. Review and learn** | Score, retro, diagnose, and feed it all into the next cycle |

**Small print:** By default the phases guide. Anybody who can edit a space can write and change its OKRs at any time. Make them binding if you run a formal process, or hide them if you only want to track.

## 4. Twenty-six checks

## Twenty-six checks. Every line, as you type.

Each check returns pass, warn or fail, with a coaching prompt, the reason it matters, and a weak-versus-strong example. By default only structural defects block publishing: a missing key result, target, date or owner. Everything else coaches, and you decide what blocks.

**Four columns:**

| Objectives | Key results | Alignment | The cycle |
|---|---|---|---|
| **OBJ-1** Outcome, not output | **KR-1** Two to five per objective | **AL-1** Supports a bigger priority | **CY-1** Input pack gathered before session one |
| **OBJ-2** Qualitative and memorable | **KR-2** Verifiable | **AL-2** One parent only | **CY-2** Prior cycle scored |
| **OBJ-3** Timebound | **KR-3** Complete: target, date, owner, baseline | **AL-3** No level skipped | **CY-3** Strategic issues ranked |
| **OBJ-4** Owned by a champion | **KR-4** Leading and lagging | **AL-4** A company anchor | **CY-4** Three to five priorities |
| **OBJ-5** Not too many | **KR-5** Impact, not effort | **AL-5** Dependencies declared | **CY-5** The not-doing list is written |
| | **KR-6** Ambitious but honest | **AL-6** Not siloed | **CY-6** Capacity checked |
| | **KR-7** Direction set | | **CY-7** Dependencies confirmed |
| | | | **CY-8** Every session booked |

**Some of what they catch,** as a row of quote chips:

- "Your objective starts with a deliverable. If we do it and nothing changes, did we succeed?"
- "This measures activity volume. Ask why."
- "A target but no baseline. Without the from, you cannot prove movement."
- "Trim it. If your team cannot recite it from memory, it will not steer their daily decisions."
- "Which priority does this move forward?"

**Line under the chips:** The checks are measured against real, published OKRs, and no check that matches words blocks by default. A person decides what blocks, not a word list.

## 5. Anatomy of a coaching card

## Nothing is a mysterious red dot.

**Annotated image** of a coaching card with five callouts:

1. **The verdict.** Pass, warn or fail.
2. **The rule.** Its key and name, `KR-5 Impact, not effort`. Click it to read the rule in full.
3. **The prompt.** The question that exposes the problem.
4. **The reason.** Why this matters, in one sentence.
5. **The example.** A weak version and a strong version, side by side. With an AI provider connected, a rewrite of your own line you can apply or dismiss.

## 6. Alignment that means something

## Contribution, not copying.

A team objective that restates the company objective aligns nothing. In OKRGoal, vertical alignment means this goal moves that one. Horizontal alignment is a dependency both teams know about, which can be escalated when it stalls.

The product scores alignment health as the share of goals that are aligned or stand alone with a stated reason, and names every gap: no company objective anchoring the tree, an orphan goal, an objective with no key results, a skipped level, a department with no cross-team dependency anywhere in its branch.

**Three-band scale:**

| Healthy | Watch | Gap |
|---|---|---|
| 90% and above | 80% to below 90% | Below 80% |

With an AI provider connected, the Coach's nightly sweep adds what structure cannot see: two goals counting the same metric, a goal that would sit better under a different parent, a dependency between two teams who have not spoken.

## 7. Committed, aspirational, and four kinds of key result

## Scored by what they are.

**Two kinds of objective:**

| Committed | Aspirational |
|---|---|
| Expected to land at 1.0. A miss asks for an explanation. | A real stretch. Landing at 0.7 is a good result. |

**Four kinds of key result:**

| Metric | Maintain | Milestone | Baseline |
|---|---|---|---|
| Move a number from a baseline to a target | Hold a number inside a band | Done by a date, or not | Measure something nobody has measured yet |

Every key result has an owner, a weight, a due date, a confidence and its full value history. Metrics get a trend forecast. Easing a target mid-cycle asks for a reason and keeps the original on record. "It got hard" is not a reason.

## 8. Defaults, not dogma

## Your flavour of OKRs, without starting from a blank page.

Every rule is a recommended default, and every one can change. Twenty-five practice settings cover who may write and when, how binding the phases are, the kinds of objective and key result in use, which checks and gates block, warn or are off, how confidence is shown, score colours, how the quarterly review runs, and more. Five profiles set them all in one move.

**Five profile cards:**

| Profile | For |
|---|---|
| **Recommended** | Most organisations. The defaults in the method |
| **Google-style** | Organisations following Google's OKR playbook closely |
| **Radical Focus** | Small companies and teams starting out, in the style of Christina Wodtke's book |
| **Lightweight** | Teams that want to track OKRs without the planning workflow |
| **Governed** | Organisations that run a formal planning process |

**Line under the cards:** Every change is audited. A closed cycle keeps the rules it was graded under, so changing a threshold next year never rewrites last year's verdicts.

> **Legal note:** "Google-style" and "Radical Focus" describe a style of practice. Neither Google nor Christina Wodtke endorses OKRGoal or OpenOKR. Keep the footnote: *Profile names describe published practice. No endorsement is implied.*

## 9. Built on published practice

## We did the reading. And the coaching.

OKRGoal and OpenOKR are built by OKR Institute, on what it has learned since 2017 coaching OKR rollouts and running its OKR platform, okri.io. Every rule also names the published practice it rests on. Where the sources disagree, the document says so and picks a default you can change.

**Source list, set like a bibliography:**

- John Doerr, *Measure What Matters*, and whatmatters.com
- Andy Grove, *High Output Management*
- Google's OKR playbook and Google re:Work, *Set goals with OKRs*
- Christina Wodtke, *Radical Focus*
- Felipe Castro, on OKR levels and alignment
- Ben Lamorte, *The OKRs Field Book*
- Marty Cagan, on product teams and OKRs
- Rick Klau, *How Google sets goals*

**Small print:** The method is written in our own words. No third party's copy, branding or course material appears in the product.

## 10. Argue with it

## Think a rule is wrong? Tell us.

Every coaching message links to its rule. Every rule is public. If you run OKRs for a living and think a threshold, a check or a session agenda is wrong, open an issue with your reasoning and your source. If you are right, the rule changes for everyone, with your name on the change.

**Buttons:** `[ Read METHOD.md ]` `[ Challenge a rule on GitHub ]`

## 11. Final CTA

## Draft your first OKR with the Coach watching.

**Buttons:** `[ Start free ]` `[ Try the live demo ]`
