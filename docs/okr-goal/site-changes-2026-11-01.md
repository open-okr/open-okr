# okrgoal.com: copy changes, 1 November 2026

For the agent that built okrgoal.com from the copy in this folder. Apply these changes to the built site. Everything you need is in this file; you do not need the repository.

## Why

Some of the copy made OKRGoal read as a **tool for learning or practising OKRs**: a course, a training product, a coach you work with. It is not. **OKRGoal is the software an organisation runs its real OKRs on**: its people and teams, its cycles, its objectives, key results and KPIs, its weekly check-ins and its quarterly reviews. The method and the AI Coach are built in, but they work on the organisation's real goals.

Three things caused the misreading:

| Cause | Fix |
|---|---|
| The word **"practice"**. We meant the discipline an organisation carries out, as in "medical practice". A visitor skimming a headline hears rehearsal | "Practice" leaves every headline, page title and meta description. In body copy it becomes **the method** (the rules) or **your OKRs** (what the organisation runs) |
| The home page led with the **Coach** ("Your OKR coach, built in.") | The tagline is now **"Stop storing OKRs. Start running them."** The Coach stays as a feature, not the product's identity |
| **OKR Institute's training record** sat directly under the hero ("70,000+ people trained") | It moves below the product numbers and reads as **who built it** |

## The rule, for anything this file does not list

If you find copy on the site that this file does not mention, apply one test: **would someone skimming this line think they are buying a course?** If yes, rewrite it around the organisation's OKRs, and tell us what you changed.

