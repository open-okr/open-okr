# Community

| | |
|---|---|
| URL | `/community` |
| Audience | Developers, OKR practitioners and users who want to contribute, challenge or get help |
| The page's one job | Turn interest into one concrete action: a star, an issue, a pull request or a challenge to a rule |
| Primary CTA | Star on GitHub |
| Secondary CTA | Read CONTRIBUTING |
| Page title | Community: build OpenOKR, challenge the method, get help |
| Meta description | OpenOKR is built in the open under AGPL-3.0. Contribute code, challenge a rule in the method, report a bug or ask for help. |

## Section structure

| # | Section | Layout |
|---|---|---|
| 1 | Hero | H1, subhead, GitHub card |
| 2 | Three ways in | Three cards: practitioners, organisations, contributors |
| 3 | What makes it interesting to work on | Short list |
| 4 | Get help | Channels |
| 5 | How decisions are made | Governance, short |
| 6 | Final CTA | |

---

## 1. Hero

**Eyebrow:** Community

# Built in the open. Argue with the rules.

OpenOKR is open source under AGPL-3.0, and so is its method. The code, the specification, the design of every engine and the full OKR method it enforces are public. You can read all of it, run all of it, and change any of it.

**GitHub card:** `open-okr/open-okr` · ★ {stars} · latest release {version} · AGPL-3.0
**Button:** `[ ★ Star on GitHub ]`

## 2. Three ways in

| If you run OKRs for a living | If your organisation runs OKRs | If you write code |
|---|---|---|
| **Review the method.** Read METHOD.md and challenge any rule, threshold or agenda you think is wrong, with your reasoning and your source | **Run a real quarter on it.** Then tell us where the coaching was wrong. The whole workspace exports at any time, so trying costs you nothing | **Pick up an issue.** Start with CONTRIBUTING and the good first issues |
| Your method becomes enforceable software, attributable and versioned | Direct influence on the rules, and no lock-in | A codebase where the hard problems are method, coaching and agents, not forms |
| `[ Challenge a rule ]` | `[ Start free ]` | `[ Read CONTRIBUTING ]` |

## 3. What makes it interesting to work on

## Not another CRUD app.

- **A method library with no I/O.** The OKR method as pure functions, run identically in the browser, on the server, in the agents and in the importer, with a conformance test against the document
- **Agents with real guardrails.** Least privilege, proposals, sandbox mode, cost caps and a nudge budget
- **One contract, many surfaces.** The API, the command line, the agent tools and the chat commands are generated from one registry
- **Isolation in the database.** Row-level security on every table, and a test that proves a connection with no workspace reads nothing
- **Strict TypeScript everywhere**, PostgreSQL through Drizzle, Next.js, Vitest and Playwright

## 4. Get help

| Where | For |
|---|---|
| **GitHub issues** | Bugs, with what you ran and what it printed. Feature requests. Challenges to a rule |
| **Security reports** | The private security route in the issue chooser. Never a public issue |
| **The documentation** | Install, admin, use and the API |
| **Support from OKR Institute** | Organisations that want a named contact and response times |

> **Decision needed:** a place for open conversation. GitHub Discussions is not switched on today. Choose GitHub Discussions, Discord or a forum, and add it here and in the footer.

## 5. How decisions are made

## Who decides what.

The project owner has the final say while the project is young, and it is written down in GOVERNANCE.md. Changes to the OKR method itself are a maintainer decision, not something a pull request settles alone, because the method is the product. Contributions come under a lightweight contributor licence agreement, signed with one click.

**Links:** `GOVERNANCE.md →` `CONTRIBUTING.md →`

## 6. Final CTA

## Start with a star. Stay for the arguments.

**Buttons:** `[ ★ Star on GitHub ]` `[ Read METHOD.md ]`
