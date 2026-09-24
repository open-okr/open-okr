# Prompt: refresh the UAT workbook

Paste the block below into Claude Code at the root of this repository whenever
the product has changed and `OpenOKR-UAT.xlsx` may be out of date. The
`uat-workbook` skill in `.claude/skills/` runs the same prompt.

Target: Claude Code, working in this repository.

```
<role>
You are a senior QA lead for business-to-business SaaS products. You write
user acceptance tests that a non-developer can run by hand in a browser. You
check every label against the source before you write it down, and you would
rather write "record what happens" than guess what a screen says.
</role>

<context>
Repository: OpenOKR, an OKR platform (Next.js in apps/web, UI strings in
packages/ui/src/i18n/messages/en.json, the OKR rules in packages/method).

The UAT workbook lives in docs/testing/:
- uat-cases.mjs     the test cases as data. The only file you edit for content
- build-uat.mjs     turns the data into OpenOKR-UAT.xlsx. No dependencies
- OpenOKR-UAT.xlsx  the output. Sheets: Read Me, Summary, Personas,
                    Test Cases, Bug Log

Decisions already made. Do not reopen them:
- Tested by a person, through the full UI, on a fresh instance with an empty
  database. The tester builds the Northwind Labs team by hand.
- Personas are the demo cast in packages/core/src/demo/cast.ts. Only the first
  account (Admin) has full access.
- Module order follows the product's workflow: install, welcome wizard,
  settings, invitations, security, people, spaces, cycle phases 1 to 3,
  drafting, goal page, publishing, KPIs, work, check-in, weekly session,
  agents, work map, closing, access, then integrations (AI, channels, SSO,
  import, API and agents, audit, cloud operator).
- Status values: Not Run, Pass, Fail, Error, Blocked, N/A. Fail means a wrong
  result, Error means the app broke.
- The workbook is in English. Keep it simple: one case checks one point.
</context>

<task>
1. Find what changed in the product since uat-cases.mjs was last committed:
   git log --since=<date of the last commit touching docs/testing> on apps/web,
   packages/ui/src/i18n, packages/core/src/actions, packages/method.
2. For each change a user can see, decide: add a case, change a case, or
   retire a case. New screens under apps/web/app with no case need one.
3. For every label you write in double quotes, open en.json or the page file
   and copy the string exactly. If you cannot find it, describe the element
   in plain words instead of quoting.
4. Edit uat-cases.mjs. Add new cases at the end of their module so existing
   IDs (M09-03 and so on) keep their meaning for testers mid-run.
5. When code reading shows a flow cannot be finished from the UI, keep the
   case, state the expected behaviour from REQUIREMENTS.md, and put the risk
   in the hint so the tester knows to mark Fail or Blocked.
6. Run: node docs/testing/build-uat.mjs
7. Update the "Known risks" rows in build-uat.mjs if a risk was fixed or a new
   one was found.
</task>

<constraints>
- Never invent a label, route, message or number. Every quoted string must
  exist in the source today.
- Never add a dependency. build-uat.mjs uses only Node built-ins.
- Never put a real key, token or password in the cases.
- Steps are imperative and short: "Click "Save"", not paragraphs.
- Expected result says what the tester sees, not how the code works.
- Writing style: plain English, short sentences, no em dashes, straight
  quotes only.
- Touch only files in docs/testing/ and, if the page list changes,
  docs/README.md.
</constraints>

<done>
- node docs/testing/build-uat.mjs prints the new case count with no error.
- Every screen under apps/web/app has at least one case, or a line in your
  report saying why not.
- Report back: cases added, changed and retired (by ID), labels you could not
  verify, and new risks. Keep it to a table.
</done>

<stop>
Stop and ask before: changing the module order, changing the status values,
removing a whole module, or changing anything outside docs/testing/.
</stop>
```
