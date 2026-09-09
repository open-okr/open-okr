"use client";

import {
  Button,
  Card,
  CardBody,
  CardHeader,
  useTranslations,
} from "@openokr/ui";
import { useActionState, useState } from "react";
import {
  convertToGuestAction,
  eraseMemberAction,
  restoreMemberAction,
  suspendMemberAction,
} from "../lifecycle-actions.ts";
import { IDLE, type LifecycleState } from "../lifecycle-state.ts";

/**
 * Handling a leaver without the command line (S-33, P6-G10, GAP-AUDIT B-08).
 *
 * **Each confirmation names what survives, not only what stops.** That is the
 * thing an administrator is actually unsure about: suspending is not deleting,
 * converting to a guest is not removing, and erasing keeps the history
 * readable. The same reasoning as the invitation revoke button, whose copy
 * says what happens to people who already joined.
 *
 * **Erasure asks for the name to be typed** rather than using a browser
 * confirm, because it is the one control here that cannot be undone and
 * because the panel needs somewhere to put the export. The server checks the
 * typed name against the row, so this box is the prompt and not the guard.
 *
 * Suspend, restore and convert use `window.confirm`, which is this
 * repository's existing idiom for a reversible destructive control.
 *
 * **It renders on your own profile too**, because the last-owner refusal
 * cannot fire anywhere else: the caller holds full access to be here at all,
 * so any other target already has a second full-access holder in the room.
 */

/** One sentence per control, in the confirm dialog and beside the button. */
const CONSEQUENCES = {
  suspend:
    "Suspend this member? Every access they hold stops at once and they " +
    "cannot sign in. Their check-ins, comments and authorship all stay, and " +
    "restoring gives the access back.",
  restore:
    "Restore this member? The access they held before the suspension " +
    "becomes theirs again and they can sign in.",
  guest:
    "Convert this member to a guest? Every binding they hold is removed, so " +
    "they keep only what they are invited to from now on. Nothing they wrote " +
    "is touched, and converting back is not one click.",
} as const;

function Outcome({ state }: { readonly state: LifecycleState }) {
  if (state.kind === "idle") {
    return null;
  }
  return (
    <p
      role={state.kind === "refused" ? "alert" : "status"}
      className={
        state.kind === "refused"
          ? "text-xs text-bad"
          : "text-xs font-semibold text-ok"
      }
    >
      {state.message}
    </p>
  );
}

/** One confirm-then-submit control. */
function ConfirmedControl({
  action,
  memberId,
  label,
  busyLabel,
  question,
  hint,
}: {
  readonly action: (
    previous: LifecycleState,
    form: FormData,
  ) => Promise<LifecycleState>;
  readonly memberId: string;
  readonly label: string;
  readonly busyLabel: string;
  readonly question: string;
  readonly hint: string;
}) {
  const [state, submit, pending] = useActionState(action, IDLE);
  return (
    <form
      action={submit}
      aria-busy={pending}
      className="flex flex-col gap-1.5"
      onSubmit={(event) => {
        if (!window.confirm(question)) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="memberId" value={memberId} />
      <div className="flex items-baseline gap-2.5">
        <Button type="submit" variant="default" size="sm" disabled={pending}>
          {pending ? busyLabel : label}
        </Button>
        <span className="text-xs text-ink-3">{hint}</span>
      </div>
      <Outcome state={state} />
    </form>
  );
}

/**
 * Erasure, with the export.
 *
 * The download is built from the result rather than fetched, because erasing
 * overwrites the row the export came from: there is no second call that could
 * produce it again, so this object is the only copy that will ever exist.
 */
function EraseControl({
  memberId,
  memberName,
}: {
  readonly memberId: string;
  readonly memberName: string;
}) {
  const { t } = useTranslations();

  const [state, submit, pending] = useActionState(eraseMemberAction, IDLE);
  const [open, setOpen] = useState(false);
  const exported = state.kind === "done" ? state.export : null;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-bad-dot bg-bad-bg p-3">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-xs font-bold uppercase tracking-wide text-bad">
          {t("people.detail.lifecycleControls.erase")}
        </h3>
        <p className="text-xs text-ink-3">
          {t("people.detail.lifecycleControls.removesTheirNameTitle")}
        </p>
      </div>

      {open ? (
        <form
          action={submit}
          aria-busy={pending}
          className="flex flex-col gap-2"
        >
          <input type="hidden" name="memberId" value={memberId} />
          <label className="flex flex-col gap-1 text-xs text-ink-3">
            {t("common.type")} {memberName}{" "}
            {t("people.detail.lifecycleControls.toConfirm")}
            <input
              name="confirmName"
              autoComplete="off"
              className="w-72 rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
            />
          </label>
          <div className="flex items-center gap-2">
            <Button
              type="submit"
              variant="default"
              size="sm"
              disabled={pending}
            >
              {pending ? "Erasing…" : "Erase this member"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setOpen(false)}
            >
              {t("common.cancel")}
            </Button>
          </div>
        </form>
      ) : (
        <Button
          type="button"
          variant="default"
          size="sm"
          onClick={() => setOpen(true)}
        >
          {t("people.detail.lifecycleControls.eraseThisMember")}
        </Button>
      )}

      {exported ? (
        <a
          data-testid="erasure-export"
          download={`erasure-${exported.memberId}.json`}
          href={`data:application/json;charset=utf-8,${encodeURIComponent(
            JSON.stringify(exported, null, 2),
          )}`}
          className="text-xs font-semibold text-brand-text hover:underline"
        >
          {t("people.detail.lifecycleControls.downloadTheErasureExport")}
        </a>
      ) : null}

      <Outcome state={state} />
    </div>
  );
}

export function LifecycleControls({
  memberId,
  memberName,
  status,
  kind,
  isSelf,
}: {
  readonly memberId: string;
  readonly memberName: string;
  readonly status: string;
  readonly kind: string;
  readonly isSelf: boolean;
}) {
  const { t } = useTranslations();

  return (
    <Card>
      <CardHeader>
        <div className="flex min-w-0 flex-col">
          <h2 className="text-sm font-bold text-ink">
            {t("people.detail.lifecycleControls.lifecycle")}
          </h2>
          <p className="text-xs text-ink-3">
            {isSelf
              ? "This is your own profile. Anything here applies to you, and the workspace refuses whatever would leave it without an owner."
              : "What to do when somebody leaves, changes relationship or asks to be erased. The workspace refuses anything that would leave it without an owner."}
          </p>
        </div>
      </CardHeader>
      <CardBody className="flex flex-col gap-3.5">
        {status === "suspended" ? (
          <ConfirmedControl
            action={restoreMemberAction}
            memberId={memberId}
            label="Restore"
            busyLabel="Restoring…"
            question={CONSEQUENCES.restore}
            hint="Gives back the access the suspension took."
          />
        ) : (
          <ConfirmedControl
            action={suspendMemberAction}
            memberId={memberId}
            label="Suspend"
            busyLabel="Suspending…"
            question={CONSEQUENCES.suspend}
            hint="Stops every access. Nothing they wrote is removed."
          />
        )}

        {kind === "guest" ? (
          <p className="text-xs text-ink-3">
            {t("people.detail.lifecycleControls.alreadyAGuestSo")}
          </p>
        ) : (
          <ConfirmedControl
            action={convertToGuestAction}
            memberId={memberId}
            label="Convert to a guest"
            busyLabel="Converting…"
            question={CONSEQUENCES.guest}
            hint="Removes every binding. They keep what they are invited to."
          />
        )}

        <EraseControl memberId={memberId} memberName={memberName} />
      </CardBody>
    </Card>
  );
}
