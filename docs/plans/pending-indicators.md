# Plan: a pending indicator on every control that writes

Executor: Claude Sonnet, one change per session. Owner: Agung. Written 2026-11-05 on branch `agung`.

Read this whole file before touching code. Every path and line number below was checked on commit `12cc5b7b`. If something you find does not match what this file says, **stop and report it**. Do not guess, do not invent an API, do not "fix" the plan silently.

## 1. Goal

Every control that sends a write to the server (Save, Edit, Delete, Remove, Approve, Publish, an inline select or switch that saves on change) shows a spinner while the server works, and cannot be pressed twice.

The owner tested and found none on the Goals page and on Admin > General. That is expected: commit `4e07b8e8` only gave the spinner to 22 buttons in Board, Cycle, Documents, Initiatives, KPIs, Scorecard, Spaces and Tasks.

## 2. Owner decisions (2026-11-05, do not re-ask)

| Question | Decision |
|---|---|
| How to split | Three changes, in order. Change 3 runs as five batches (section 7) |
| A form with several submit buttons | Spinner only on the button that was pressed. The others are disabled |
| Controls without a button (inline select, switch, toggle, checkbox that saves) | In scope. Disabled while saving, small spinner beside it |

## 3. Ground rules for the executor

- Work on branch `agung`. Never create a branch from `main`, never push.
- **Do not commit until the owner has seen the result in the browser and approved it.** Then one signed-off commit per change (`git commit -s`), no Claude or Anthropic attribution, no co-author trailer.
- English for code, comments, commit messages. Replies to the owner in Indonesian.
- No new dependency. Everything needed is already installed: `lucide-react` and `react-dom` 19.3.1 in `packages/ui`, `@tanstack/react-query` in `apps/web`.
- No new visible text, so no translation keys are needed. The spinner is `aria-hidden`; the busy state is `aria-busy` on the button or the form.
- Never change behaviour beyond the indicator: same handlers, same classes, same `data-testid`, same order of fields.
- `apps/web/AGENTS.md`: this Next.js differs from training data. You should not need any Next.js API here. If you think you do, read `apps/web/node_modules/next/dist/docs/` first.
- The owner's laptop has 8 GB. Run one heavy job at a time. Use the `openokr-lean-dev` skill to start and stop the dev server.

## 4. Facts you can rely on

