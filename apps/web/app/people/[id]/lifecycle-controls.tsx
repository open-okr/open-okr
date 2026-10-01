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
  setAdministratorAction,
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
  fields,
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
  /** Extra fields the action reads, such as which way a toggle goes. */
  readonly fields?: Readonly<Record<string, string>>;
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
      {Object.entries(fields ?? {}).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
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
            {t("common.typeToConfirm", { memberName })}
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
              {pending
                ? t("people.detail.lifecycleControls.erasing")
                : t("people.detail.lifecycleControls.eraseThisMember")}
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
  isAdministrator,
}: {
  readonly memberId: string;
  readonly memberName: string;
  readonly status: string;
  readonly kind: string;
  readonly isSelf: boolean;
  /** Whether this member holds full access (completeness review H-14). */
  readonly isAdministrator: boolean;
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
              ? t("people.detail.lifecycleControls.ownProfileIntro")
              : t("people.detail.lifecycleControls.othersProfileIntro")}
          </p>
        </div>
      </CardHeader>
      <CardBody className="flex flex-col gap-3.5">
        {status === "suspended" ? (
          <ConfirmedControl
            action={restoreMemberAction}
            memberId={memberId}
            label={t("people.detail.lifecycleControls.restore")}
            busyLabel={t("people.detail.lifecycleControls.restoring")}
            question={t("people.detail.lifecycleControls.restoreQuestion")}
            hint={t("people.detail.lifecycleControls.restoreHint")}
          />
        ) : (
          <ConfirmedControl
            action={suspendMemberAction}
            memberId={memberId}
            label={t("people.detail.lifecycleControls.suspend")}
            busyLabel={t("people.detail.lifecycleControls.suspending")}
            question={t("people.detail.lifecycleControls.suspendQuestion")}
            hint={t("people.detail.lifecycleControls.suspendHint")}
          />
        )}

        {/* Handing over administration (H-14). A person only: an agent never
            holds workspace-wide access and a guest is outside the
            organisation, and the action refuses both regardless. */}
        {kind === "human" && status === "active" ? (
          isAdministrator ? (
            <ConfirmedControl
              action={setAdministratorAction}
              memberId={memberId}
              fields={{ administrator: "false" }}
              label={t("people.detail.admin.remove")}
              busyLabel={t("people.detail.admin.removing")}
              question={t("people.detail.admin.removeQuestion")}
              hint={t("people.detail.admin.removeHint")}
            />
          ) : (
            <ConfirmedControl
              action={setAdministratorAction}
              memberId={memberId}
              fields={{ administrator: "true" }}
              label={t("people.detail.admin.make")}
              busyLabel={t("people.detail.admin.making")}
              question={t("people.detail.admin.makeQuestion")}
              hint={t("people.detail.admin.makeHint")}
            />
          )
        ) : null}

        {kind === "guest" ? (
          <p className="text-xs text-ink-3">
            {t("people.detail.lifecycleControls.alreadyAGuestSo")}
          </p>
        ) : (
          <ConfirmedControl
            action={convertToGuestAction}
            memberId={memberId}
            label={t("people.detail.lifecycleControls.convertToAGuest")}
            busyLabel={t("people.detail.lifecycleControls.converting")}
            question={t("people.detail.lifecycleControls.guestQuestion")}
            hint={t("people.detail.lifecycleControls.guestHint")}
          />
        )}

        <EraseControl memberId={memberId} memberName={memberName} />
      </CardBody>
    </Card>
  );
}
