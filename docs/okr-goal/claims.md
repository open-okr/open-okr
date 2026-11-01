# Claims register

Every number and every promise the OKRGoal site makes, the wording that is safe to use, and where it comes from. **If a claim is not on this page, it does not go on the site.** If the product changes, change this page first, then the copy.

Checked against the repository on 1 November 2026, at release v0.4.0.

## OKR Institute

The company behind OKRGoal and OpenOKR. The figures are OKR Institute's claims about itself, read on okrinstitute.org on 1 November 2026, not product facts. Recheck them before each launch.

| Claim | Safe wording | Source |
|---|---|---|
| The parent | "OKRGoal and OpenOKR are built by OKR Institute" | The maintainer, 1 November 2026 |
| The lessons | "Built on what OKR Institute learned running okri.io and coaching organisations through OKRs" | The maintainer, 1 November 2026 |
| Founded | "Since 2017" | okrinstitute.org/about-okri |
| Courses | "More than 12,000 OKR courses and workshops" | okrinstitute.org/about-okri |
| People | "More than 70,000 participants", or "people trained". The footer of okrinstitute.org/okri says "certified 70,000+ professionals". Do not say "certified" unless OKR Institute confirms it | okrinstitute.org/about-okri |
| Organisations | "More than 1,000 organisations in 50+ countries". The same page also says "900+ organizations in 50+ countries". README decision 17 | okrinstitute.org/about-okri |
| Centres | "Training and coaching centres in Germany, the Netherlands, England, Switzerland, Singapore, Malaysia, Thailand, the UAE, Canada and the United States" | okrinstitute.org/about-okri |
| Certification | "Foundation, Practitioner (C-OKRP®), Leader (C-OKRL®), Chief OKR Officer (C-OKRO®) and Professional (C-OKRPro®)". Keep the marks as OKR Institute writes them | okrinstitute.org/okri |
| Trademark | "OKR Institute®" in the footer | okrinstitute.org/okri |

## The method