| Fact | Where |
|---|---|
| `Button` already has a `pending` prop: spinner (`LoaderCircle`, `data-testid="button-pending"`), `disabled`, `aria-busy` | [packages/ui/src/components/button.tsx](../../packages/ui/src/components/button.tsx) |
| `button.tsx` has **no** `"use client"` and also exports `buttonVariants` | same file |
| 12 **server** components call `buttonVariants(...)`: `not-found.tsx`, `goals/page.tsx`, `goals/[id]/page.tsx`, `(home)/role-home.tsx`, `setup/layout.tsx`, `setup/page.tsx`, `setup/account/page.tsx`, `spaces/[id]/page.tsx`, `kpis/page.tsx`, `kpis/trees/page.tsx`, `review/page.tsx`, `sessions/page.tsx` (all under `apps/web/app/`) | `grep -rn buttonVariants apps/web` |
| `SubmitButton` reads `useFormStatus()`; its `bare` mode keeps the caller's classes. Used 22 times | [packages/ui/src/components/submit-button.tsx](../../packages/ui/src/components/submit-button.tsx) |
| Tests for both | [packages/ui/test/submit-button.test.tsx](../../packages/ui/test/submit-button.test.tsx) |
| `ActionForm` is `<form action={formAction}>` from `useActionState`. Used 60 times. `useFormStatus` works inside it | [apps/web/app/cycle/action-form.tsx](../../apps/web/app/cycle/action-form.tsx) |
| `useFormStatus().pending` is true **only** when the form's `action` is a function (server action or `useActionState` action). It stays false for a form whose `onSubmit` calls `preventDefault()`, and for a button outside the form that points at it with `form="id"` | React 19 behaviour |
| The Goals list writes through one TanStack mutation, `useOkrMutation`, with no `mutationKey`. Every `OkrMutation` variant has `id: string` | [apps/web/lib/okr-tree/use-okr-tree.ts:202-210](../../apps/web/lib/okr-tree/use-okr-tree.ts#L202-L210), [apps/web/lib/okr-tree/actions.ts:157](../../apps/web/lib/okr-tree/actions.ts#L157) |
| The Goals list already sets `aria-busy` on the whole list from `useIsMutating()` | [apps/web/app/goals/okr-table.tsx:412](../../apps/web/app/goals/okr-table.tsx#L412) |

## 5. Change 1: the kit does it for every submit button

Branch work: `packages/ui` only, plus the changeset.

### 5.1 What to build

1. **Move `buttonVariants`** into a new file `packages/ui/src/components/button-variants.ts` with **no** directive. Move the `cva(...)` call and its comment unchanged. `button.tsx` imports it from there. Add `export * from "./components/button-variants.ts";` to `packages/ui/src/index.ts` next to the `button.tsx` line. Reason: `button.tsx` is about to become a client module, and a function exported from a client module cannot be called from a server component. The 12 server files in section 4 call it.
2. **New `packages/ui/src/components/spinner.tsx`**: `export function Spinner({ className }: { readonly className?: string })` rendering `<LoaderCircle aria-hidden="true" data-testid="pending-spinner" className={cn("size-3.5 animate-spin motion-reduce:animate-none", className)} />`. No directive needed. Export it from `index.ts`. Change 2 and 3 use it beside inline controls.
3. **`button.tsx` becomes `"use client"`** (first line) and gains automatic pending for `type="submit"`:

   ```tsx
   const { pending: formPending } = useFormStatus();
   const own = useRef<HTMLButtonElement>(null);
   const [pressed, setPressed] = useState(false);
   // Which button sent the form: the submit event names it, and it fires
   // before React starts the action, so `pressed` is right by the time
   // `formPending` turns true.
   useEffect(() => {
     const form = own.current?.form;
     if (type !== "submit" || !form) return;
     const onSubmit = (event: SubmitEvent) =>
       setPressed(event.submitter === own.current || event.submitter === null);
     form.addEventListener("submit", onSubmit);
     return () => form.removeEventListener("submit", onSubmit);
   }, [type]);
   const auto = type === "submit" && formPending;
   const spinning = pending || (auto && pressed);
   ```

   Then `disabled={disabled || pending || auto}`, `aria-busy={spinning || undefined}`, spinner shown when `spinning`. Merge the forwarded `ref` with `own` (write a small `mergeRefs` inside the file. Do not add a package). `event.submitter === null` means Enter was pressed in a form with no submit button named, so every submit button of that form spins.
4. **`SubmitButton`**: keep the export and the `bare` prop so the 22 call sites do not change. The non-bare branch becomes `<Button ref={ref} type="submit" ...>` with no `pending` passed, because `Button` now does it. The `bare` branch keeps its raw `<button>` but uses the same `pressed` logic. Put that logic in one hook, `useSubmitPending(type, ref)`, in `button.tsx`, and call it from both. Do not copy it twice.

### 5.2 Tests first (add to `packages/ui/test/submit-button.test.tsx`)

Given / When / Then. Use the existing test's pattern: a `<form action={action}>` whose action is a promise you resolve by hand.

| Given | When | Then |
|---|---|---|
| A form with a server action and one `<Button type="submit">Save</Button>` | Save is pressed | Disabled, `aria-busy="true"`, `button-pending` present. After the promise resolves: enabled, no spinner |
| A form with `Save` and `Reset`, both `type="submit"` | Reset is pressed | Reset has the spinner. Save is disabled and has no spinner |
| `<Button>` with no `type` inside that form | The form is sent | It is not disabled and has no spinner (only submit buttons react) |
| `<Button type="submit">` outside any form | Rendered | Enabled, no spinner, no error |
| `<SubmitButton bare className="x">` | Pressed | Keeps class `x`, shows the spinner |

Run `pnpm --filter @openokr/ui test` until green.

### 5.3 Verify

1. `pnpm check:fast` and `pnpm test:changed`. Both green.
2. Browser, with the `openokr-lean-dev` skill: Goals detail (`/goals/<id>`) Edit and Reopen buttons (they sit in `ActionForm`); Admin > General instance name Save, registration Save, update check Save. Each shows a spinner on press. Throttle the network in the browser (Slow 3G) if the server is too fast to see it.
3. Load a server page that calls `buttonVariants` (`/kpis`, `/review`, the 404 page). It must render, not throw.

### 5.4 Changeset

`.changeset/button-auto-pending.md`, `"@openokr/web": patch` and `"@openokr/ui": patch` if `@openokr/ui` is versioned (check the existing changesets first, `.changeset/submit-button-pending.md` names only `@openokr/web`, so follow it):

> Every Save, Delete or other submit button in a form shows a spinner on the button that was pressed and cannot be pressed twice while the server works on it.

Then stop and ask the owner to look.

## 6. Change 2: Goals and Admin > General

After change 1, these still have no indicator, because they either submit with `onSubmit` + `preventDefault`, or call the server from `onClick`, or save from an inline control.

### 6.1 The patterns, pick the one that fits

| Pattern in the file | What to do |
|---|---|
| `<Button type="submit" disabled={sending}>` in a form with `onSubmit` | Replace `disabled={x}` with `pending={x}` |
| `<Button onClick={() => start(async () => ...)} disabled={pending}>`, one write button sharing a `useTransition` | Replace `disabled={pending}` with `pending={pending}`. If the button also has other disabling conditions (`disabled={pending \|\| title === ""}`), keep `disabled={title === ""}` and add `pending={pending}` |
| Two or more write buttons sharing one `useTransition` (only the pressed one may spin) | Add `const [acting, setActing] = useState<string \| null>(null)`. Each handler calls `setActing("save")` (its own name) before `start(...)`. Each button gets `disabled={pending}` and `pending={pending && acting === "save"}` |
| A raw `<button>` that writes | Replace with the kit `Button` only if the look stays identical. Otherwise keep the raw button, set `disabled` and `aria-busy`, and render `<Spinner />` before its label |
| An inline `SelectInput` / `Switch` / checkbox / `EntityPicker` whose change saves | `disabled={pending}` on the control and `{pending ? <Spinner /> : null}` right after it, inside the same flex container |

A control is **in scope** only if its handler, directly or through a function in the same file, calls one of: a function imported from a file that starts with `"use server"` (for example `./editor-actions.ts`, `./alignment-actions.ts`, `./[id]/actions.ts`, `./[id]/write-actions.ts`), `okr.mutate(...)`, `callAction(...)`, or `fetch(` to `/api`. Opening a dialog, switching a tab, filtering, navigating: out of scope. When unsure, list it in your report rather than changing it.

### 6.2 Admin > General (`apps/web/app/admin/general/`)

| File:line | Today | Do |
|---|---|---|
| `general-settings-form.tsx:159-176` | Save and Reset, both `disabled={pending}`; the form uses `onSubmit` + `preventDefault` (line 51-56), so change 1 cannot see it | Multi-button pattern. In `submit`, read `submitter.value` (`"save"` or `"reset"`) into `acting` state before `startTransition`. Save: `pending={pending && acting === "save"}`, Reset likewise, both keep `disabled={pending}` |
| `instance-name-card.tsx:106`, `registration-card.tsx:131`, `update-check-card.tsx:63`, `setup-card.tsx:44`, `workspace-state-card.tsx:109` | Kit `Button type="submit"` in a form with a server action | Nothing. Change 1 covers them. Check them in the browser |

### 6.3 Goals (`apps/web/app/goals/`)

Known from the scan. Read each file before editing. Line numbers may drift a few lines.

| File:line | Write | Do |
|---|---|---|
| `okr-check-in.tsx:337` | `onSubmit` form, `disabled={sending}` | `pending={sending}` |
| `[id]/key-result-update.tsx:137` | `disabled={saving}` | `pending={saving}` |
| `[id]/key-result-update.tsx:272` | add/rename with `disabled={saving \|\| title.trim() === ""}` | `disabled={title.trim() === ""}` and `pending={saving}` |
| `new-objective.tsx:155` | create, `useTransition` `pending` | `pending={pending}`, keep the other conditions in `disabled` |
| `cycle-picker.tsx:236, 243` | two buttons on one `pending` | Multi-button pattern |
| `[id]/goal-writes.tsx:129, 192, 225` | three writes on one `pending` | Multi-button pattern. Inline pickers at 124, 171, 187 stay `disabled={pending}` (they choose, they do not save) |
| `[id]/decompose.tsx:109, 279, 329` | writes on one `pending` | Multi-button pattern |
| `[id]/coach-strip.tsx:187, 237` | writes on one `pending` | Multi-button pattern |
| `[id]/retrospective-field.tsx:74, 116, 128` | read each; 74 writes | `pending` on the writing ones |
| `okr-drawer.tsx:1155` | raw `<button disabled={removing}>` unlink | Raw-button pattern with `removing` |
| `okr-table.tsx:1402-1431` (`RowActions`, stop and delete confirm) | `stopping` state, `onDelete` → `okr.mutate` | `pending={stopping}` on the stop confirm. Delete: see 6.4 |
| `okr-table.tsx:1694` (`AddRow`) | `saving` state | `disabled={...without saving}` and `pending={saving}` |
| `okr-diagram-cards.tsx:590-615` | `saving` state on the add card | Same as `AddRow` |
| `filter-assist.tsx:102` | AI filter, `busy` | `pending={busy}` (it calls the server) |
| `[id]/page.tsx:594, 650, 743, 799` | `ActionForm` / server action forms | Nothing. Change 1 covers them |
| `alignment-panel.tsx:227, 298, 309` | `ActionForm` | Nothing. Change 1 covers them |

### 6.4 The Goals list rows (`okr-table.tsx`, `okr-cells.tsx`)

Inline cells and row menu items call `okr.mutate(...)` and update the row optimistically, so the row changes before the server answers. Show which row is still saving:

1. In `use-okr-tree.ts`, add `mutationKey: ["okr-tree", "write"]` to the `useMutation` options (line 202). Nothing else reads mutation keys today, so this changes no behaviour.
2. In the same file, export `usePendingOkrIds(): ReadonlySet<string>` built with `useMutationState({ filters: { mutationKey: ["okr-tree", "write"], status: "pending" }, select: (m) => (m.state.variables as OkrMutation).id })`.
3. In `ObjectiveRow` (`okr-table.tsx:810`) and `KeyResultRow` (`okr-table.tsx:1036`), call it once in `LiveOkrTable` (line 343) and pass a `saving: boolean` prop down. When true, render `<Spinner />` directly after the title text and add `aria-busy="true"` on the row element. Do not disable the cells: the optimistic design lets people keep typing, and the owner did not ask to change that.

### 6.5 Verify

`pnpm check:fast`, `pnpm test:changed`. In the browser with Slow 3G throttling: check in, record a key result value, add an objective, add a key result, delete a key result, stop an objective, change an inline cell (owner, status) in the list, Admin > General Save and Reset (only the pressed one spins). Changeset: `"@openokr/web": patch`, "The Goals page and Admin > General show a spinner on the control that is saving." Then stop and ask the owner to look.

## 7. Change 3: the rest of the app, in five batches

After change 1, a submit button in a server-action form needs nothing. What is left is `onSubmit` forms, `onClick` writes, `.mutate(` and inline controls. Apply section 6.1 exactly.

Find the candidates for a batch with:

```
grep -rlE --include='*.tsx' 'onSubmit=|useTransition|startTransition|\.mutate\(|await fetch\(' <batch folders>
```

Then open each file and classify every control with the in-scope rule in 6.1. For each batch, first send the owner a table (file, line, control, pattern) and wait for "ok" before editing. 142 files matched the broader scan on 2026-11-05. Many will need nothing.

| Batch | Folders under `apps/web/app/` |
|---|---|
| 3a | `admin/` except `admin/general/` (30 files) |
| 3b | `session/`, `sessions/` (24) |
| 3c | `cycle/`, `kpis/`, `spaces/`, `initiatives/`, `tasks/`, `board/`, `documents/`, `check-in/`, `review/`, `inbox/`, `search/` |
| 3d | `account/`, `(auth)/`, `join/`, `oauth/`, `welcome/`, `setup/`, `people/`, `operator/` |
| 3e | Shared components at the root of `apps/web/app/` (`comments.tsx`, `subject-comments.tsx`, `attachments.tsx`, `delete-control.tsx`, `watch-control.tsx`, `quick-check-in.tsx`, `workspace-switcher.tsx`, `sign-out.tsx`, `copilot/`, `(home)/`) and `apps/web/lib/` |

Each batch: one commit after owner approval, its own changeset, `pnpm check:fast` and `pnpm test:changed`, browser check of the screens touched.

## 8. Known risks, check them

| Risk | Check |
|---|---|
| An end-to-end spec asserts a button is enabled right after a click | Only CI's full suite sees it. If CI fails on a spec that encoded the old behaviour, updating the spec is part of the change |
| A spec uses `getByTestId("button-pending")` | Still the Button's id. `pending-spinner` is the new standalone one |
| A button outside its form with `form="..."` | `useFormStatus` cannot see it. List any you find; use the explicit `pending` prop |
| A submit that fails client validation (`required`) | No submit event, so nothing spins. Correct |
| A screen reader name changes | The spinner is `aria-hidden`, the name stays the label |

## 9. Stop and ask when

- A file does not match the line or the pattern this plan names.
- A control writes in a way section 6.1 does not list.
- A change would alter a handler, a class, a test id or a visible text.
- Any gate fails for a reason you do not understand.

## 10. Report format after each change

- What changed, as a table: file, control, pattern used.
- What was in scope but left out, and why.
- Commands run and their result. Say the full suites are CI's.
- What the owner should click to see it.
