# Member roles for demo personas

Status: **design written, waiting for design approved**. Release 0.9.1 A3.

## Scope

`pnpm demo:prepare` attaches accounts to the Northwind cast in a seeded workspace. An attached persona can still have no workspace role. The [input-pack rule](input-pack-access.md#3-who-passes) requires a qualifying role for the named facilitator and already refuses roleless humans. The command should give the approved demo personas their built-in Member role.

## Decisions

| Decision | Implementation |
|---|---|
| Verify the recipient. | Keep the seeded-workspace guard. Consider only active human members selected from the existing Northwind cast. For a newly attached account or a rerun, require the linked user ID to match the user found by that persona's exact registered demo email. A matching name or a matching email suffix alone is insufficient. Skip an occupied member with a different account, a suspended member, and an unattached account. |
| Fill the built-in Member role. | Resolve `member` via `builtinRoleId` in the workspace. The workspace's default role and role display names do not enter the choice. If Member cannot be resolved, report it to the operator and stop preparation. |
| Use the existing assignment path. | Reuse the authorised `roles.assign` operation, with a conditional path scoped to demo preparation. In its transaction, require the member to be active, the linked user ID to match, and the role to be null. A concurrent role assignment or account change makes the conditional write a no-op. Record activity and audit only when the assignment lands. Preserve the public action's current contract and explicit role replacement behaviour. |
| Converge on rerun. | Attach through the existing Better Auth and Operation paths, then assign the role before running the demo agents. If preparation is interrupted between attachment and assignment, the next run qualifies the linked account by exact email. Keep any assigned role, including a custom one, and preserve the password on reruns for attached accounts. |

## Acceptance criteria

| Given | When | Then |
|---|---|---|
| A seeded workspace with eligible roleless cast members and a custom default role | An authorised operator prepares it | Each newly attached active persona gets built-in Member. Role assignment is audited and the seeded workspace guard still applies. |
| A previously attached, active, roleless persona whose linked account matches its exact demo email | The operator prepares the workspace twice | The first run fills Member and the second creates no additional role assignment activity. |
| A matching name with a different account, a suspended persona, or a persona with an existing role | The operator reruns preparation | The member keeps its account and role. |
| A concurrent administrator assigns a role before the conditional update | Preparation reaches the same member | The administrator's role survives. |
| Two prepared Members, only one of whom is the cycle facilitator | Each reads the pack and attempts to set an item or confirm distribution | The named facilitator sees the controls and can write. The other Member cannot write. The input-pack rule and its refusals stay in place. |

Extend `packages/core/test/demo-personas.test.ts` and `packages/core/test/input-pack-access.test.ts`. Exercise the preparation and facilitator paths against a disposable seeded workspace.