| Claim | Safe wording | Source |
|---|---|---|
| Eight phases | "A guided eight-phase cycle, from the annual frame to the quarterly close" | [METHOD.md §2](../specification/METHOD.md), [OVERVIEW.md §3.1](../specification/OVERVIEW.md) |
| 26 quality checks | "Twenty-six quality checks judge every objective and key result as you type" | METHOD.md §4, [README](../../README.md) |
| 6 publish gates | "Six publish gates, each set to block, warn or off". Defaults: gates 1 and 2 block, 3 to 5 warn, 6 is off. **Do not say "six hard gates"**, which OVERVIEW.md §3.2 still does and is out of date | METHOD.md §4.5, §12 |
| Rule keys in mocks | Quality checks are `OBJ-1` to `OBJ-5`, `KR-1` to `KR-7`, `AL-1` to `AL-6`, `CY-1` to `CY-8`. Proactive messages use keys like `checkin.due`, `blocker.escalated`, `kpi.unhealthy`. Quote the rule's own coaching text | METHOD.md §4, `packages/method/src` |
| Default strictness | "By default only structural defects block publishing. Everything else coaches" | [REQUIREMENTS.md §3.2](../specification/REQUIREMENTS.md), [PLAN.md §10 #4](../specification/PLAN.md) |
| 25 practice settings, 5 profiles | "Twenty-five practice settings and five profiles: Recommended, Google-style, Radical Focus, Lightweight and Governed" | METHOD.md §12, README |
| A closed cycle keeps its rules | "A closed cycle keeps the rules it was graded under" | METHOD.md §12 |
| Four kinds of key result | "Metric, maintain, milestone and baseline" | REQUIREMENTS.md §4 Pillar A |
| Committed and aspirational | "Committed objectives are expected at 1.0. Aspirational ones land well at 0.7" | README, METHOD.md §2.8 |
| Weekly session | "Fifteen to thirty minutes, four steps" | METHOD.md §7, OVERVIEW.md §3.5 |
| Quarterly review | "Ninety minutes, four acts, eleven timed stages" | METHOD.md §8 |
| Closing diagnostic | "Tells you whether a missed quarter was a strategy problem or a rhythm problem" | METHOD.md §8.6 |
| KPI health | "Every KPI has a health band in its own units". **Do not quote 70/90 percent bands**: the band is per KPI, and 90% of target is only the fallback | METHOD.md §6.4, §11 |
| Recovery OKRs | "When a KPI turns unhealthy, OpenOKR offers three responses, one of which is a drafted recovery OKR" | METHOD.md §6.5, README |
| Published sources | "Built on published practice: Doerr, Grove, Wodtke, Castro, Lamorte, Cagan and Google's OKR playbook". Never imply endorsement | METHOD.md §13 |
| Conformance | "A test fails the build when the method document and the code disagree" | [CLAUDE.md](../../CLAUDE.md), PLAN.md §9 |

## The agents

| Claim | Safe wording | Source |
|---|---|---|
| Two agents ship free | "Two AI teammates ship with every workspace: the OKR Coach and the OKR Champion" | REQUIREMENTS.md §3.8 |
| Agents are not seats | "The Coach and the Champion never count as seats" | [plans-and-seats.md §2](../design/plans-and-seats.md) |
| Rule citations | "Every message cites the rule behind it" | [AI-NATIVE-PLAN.md §1](../specification/AI-NATIVE-PLAN.md) |
| Propose by default | "By default an agent proposes and a person approves" | AI-NATIVE-PLAN.md §1.4, §11 A5 |
| Sandbox | "Sandbox mode commits nothing" | AI-NATIVE-PLAN.md §1.4 |
| Least privilege | "Each agent sees only the spaces and goals it is given. Never the whole workspace" | AI-NATIVE-PLAN.md §1.3 |
| Cost cap | "A hard cost cap halts a run mid-flight" | AI-NATIVE-PLAN.md §1.7 |
| Nudge volume | "At most one nudge per subject per day, and five per person per week. The rest wait for the morning summary" | AI-NATIVE-PLAN.md §11 A7, README |
| Quiet hours and snooze | "Quiet hours in your own time zone. A snooze never hides what you owe" | OVERVIEW.md §4 |
| Escalation ladder | "Champion, then the reviewer, then the coordinator at a week. The sponsor only where the workspace adds them. Always visible to the person" | REQUIREMENTS.md §3.8 |
| Works with AI off | "Turn AI off and every nudge, escalation, gate, score and diagnostic still runs" | PLAN.md §2.4, AI-NATIVE-PLAN.md §10 |

## Reach

| Claim | Safe wording | Source |
|---|---|---|
| Surfaces | "Browser, email, Slack, Microsoft Teams, WhatsApp, Telegram, and your own AI agent" | REQUIREMENTS.md Pillar E |
| Two-way chat | "Nudges go out, real check-ins come back in" | README, AI-NATIVE-PLAN.md §5 |
| Same permission check | "A check-in typed into WhatsApp runs the same permission checks as a click" | README |
| No chat needed | "A workspace with no chat connected still works completely" | REQUIREMENTS.md Pillar E |
| Your own agent | "Connect Claude, ChatGPT, Cursor or your own agent through a consent screen. It works as you, within your permissions" | OVERVIEW.md §5, AI-NATIVE-PLAN.md §8 |
| One prompt | "Connect your agent by pasting one prompt. No token to copy" | v0.4.0 release notes (#150) |
| MCP | "A Model Context Protocol server with OAuth 2.1 sign-in, covering the whole product" | AI-NATIVE-PLAN.md §8 |
| One contract | "The API, the command line, the agent tools and the chat commands are generated from one contract" | README "The stack" |

## AI

| Claim | Safe wording | Source |
|---|---|---|
| Providers | "Anthropic, OpenAI, Google, OpenRouter, Ollama, or any OpenAI-compatible endpoint" | AI-NATIVE-PLAN.md §3.2 |
| Bring your own key | "Keys at the instance, the workspace or the person" | AI-NATIVE-PLAN.md §3.3 |
| Local and zero egress | "Point it at a local model and nothing leaves" | AI-NATIVE-PLAN.md §1.6 |
| Egress controls | "Choose what context may reach a provider, redact email addresses and phone numbers, and allow-list hosts" | AI-NATIVE-PLAN.md §4 |

## Ownership and operation

| Claim | Safe wording | Source |
|---|---|---|
| Licence | "Open source under AGPL-3.0" | PLAN.md §4 |
| Self-host obligations | "Self-hosting for your own staff carries no licence obligations" | PLAN.md §4 |
| Nothing gated | "Nothing is feature-gated. Self-host is never seat-limited" | REQUIREMENTS.md §5, PLAN.md §4 |
| Cloud sells operation | "The cloud sells operation, not features" | PLAN.md §4 |
| Same release | "Cloud and self-host run the same release" | PLAN.md §1 |
| Install time | "About half an hour on one server" | OVERVIEW.md §9, PLAN.md §5 |
| One dependency | "PostgreSQL is the only service it needs" | README, PLAN.md §2.5 |
| Server size | "2 CPU cores, 4 GB memory and 20 GB disk is comfortable for a few hundred people" | README |
| Kubernetes | "A Helm chart for your own cluster, your database and your single sign-on" | README |
| Signed releases | "Every release is a signed multi-architecture image with a software bill of materials" | README |
| Upgrades | "You choose when to upgrade. Nothing updates itself" | PLAN.md §5.1 |
| Air gap | "Runs fully offline: a local model or no AI, self-hosted assets, no telemetry unless you opt in" | REQUIREMENTS.md §6 |
| Scale | "Built and measured against one workspace of 100,000 goals and a million tasks". Do not say "proven" or name a response time | REQUIREMENTS.md §7, TECHNICAL-PLAN.md §13.1 |
| Export | "Export the whole workspace to a signed, encrypted archive and import it into any other instance, cloud or self-hosted, in either direction" | REQUIREMENTS.md Pillar F |

## Security

| Claim | Safe wording | Source |
|---|---|---|
| Sign-in | "Passwords, passkeys and authenticator codes with backup codes" | [docs/admin/security.md](../admin/security.md) |
| Single sign-on | "OIDC and SAML 2.0, included in the open source edition" | docs/admin/security.md, PLAN.md §6 |
| Directory sync | "SCIM 2.0 for Okta, Entra ID and others" | docs/admin/security.md |
| Tenant isolation | "Isolation is enforced inside the database by row-level security" | PLAN.md §2.7 |
| Audit | "An append-only audit log, hash-chained so tampering shows, with one-click verification" | PLAN.md §6, OVERVIEW.md §7 |
| Secrets | "Credentials and AI keys are envelope-encrypted and never logged" | PLAN.md §6 |
| Backups | "Backups whose restore is proved before you need it" | README `verify-backup`, REQUIREMENTS.md §7 |
| Freeze | "A read-only switch for maintenance and incidents" | PLAN.md §6 |
| Support access | "We cannot open your workspace unless an owner grants a session. Four hours by default, twenty-four at most, with a banner on every screen while it lasts. There is no back door" | [support-access.md](../design/support-access.md) |
| Accessibility | "Built to WCAG 2.1 AA, with every screen scanned automatically on every change" | REQUIREMENTS.md §6, CLAUDE.md |
| Languages | "English and Bahasa Melayu" | README |
| Compliance stance | "PDPA and GDPR-style handling: export, erasure that keeps authorship, and minimal personal data in logs" | REQUIREMENTS.md §6 |

## Cloud plans

| Claim | Safe wording | Source |
|---|---|---|
| Pricing model | "Priced per person, with a free tier" | PLAN.md §10 #1 |
| Plans differ only by numbers | "A plan is a number of seats, an AI allowance and a level of support. Never a feature list" | plans-and-seats.md §1, §4 |
| Who is a seat | "Active and invited people count. Guests, agents and people who have left do not" | plans-and-seats.md §2 |
| Leavers | "A leaver stops costing money the day they leave" | plans-and-seats.md §2 |
| Downgrades | "We never suspend people to fit a smaller plan. You choose who goes" | plans-and-seats.md §5 |

## The demo

| Claim | Safe wording | Source |
|---|---|---|
| Live demo | "A live instance at demo.okrgoal.com, holding a year of OKRs at an invented company, Northwind Labs" | [northwind-year](../scenarios/northwind-year/README.md) |
| Sign in as a person | "Pick a person from Northwind on the sign-in screen and see the product as they see it" | `apps/web/app/(auth)/sign-in/page.tsx` |
| Moves with the calendar | "The story is placed on today's calendar, so the demo moves through the year as the year moves" | northwind-year README |

## Never say

| Do not claim | Why |
|---|---|
| Customer logos, testimonials, user counts, star counts written as text | None exist yet. Use the live GitHub badge, nothing typed |
| SOC 2, ISO 27001 or any certification for OKRGoal | None held. The SOC 2 report in the Northwind story belongs to the invented company |
| A cloud region, uptime figure or response time | Not decided. See [README.md](README.md#decisions-the-copy-is-waiting-for) |
| "AI decides", "autonomous", "set and forget" | The AI never makes the decision, and agents propose by default |
| "Replaces your OKR consultant" | Untested, it insults a group we want as partners, and OKR Institute sells coaching itself |
| Any business connection between OKR Institute, OKRGoal or OpenOKR and another OKR software company | Settled with the maintainer on 1 November 2026. An importer for another tool is a feature, and is described only as one |
| OKR Institute's training and coaching clients as OKRGoal customers or logos | They trained with OKR Institute. They are not OKRGoal customers |
| okri.io's testimonials as OKRGoal testimonials | They are about a different product |
| That METHOD.md is a named OKR Institute framework, such as the Team-to-Impact Cycle™ | Not established. Say "built on what OKR Institute learned", nothing narrower, unless the maintainers decide otherwise |
| Native mobile apps, Gantt, time tracking, sprints, custom fields | Deferred past v1 (REQUIREMENTS.md §9) |
| Any endorsement by Doerr, Wodtke, Google or another source | They are sources, not partners |