- **Allowed:** "practice settings" (the product's own name for a settings screen), and training or certification when the sentence clearly says it is OKR Institute's, on About, Enterprise, Resources, Contact and the footer.
- **Never:** "practise", "learn OKRs with OKRGoal", "OKR training" or "OKR course" said about the product, and "practice" in any headline, page title or meta description.

## Do not change

- Rule keys and coaching text in the mocks (`OBJ-1`, `KR-3`, `KR-5`, `AL-1`, `checkin.due`, `blocker.overdue` and their messages). They are quoted from the product.
- "Turn the AI off. It still coaches." The Coach is acting on your real drafts there, so it stays.
- "Twenty-five practice settings and five profiles" and every other "practice settings".
- The About page's H1, "Built by people who coach OKRs for a living." It is about the company.
- Layout, design, buttons, links and every **Decision needed** placeholder, except where this file says otherwise.

The site may have been built with slightly different wording from the copy. **Find each item by its meaning**, not only by exact text, and apply the new text.

---

## 1. Site-wide

| Where | Current | New |
|---|---|---|
| Footer tagline, under the logo | Your OKR coach, built in. | Stop storing OKRs. Start running them. |
| Any other use of the old tagline: the default social card or Open Graph text, the default meta description, the web manifest, `llms.txt`, the site's own README | Your OKR coach, built in. | Stop storing OKRs. Start running them. |
| The line about AI being off, wherever it appears (Home, Integrations, Security, Pricing, Enterprise, Public sector, About, Why OKRGoal, Growing companies) | …the practice still runs / the whole practice still runs / every part of the practice works… | …every rule still runs / every rule works… (exact text per page below) |
| The sources line, wherever it appears | Built on published practice: … | Built on published sources: … |
| Footer or nav description of the blog | Practice, product and releases | Method, product and releases |

## 2. Home, `/`

| # | Where | Current | New |
|---|---|---|---|
| 1 | `<title>` | OKRGoal: the OKR platform with a coach built in. From OKR Institute, built on open source | OKRGoal: run your OKRs, don't just store them. From OKR Institute, built on open source |
| 2 | Meta, Open Graph and Twitter description | OKRGoal runs the OKR practice with you. An AI Coach checks every objective as you write it, and an AI Champion keeps the weekly rhythm in Slack, Teams and WhatsApp. From OKR Institute, built on open source OpenOKR. Free to start. | OKRGoal runs your organisation's OKRs, from the annual plan to the quarterly close. An AI Coach checks every objective as you write it, and an AI Champion keeps the weekly rhythm in Slack, Teams and WhatsApp. From OKR Institute, built on open source OpenOKR. Free to start. |
| 3 | Hero H1 | Your OKR coach, built in. | Stop storing OKRs. Start running them. |
| 4 | Hero subhead, first sentence only | OKRGoal is the OKR platform that runs the practice with you. | OKRGoal is where your organisation's OKRs live and run, with the method built in. |
| 5 | Proof strip, **order** | OKR Institute line first, then the four numbers | The four numbers and the GitHub badge first, unchanged. Then the OKR Institute line. Then the sources line |
| 6 | Proof strip, OKR Institute line | From OKR Institute · Coaching OKRs since 2017 · 70,000+ people trained · 1,000+ organisations · 50+ countries | Built by OKR Institute · Coaching organisations through OKRs since 2017 · 1,000+ organisations · 50+ countries |
| 7 | Proof strip, sources line | Built on published practice: Doerr · Grove · Wodtke · Castro · Lamorte · Cagan · Google's OKR playbook | Built on published sources: Doerr · Grove · Wodtke · Castro · Lamorte · Cagan · Google's OKR playbook |
| 8 | The problem, second paragraph | The practice that makes OKRs work has been understood for twenty years. | The method that makes OKRs work has been understood for twenty years. |
| 9 | Pillar 1, H2 | Practice, not a template. | Rules that run, not a template. |
| 10 | Pillar 1, body, opening words | The whole OKR practice ships as rules that run: | The whole OKR method ships as rules that run on your real OKRs: |
| 11 | AI off, body | Switch the AI provider off and the whole practice still runs. | Switch the AI provider off and every rule still runs. |
| 12 | Run it your way, OKRGoal card | Your practice is yours. | Your OKRs are yours. |
| 13 | Built in the open, METHOD.md link | The whole practice in one document. | The whole method in one document. |
| 14 | FAQ, "What is OKRGoal?", opening | An OKR platform with the OKR practice built in, from OKR Institute. It guides the planning cycle, | The OKR platform your organisation runs its OKRs on, from OKR Institute. It holds your objectives, key results and KPIs, guides the planning cycle, |
| 15 | FAQ, **new question**, second in the list, after "What is OKRGoal?" | (none) | See below |

The new FAQ entry. If the FAQ has `FAQPage` structured data, add it there too.

> **Is it a course, or a way to learn OKRs?**
> No. OKRGoal is where your teams write, check in on and review their real OKRs. People do pick up the method along the way, because the Coach explains every rule it applies. If you want to learn OKRs before you start, OKR Institute runs courses and certification, separately from the product.

"70,000+ people trained" leaves the home page. It stays on About, where it is clearly OKR Institute's record.

## 3. Every other page

### `/product`

| Where | Current | New |
|---|---|---|
| `<title>` | Product tour: OKRGoal, the OKR platform that runs the practice | Product tour: OKRGoal, the OKR platform that runs your OKRs |
| Stage 6, "Ninety minutes. Honest scores." | …and an anonymous check on the practice itself. | …and an anonymous check on the process itself. |
| Stage 6, closing | Scores, learnings and the weakest part of the practice feed the next cycle's planning automatically. | Scores, learnings and the weakest part of how you ran the quarter feed the next cycle's planning automatically. |
| "Deliberately OKR-shaped" section | We would rather do one practice properly than ten things loosely. | We would rather do OKRs properly than ten things loosely. |

### `/product/method`

| Where | Current | New |
|---|---|---|
| Meta description | OKRGoal ships the full OKR practice as rules that run: | OKRGoal ships the full OKR method as rules that run on your OKRs: |
| H1 | Practice, not a template. | Rules that run, not a template. |
| Intro | OKRGoal gives you the practice itself, as rules that run while you work: | OKRGoal gives you the method itself, as rules that run on your real OKRs while you work: |
| H2 | The whole practice, in one public document. | The whole method, in one public document. |
| Section heading or eyebrow | Built on published practice | Built on published sources |
| Sources section body | Every rule also names the published practice it rests on. | Every rule also names the published source it rests on. |
| Profiles footnote | Profile names describe published practice. No endorsement is implied. | Profile names describe published OKR methods. No endorsement is implied. |

### `/product/rhythm`

| Where | Current | New |
|---|---|---|
| Quarterly review table, Retro row | An anonymous five-statement survey of the practice itself | An anonymous five-statement survey of the process itself |
| "Then it feeds forward" | The lowest-scoring statement about the practice becomes next quarter's improvement action. | The lowest-scoring statement about your process becomes next quarter's improvement action. |

### `/product/integrations`

| Where | Current | New |
|---|---|---|
| AI providers, "Or none at all" | Choose "Off" and the whole practice still runs. | Choose "Off" and every rule still runs. |
| Channels image, alt text or caption, if it says "practice" | the same practice on four channels | the same check-in on four channels |

### `/cloud`

| Where | Current | New |
|---|---|---|
| H1 | We run it. You run the practice. | We run it. You run your OKRs. |

### `/pricing`

| Where | Current | New |
|---|---|---|
| Middle plan, line under the name | For an organisation running the practice | For an organisation running OKRs every quarter |
| AI allowance section | And every part of the practice works with AI switched off. | And every rule works with AI switched off. |

### `/enterprise`

| Where | Current | New |
|---|---|---|
| Meta description, opening | Run OKRs across the whole organisation with a governed practice, single sign-on and directory sync, | Run OKRs across the whole organisation on one governed method, with single sign-on and directory sync, |
| Intro | OKRGoal runs one OKR practice across every department, | OKRGoal runs every department's OKRs on one method, |
| Section eyebrow | The practice | The method |
| Section H2 | One practice. Every department. Your rules. | One method. Every department. Your rules. |
| AI table, "A local model, or none at all" | With none, the practice still runs | With none, every rule still runs |
| "We roll it out with you", first sentences | Software does not run an OKR practice. People do. | OKRGoal runs the rhythm. People still make the calls. |

### `/security`

| Where | Current | New |
|---|---|---|
| AI bullet list | With AI off, the whole practice still runs | With AI off, every rule still runs |

### `/solutions/growing-companies`

| Where | Current | New |
|---|---|---|
| "Most companies are on their second try", last paragraph | None of that was a people problem. It was a missing practice. OKRGoal brings the practice. | None of that was a people problem. Nothing checked the drafts and nothing ran the rhythm. OKRGoal does both. |
| FAQ, "Do we need an OKR lead?" | Somebody should own the practice, often the chief of staff or a founder, | Somebody should own your OKRs, often the chief of staff or a founder, |
| FAQ, "Do we need to use AI?" | …and the practice runs either way. | …and every rule runs either way. |

### `/solutions/public-sector`

| Where | Current | New |
|---|---|---|
| Intro | OpenOKR runs the full OKR practice on infrastructure you control, with the governance and audit trail your institution requires. | OpenOKR runs your institution's OKRs on infrastructure you control, with the whole method built in and the governance and audit trail you are required to keep. |
| H2 | Turn it off. The practice still runs. | Turn it off. Every rule still runs. |

### `/solutions/consultancies`

| Where | Current | New |
|---|---|---|
| Meta description, opening | OKRGoal keeps the practice running between your workshops: | OKRGoal keeps your clients' OKRs running between your workshops: |
| Hero body | You set the practice up properly. | You set your client's OKRs up properly. |
| The problem story | …and the practice quietly stopped. | …and the rhythm quietly stopped. |
| OKR Institute network paragraph | OKRGoal gives that network a product that keeps the practice running between visits. | OKRGoal gives that network a product that keeps clients' OKRs running between visits. |

### `/why-okrgoal`

| Where | Current | New |
|---|---|---|
| Meta description | OKRGoal puts the practice in the product, | OKRGoal puts the method in the product, |
| H1 | Every OKR tool stores objectives. This one runs the practice. | Every OKR tool stores objectives. This one runs them. |
| Four ways table, "Project tools with goals" column | Leaves out: the OKR practice itself. | Leaves out: the OKR method itself. |
| Four ways table, "Consultants" column | Leaves out: the weeks between visits. The practice leaves with them | Leaves out: the weeks between visits. The method leaves with them |
| "Six things that set OKRGoal apart", point 3 | It runs the practice with the AI switched off. | Every rule runs with the AI switched off. |
| "Honestly, it is not for everyone" list | You want goals with no practice around them. | You want goals with no method around them. |

### `/demo`

| Where | Current | New |
|---|---|---|
| The scenario paragraph | Every step names the screen and the practice rule it shows. | Every step names the screen and the method rule it shows. |

### `/resources`

| Where | Current | New |
|---|---|---|
| H1 | Learn the practice. Then run it. | Learn the method. Then run your OKRs on it. |
| Section H2 | Learn the practice | Learn the method |
| Handbook intro | For the person running the practice, not the person building the software. | For the people running your organisation's OKRs, not the people building the software. |
| Handbook card, "The numbers" | Every threshold the practice runs on, and where each comes from | Every threshold the method runs on, and where each comes from |
| OKR Institute line | For the people who run your practice, OKR Institute's certification path… | For the people who lead OKRs in your organisation, OKR Institute's certification path… |
| "Also" line | METHOD.md, the full practice canon. | METHOD.md, the full method. |
| Blog card | Practice, product and releases. | Method, product and releases. |
| "Readable by your agent, too" list | METHOD.md: the whole practice as one document an agent can read | METHOD.md: the whole method as one document an agent can read |

### `/community`

| Where | Current | New |
|---|---|---|
| Intro | …and the full OKR practice it enforces are public. | …and the full OKR method it enforces are public. |
| Audience table, "If you run OKRs for a living" column | Your practice becomes enforceable software, attributable and versioned | Your method becomes enforceable software, attributable and versioned |
| "Not another CRUD app" list, method library | The OKR practice as pure functions, | The OKR method as pure functions, |
| "Who decides what" | Changes to the OKR practice itself are a maintainer decision, | Changes to the OKR method itself are a maintainer decision, |

### `/contact`

| Where | Current | New |
|---|---|---|
| Partnerships row | For OKR consultants and coaches. Tell us about your practice | For OKR consultants and coaches. Tell us about your clients and your method |

### `/about`

| Where | Current | New |
|---|---|---|
| Intro, last sentence | OKRGoal is what we built from what we learned. | OKRGoal is what we built from what we learned: the software an organisation runs its OKRs on, so the method keeps running when no coach is in the room. |
| "Built on the lessons of okri.io", first paragraph | They fail because nobody holds the practice together long enough for it to become a habit. | They fail because nobody keeps the rhythm going long enough for it to become a habit. |
| "Built on the lessons of okri.io", third paragraph | We wrote the practice down, all of it, in one public document. We built a product that enforces it, with two AI teammates that keep it running between coaching sessions. | We wrote the method down, all of it, in one public document. We built software for running your OKRs that enforces it, with two AI teammates that keep the rhythm going every week, whether or not a coach is involved. |
| Beliefs table, "AI should help, never decide" | Turn it off and the practice still runs | Turn it off and every rule still runs |
| Coaching and certification section, opening | Software keeps the practice running. … its certification path trains the people who run the practice: | OKRGoal keeps your OKRs running. … its certification path trains the people who lead OKRs in an organisation: |

### No changes

`/open-source`, `/product/agents` and `/product/kpis`, unless the rule above catches something the copy did not have.

---

## 4. Check before you finish

Search the rendered text of every page, case-insensitive:

| Search for | Expected |
|---|---|
| `Your OKR coach` | No results |
| `coach built in` | No results |
| `practise` | No results |
| `practice still runs`, `whole practice`, `the practice` | No results |
| `practice` | Only "practice settings", or a sentence about OKR Institute's own business |
| `practice` in any `<title>`, meta description, H1 or H2 | No results |
| `trained`, `training`, `course` | Only on About, Enterprise, Resources, Contact and the footer, and only about OKR Institute |

## 5. Report back

Reply with:

1. A table of every change in this file: page, applied or not found.
2. Anything you changed under the rule in "The rule, for anything this file does not list", with the before and after text.
3. Anything you were unsure about. Leave it as it was and list it.
