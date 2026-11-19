# Move affordances on task boards

Status: **design written, waiting for design approved**. Release 0.9.1 W2.

## Decisions

| Decision | Implementation |
|---|---|
| Return one capability per board card. | Add a required boolean `canMove` to the card schema for `tasks.board`. Keep the shared task list schema as it is. Compute the flag for returned cards in the board's tenant-scoped read through `visibleResourceIds` with `resourceType: "task"` and `requires: ACCESS_LEVELS.edit`. Keep the existing view filter, scope checks, ordering and per-column limits. |
| Keep reads and writes aligned. | `tasks.move` continues to load the task with `requireTask` at Edit before the write. The batched read and the move must agree on the additive role and binding rules, inactive actors, and the support session cap. Test this against the existing getter and move action. The client flag is a snapshot, so the server still refuses a move after revocation. |
| Apply the flag to the source card. | Use it for the drag handle, draggable card, keyboard pickup and drop, and column-shift buttons. A view-only card remains readable and can be an ordering anchor. Keep unrelated deletion, creation and detail controls on their existing paths. |
| Refresh the capability with the board. | The stream continues to send a change notification and the client refreshes through the server-rendered `tasks.board` read. When new props arrive, use the new flag and cancel an active drag or keyboard carry if the source is gone or edit access was lost. Announce the cancellation and return focus to a surviving card affordance or its column. A refused in-flight move rolls back without restoring capabilities from stale columns. The stream keeps its current scope checks and event format. |
| Update the contract. | Regenerate OpenAPI, CLI, MCP and the API reference using the repository generators. The response is additive and needs no stored data change. Keep the per-column read bounded and add at most one batched edit check. |

## Acceptance criteria

| Given | When | Then |
|---|---|---|
| A member can view two cards but edit only one | The member opens the board | Only the editable card offers keyboard, pointer and button moves. It can be placed after the view-only card. The contract flags agree with each action's result. |
| A Viewer has only the default role, an explicitly bound assignee has Edit, or a Member has task Edit from the role | Each opens the same visible task | The flag follows effective task access. Match the [workspace role model](workspace-roles.md#11-the-write-floor) and the A1 creation rules. |
| An unrelated, suspended or removed member cannot reach the scope or a card | They request the board or its live stream | Existing not-found and card filtering rules apply. No capability is returned for a hidden card. |
| Access is revoked while a card is held and an existing board event triggers a refresh | The member tries to drop the card | The refreshed board cancels the carry and offers no move. If a write was already in flight, the server refuses it and the board returns to the server's current position. |
| An editable card changes column and position | The member uses the pointer or keyboard | The new position persists and existing live announcements and focus behaviour work. |

Extend `packages/core/test/tasks.test.ts`, the board client and live route tests, and `e2e/s27-board.spec.ts`. Include an edit and a view-only card for the same signed-in member.
