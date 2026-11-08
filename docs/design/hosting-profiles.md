# Hosting setups: creating workspaces, and the switches behind each setup

Status: approved on 7 November 2026. Authority: REQUIREMENTS §5, PLAN §5.2.
Depends on `tenant-lifecycle.md`, `operator-console.md`, `plans-and-seats.md`.

## 1. The problem

PLAN §5.2 lists five setups one release has to run. Two of them cannot run today.

| Gap | Where | Who it hurts |
|---|---|---|
| A workspace is only created at sign-up. Members are refused, the operator has no screen, and a person who already has a workspace can never get a second | `workspace.provision`, `provisionWorkspaceForUser` | A group, one company with several workspaces, and OKRGoal, which prices per workspace |
| With the cloud flag on, a private AI server is refused | `guardOutbound` in `apps/web/lib/ai-provider.ts` | A group running its own model |
| With the cloud flag on and no plans, the plan screen still shows | `apps/web/app/admin/plan/page.tsx` | A group, who should never see a thing implying a paid version |
| Turning the flag on later hides every existing workspace from the console | The console lists from `tenants` | A company that starts small and grows |

## 2. The decision

**No new mode.** A group is the cloud flag on, an empty catalogue and no billing.
Three independent switches give every setup, and the flag already does what a group
needs: it hides instance-wide settings from workspace administrators, stops the
sign-in page listing every company's identity provider, and brings the operator
console.

| Refused alternative | Why |
|---|---|
| A separate "group" flag | Two flags meaning almost the same thing, and a fourth setup to test for each change |
| A group-administrator role inside a workspace | A workspace is the tenant floor. A role above it is a hole in the floor |
| Leaving a group on flag off | Any workspace's administrator could change instance-wide settings |

## 3. Who can create a workspace

| Who | When | How |
|---|---|---|
| **An operator** | Always, in any setup with the flag on | "New workspace" on S-45: a name and the first administrator's address |
| **A signed-in person** | Only where sign-up is open to them: policy `open`, or `company_domains` with a company address | "New workspace" in the workspace switcher |
| **Anybody else** | Never | Refused in the action, not just hidden. The same rule on REST, the command line and agents |

The two paths share `createWorkspace`, so a new workspace gets the same tenant row,
default plan, agents and audit row however it was made.

### The first administrator

| Their address | What happens |
|---|---|
| Has an account | They become the owner straight away, and the workspace appears in their switcher |
| Has no account | The workspace is created with a waiting member holding that address and the owner role, and a single-use invitation goes out through the outbox. Accepting it claims the member, through the `claimWaitingMember` path importers already use |

**The operator never becomes a member.** The operator role is deliberately outside
every workspace (`operator-console.md`), and creating one must not change that.

### Free workspaces

A workspace on `cloud.defaultPlan` is free, and each one is worth AI credits, so a
person may own only `cloud.limits.freeWorkspacesPerPerson` of them. Default 1. Zero
means unlimited. With no default plan the limit does not apply, so a group is never
limited. An operator is not held to it.

## 4. Private AI servers

A new instance setting, `ai.allowPrivateEndpoints`, default off, set by
`OPENOKR_AI_ALLOW_PRIVATE_ENDPOINTS`.

| Cloud flag | Setting | The address check on an administrator's base URL |
|---|---|---|
| Off | Any | Off, as today |
| On | Off | On, as today |
| On | On | Off |

Only whoever runs the deployment can turn it on. With it on, a workspace
administrator can point the product at an address inside the network, which is
right for a group that trusts its own administrators and wrong for a public cloud.
The install guide says so in those words.

## 5. Smaller changes

| Change | Detail |
|---|---|
| Plan screen | With an empty catalogue, not-found at the route and absent from the navigation and the palette, the same as flag off |
| Existing workspaces | The scheduler gives any live workspace without one a tenant row every hour, through `listLiveWorkspaces`. `pnpm cloud:adopt` does it now, for `OPENOKR_SCHEDULER=off`. Idempotent, and only with the flag on. An `./openokr operator adopt` was designed and dropped: it would have needed most of the domain in the image's pruned sources, and the scheduler already does it on that target |
| Usage figures | The scheduler also refreshes the snapshot the console and the plan screen read, every hour. Not in the first draft of this design: nothing refreshed it unless somebody ran `pnpm cloud:usage`, so a provider's console would have read empty |

## 6. Not in this design

| Item | Why |
|---|---|
| OKRs and reports across a group's workspaces | Future work, REQUIREMENTS §9 |
| One identity provider shared by several workspaces | Each workspace connects its own today, and a person lands by email domain. A group with one provider registers it once per company. Named here so nobody assumes otherwise |
| A screen for the setting in §4 | It is a deployment decision, so it stays a variable |

## 7. Schema, contract, settings

- **No migration.** `workspace_members` already holds waiting members.
- **Contract:** `workspace.provision` gains the signed-in person's path. `agentSurface` stays false, so an agent cannot create a workspace.
- **Settings:** `ai.allowPrivateEndpoints`, `cloud.limits.freeWorkspacesPerPerson`, in TECHNICAL-PLAN §4.14.
- **Screens:** S-50, in UIUX-PLAN.

## 8. Acceptance criteria

1. **Given** a group's instance, **when** an operator creates a workspace naming an address with an account, **then** that person owns it and the operator is not a member.
2. **Given** an address with no account, **when** the operator creates a workspace, **then** one invitation is sent, and accepting it makes that person the owner.
3. **Given** policy `invite_only`, **when** a signed-in person calls `workspace.provision` by any surface, **then** it is refused and nothing is written.
4. **Given** policy `open` and a default plan, **when** a person who owns one free workspace creates another, **then** it is refused naming the limit, and an operator can still do it.
5. **Given** no default plan, **when** a person creates several workspaces, **then** none is refused for being free.
6. **Given** the flag on and an empty catalogue, **when** an administrator opens `/admin/plan`, **then** it is not-found, and no seat limit applies however many people join.
7. **Given** the flag on and `ai.allowPrivateEndpoints` off, **when** a base URL names a private address, **then** the request is refused. **Given** it on, **then** it goes.
8. **Given** an instance with workspaces and the flag newly on, **when** the scheduler runs, **then** each workspace has one tenant row, and a second run changes nothing.
9. **Given** every setting at its default, **when** the hosting setup suite runs, **then** the single-workspace install behaves exactly as before.
