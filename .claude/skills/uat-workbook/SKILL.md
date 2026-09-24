---
name: uat-workbook
description: Use when the manual UAT spreadsheet (docs/testing/OpenOKR-UAT.xlsx) needs creating, refreshing after product changes, or extending with new test cases. Keeps the human test cases in step with the real UI labels and rebuilds the workbook with no dependencies.
---

# UAT workbook

The manual acceptance test for OpenOKR is data plus a builder:

| File | Role |
|---|---|
| `docs/testing/uat-cases.mjs` | Modules, personas and every test case. Edit this |
| `docs/testing/build-uat.mjs` | Writes the `.xlsx` with Node built-ins only |
| `docs/testing/PROMPT-UAT.md` | The full refresh procedure, as a prompt |

## Procedure

Read `docs/testing/PROMPT-UAT.md` and follow the prompt inside it exactly. It
holds the role, the locked decisions, the steps, the constraints and the stop
conditions. Do not restate or loosen them here.

## Checks before you report

1. `node docs/testing/build-uat.mjs` prints the case count with no error.
2. Open the workbook in Excel if it is installed (PowerShell `Excel.Application`
   COM) and set a Status to Pass: the Summary sheet row for that module must
   count it. A formula error there means a module name in a case does not
   match `MODULES`.
3. Every quoted label was found in `packages/ui/src/i18n/messages/en.json` or
   the page file. List the ones that were not.

## Lessons from the first build (24 Sept 2026)

- Sessions cannot be created in the UI. The weekly session comes from the
  "OKR starter cycle" template in the welcome wizard, so M02 must pick it.
- Only the first account has full access. Any case needing admin rights logs
  in as Admin.
- Without SMTP, invitation links show once on Admin, Invitations, and reset
  links exist only in the server log. Mailpit on port 1025 is the easy fix.
- Publish gates 2 and 5 had no UI control when this was written. Keep the
  override case (M11-07) so a tester can still reach phase 6.
