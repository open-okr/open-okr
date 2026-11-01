# Resources

| | |
|---|---|
| URL | `/resources` |
| Audience | People learning OKRs, people evaluating the product in depth, and existing users |
| The page's one job | Route each reader to the right material in one click |
| Primary CTA | Read the handbook |
| Secondary CTA | Join the community |
| Page title | Resources: the OKR handbook, documentation, the Northwind year and the changelog · OKRGoal |
| Meta description | Learn to write and run OKRs with the OpenOKR handbook, follow one company's year of OKRs step by step, and read the documentation, the API reference and every release note. |

## Section structure

| # | Section | Layout |
|---|---|---|
| 1 | Hero | H1, subhead, search box |
| 2 | Learn the practice | The handbook, five cards, and OKR Institute's courses |
| 3 | See it in use | The Northwind year |
| 4 | Run the product | Documentation, four cards |
| 5 | What is new | Changelog and blog |
| 6 | For machines | llms.txt and the OpenAPI document |
| 7 | Final CTA | |

---

## 1. Hero

**Eyebrow:** Resources

# Learn the practice. Then run it.

Everything we know about running OKRs well, written in plain English, and everything you need to install, run and extend OpenOKR.

**Search box placeholder:** Search the handbook and the docs

## 2. Learn the practice

## The OKR handbook.

For the person running the practice, not the person building the software. Every number it quotes is checked against the product automatically, so the handbook cannot drift from what OpenOKR enforces.

**Five cards, rendered from `docs/handbook/`:**

| Card | One line |
|---|---|
| **Writing objectives and key results** | What a good one looks like, and the checks that fire on a bad one |
| **The weekly rhythm** | The four-step session, blockers, commitments, and what happens between sessions |
| **The quarterly cycle** | Eight phases, the publish gates, scoring and the closing diagnostic |
| **The numbers** | Every threshold the practice runs on, and where each comes from |
| **Ways of working** | Four shapes of organisation, mapped onto spaces, cycles and initiatives |

**Button:** `[ Read the handbook ]`

**Go further with OKR Institute.** For the people who run your practice, OKR Institute's certification path goes from Foundation to Practitioner (C-OKRP®), Leader (C-OKRL®), Chief OKR Officer (C-OKRO®) and Professional (C-OKRPro®). `[ See the courses → ]` links to okrinstitute.org.

> **Search note:** the handbook is the site's best search asset. Render each page at `/handbook/<page>` with its own title and description ("How to write OKRs: checks, examples and common mistakes"), and link every product page to the handbook page behind it.

## 3. See it in use

## A year of OKRs at Northwind.

One invented company's full year in OpenOKR, from a pilot in the autumn to the year-end close, with a rollout, a competitor, a crisis, a reorganisation and a leader on leave along the way. Read it straight through, or sign in to the demo and see it live.

**Buttons:** `[ Read the Northwind year ]` `[ Open the demo ]`

## 4. Run the product

## Documentation.

| Install | Administer | Use | Integrate |
|---|---|---|---|
| One server, Kubernetes, the first run, upgrades and the air gap | People, security, settings, backups and operations | A guide for members, champions, coordinators and facilitators | Tokens, scopes, the REST API reference, the command line and the agent surface |

**Also:** METHOD.md, the full practice canon. The specification, for anyone who wants to know why it is built the way it is.

## 5. What is new

| Changelog | Blog |
|---|---|
| Every release and what changed, from the release notes on GitHub. Subscribe with the repository's release feed | Practice, product and releases. Three kinds of post: how to run OKRs better, how a feature works and why, and what shipped |

> **Decision needed:** the blog does not exist yet. Proposed first three posts: (1) the launch post, "Why we built an OKR platform that runs the practice"; (2) "Twenty-six checks: what they catch and what they do not"; (3) "Strategy problem or rhythm problem? How the closing diagnostic works".

## 6. For machines

## Readable by your agent, too.

- **`/llms.txt`**: a plain-text map of this site and the docs, for AI agents and search tools
- **The OpenAPI document**: served live by every instance, so it describes the version you run
- **METHOD.md**: the whole practice as one document an agent can read

## 7. Final CTA

## Questions the docs do not answer?

**Buttons:** `[ Join the community ]` `[ Talk to us ]`
