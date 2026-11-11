"use client";

import { Dialog } from "@base-ui-components/react/dialog";
import type { SSODomainDetails } from "@openokr/core";
import {
  Button,
  Chip,
  CopyButton,
  TextArea,
  useTranslations,
} from "@openokr/ui";
import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import {
  markSSODomainVerifiedAction,
  startSSODomainVerificationAction,
  verifySSODomainAction,
} from "./actions";
import type { SSODomainCheckReason } from "./sso-result.ts";

/** A DNS record type, which is not a sentence to translate. */
const RECORD_TYPE = "TXT";

type Busy = "start" | "check" | "mark" | null;

interface DomainRecord {
  readonly name: string;
  readonly value: string;
}

/**
 * The email domains a connection lists, each with whether this workspace has
 * proved it owns it (docs/design/sso-domain-verification.md, "Screens").
 *
 * A domain that is not verified has a Verify action. A verified one has the
 * chip and nothing to press. One whose daily check is failing is verified
 * still, and has a Check now button that looks the record up again without
 * waiting for the daily job.
 */
export function ConnectionDomains({
  domains,
  canMarkByHand,
}: {
  readonly domains: readonly SSODomainDetails[];
  /** False on a managed cloud, where only the operator may mark by hand. */
  readonly canMarkByHand: boolean;
}) {
  const { t } = useTranslations();
  if (domains.length === 0) {
    return null;
  }
  return (
    <ul
      aria-label={t("admin.sso.domains.heading")}
      className="flex flex-col gap-1.5 border-t border-line pt-2"
      data-testid="sso-domains"
    >
      {domains.map((domain) => (
        <DomainRow
          key={domain.domain}
          domain={domain}
          canMarkByHand={canMarkByHand}
        />
      ))}
    </ul>
  );
}

function DomainRow({
  domain,
  canMarkByHand,
}: {
  readonly domain: SSODomainDetails;
  readonly canMarkByHand: boolean;
}) {
  const { t } = useTranslations();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  // Held here, not in the dialog, because the dialog unmounts when it closes
  // and the value was shown once: only its hash is stored.
  const [record, setRecord] = useState<DomainRecord | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [done, setDone] = useState<"dns" | "hand" | null>(null);
  const [handOpen, setHandOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [handError, setHandError] = useState<string | null>(null);
  const ids = useId();

  const verified = domain.status === "verified" || domain.status === "failing";
  const checkText = (why: SSODomainCheckReason | null): string => {
    const values = { name: domain.recordName };
    return why === "record_mismatch"
      ? t("admin.sso.domains.reasonMismatch", values)
      : why === "lookup_failed"
        ? t("admin.sso.domains.reasonLookupFailed", values)
        : t("admin.sso.domains.reasonMissing", values);
  };

  const begin = () =>
    start(async () => {
      setBusy("start");
      setStartError(null);
      setCheckError(null);
      const result = await startSSODomainVerificationAction(domain.domain);
      setBusy(null);
      if (!result.ok) {
        setStartError(result.message);
        return;
      }
      setRecord({ name: result.record.name, value: result.record.value });
    });

  const openDialog = () => {
    setOpen(true);
    // A domain nobody has started has no token to lose, so the record is made
    // as the dialog opens. One that was started keeps its token: asking again
    // would replace the value somebody may already have published.
    if (record === null && domain.status === "not_started") {
      begin();
    }
  };

  const check = () =>
    start(async () => {
      setBusy("check");
      setCheckError(null);
      const result = await verifySSODomainAction(domain.domain);
      setBusy(null);
      if (!result.ok) {
        setCheckError(result.message);
        return;
      }
      if (!result.verified) {
        setCheckError(checkText(result.reason));
        return;
      }
      setDone("dns");
      router.refresh();
    });

  const markByHand = () =>
    start(async () => {
      setBusy("mark");
      setHandError(null);
      const result = await markSSODomainVerifiedAction(
        domain.domain,
        reason.trim(),
      );
      setBusy(null);
      if (!result.ok) {
        setHandError(result.message);
        return;
      }
      setDone("hand");
      router.refresh();
    });

  const chip =
    domain.status === "verified" ? (
      <Chip tone="ok" dot>
        {t("admin.sso.domains.verified")}
      </Chip>
    ) : domain.status === "failing" ? (
      <Chip tone="bad" dot>
        {t("admin.sso.domains.checkFailing")}
      </Chip>
    ) : (
      <Chip tone="warn" dot>
        {t("admin.sso.domains.notVerified")}
      </Chip>
    );

  const freeMailId = `${ids}-free-mail`;
  const title = t("admin.sso.domains.dialogTitle", { domain: domain.domain });

  return (
    <li
      className="flex flex-col gap-1"
      data-testid={`sso-domain-${domain.domain}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-ink">{domain.domain}</span>
        {chip}
        {!verified ? (
          <Button
            size="sm"
            disabled={domain.freeMail}
            aria-label={t("admin.sso.domains.verifyDomain", {
              domain: domain.domain,
            })}
            aria-describedby={domain.freeMail ? freeMailId : undefined}
            aria-haspopup="dialog"
            onClick={openDialog}
          >
            {t("admin.sso.domains.verify")}
          </Button>
        ) : null}
        {domain.status === "failing" ? (
          <Button
            size="sm"
            pending={busy === "check"}
            disabled={pending}
            aria-label={t("admin.sso.domains.checkDomainNow", {
              domain: domain.domain,
            })}
            onClick={check}
          >
            {busy === "check"
              ? t("admin.sso.domains.checking")
              : t("admin.sso.domains.checkNow")}
          </Button>
        ) : null}
      </div>
      {domain.freeMail && !verified ? (
        <p id={freeMailId} className="text-xs text-ink-3">
          {t("admin.sso.domains.freeMail")}
        </p>
      ) : null}
      {domain.status === "failing" && checkError ? (
        <p role="alert" className="text-xs text-bad">
          {checkError}
        </p>
      ) : null}
      {verified && domain.verifiedBy === "administrator" ? (
        <p className="text-xs text-ink-3">
          {t("admin.sso.domains.verifiedByHand")}
        </p>
      ) : null}

      {!verified || done !== null ? (
        <Dialog.Root open={open} onOpenChange={setOpen}>
          <Dialog.Portal>
            <Dialog.Backdrop className="fixed inset-0 z-50 bg-ink/20 data-ending-style:opacity-0 data-starting-style:opacity-0" />
            <Dialog.Popup
              data-testid={`sso-domain-dialog-${domain.domain}`}
              className="fixed top-1/2 left-1/2 z-50 flex max-h-[85vh] w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-line bg-surface shadow-(--shadow-popover) outline-none"
            >
              <header className="flex flex-none items-start gap-3 border-b border-line px-4 py-3">
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <Dialog.Title className="text-lg font-bold text-ink">
                    {title}
                  </Dialog.Title>
                  <Dialog.Description className="text-sm text-ink-3">
                    {t("admin.sso.domains.dialogDescription", {
                      domain: domain.domain,
                    })}
                  </Dialog.Description>
                </div>
                <Dialog.Close
                  aria-label={t("admin.sso.domains.close")}
                  className="flex size-7 flex-none items-center justify-center rounded-control text-ink-3 hover:bg-raised hover:text-ink"
                >
                  <X className="size-4" aria-hidden="true" />
                </Dialog.Close>
              </header>

              <div
                className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-4 py-3"
                aria-busy={pending}
              >
                {done !== null ? (
                  <p role="status" className="text-sm text-ok">
                    {done === "dns"
                      ? t("admin.sso.domains.doneDns", {
                          domain: domain.domain,
                        })
                      : t("admin.sso.domains.doneHand", {
                          domain: domain.domain,
                        })}
                  </p>
                ) : (
                  <>
                    {busy === "start" ? (
                      <p role="status" className="text-sm text-ink-3">
                        {t("admin.sso.domains.preparing")}
                      </p>
                    ) : null}

                    {startError ? (
                      <div className="flex flex-col gap-2">
                        <p role="alert" className="text-sm text-bad">
                          {startError}
                        </p>
                        <div>
                          <Button size="sm" disabled={pending} onClick={begin}>
                            {t("admin.sso.domains.tryAgain")}
                          </Button>
                        </div>
                      </div>
                    ) : null}

                    {record !== null ? (
                      <RecordTable record={record} />
                    ) : domain.status === "unverified" &&
                      busy !== "start" &&
                      !startError ? (
                      <div className="flex flex-col gap-2">
                        <RecordTable
                          record={{ name: domain.recordName, value: null }}
                        />
                        <p className="text-sm text-ink-2">
                          {t("admin.sso.domains.valueShownOnce")}
                        </p>
                        <div>
                          <Button size="sm" disabled={pending} onClick={begin}>
                            {t("admin.sso.domains.makeNewRecord")}
                          </Button>
                        </div>
                      </div>
                    ) : null}

                    {record !== null ? (
                      <p className="text-xs text-ink-3">
                        {t("admin.sso.domains.recordShownOnce")}
                      </p>
                    ) : null}

                    {checkError ? (
                      <p role="alert" className="text-sm text-bad">
                        {checkError}
                      </p>
                    ) : null}

                    {canMarkByHand ? (
                      <div className="flex flex-col gap-2 border-t border-line pt-3">
                        <div>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-expanded={handOpen}
                            aria-controls={`${ids}-hand`}
                            disabled={pending}
                            onClick={() => setHandOpen(!handOpen)}
                          >
                            {t("admin.sso.domains.markByHand")}
                          </Button>
                        </div>
                        {handOpen ? (
                          <div
                            id={`${ids}-hand`}
                            className="flex flex-col gap-2"
                          >
                            <TextArea
                              label={t("admin.sso.domains.reasonLabel")}
                              description={t(
                                "admin.sso.domains.reasonDescription",
                              )}
                              value={reason}
                              maxLength={500}
                              rows={2}
                              error={handError}
                              onChange={(event) =>
                                setReason(event.currentTarget.value)
                              }
                            />
                            <div>
                              <Button
                                size="sm"
                                pending={busy === "mark"}
                                disabled={pending || reason.trim() === ""}
                                onClick={markByHand}
                              >
                                {busy === "mark"
                                  ? t("admin.sso.connectionControls.working")
                                  : t("admin.sso.domains.markVerified")}
                              </Button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </>
                )}
              </div>

              <footer className="flex flex-none flex-wrap items-center justify-end gap-2 border-t border-line px-4 py-3">
                <Dialog.Close
                  render={<Button size="sm" variant="ghost" type="button" />}
                >
                  {t("admin.sso.domains.close")}
                </Dialog.Close>
                {done === null ? (
                  <Button
                    size="sm"
                    variant="primary"
                    pending={busy === "check"}
                    disabled={pending || busy === "start"}
                    onClick={check}
                  >
                    {busy === "check"
                      ? t("admin.sso.domains.checking")
                      : t("admin.sso.domains.checkNow")}
                  </Button>
                ) : null}
              </footer>
            </Dialog.Popup>
          </Dialog.Portal>
        </Dialog.Root>
      ) : null}
    </li>
  );
}

/**
 * The TXT record, with a copy control for the two parts a DNS panel asks for
 * separately. `value` is null when it can no longer be shown.
 */
function RecordTable({
  record,
}: {
  readonly record: { readonly name: string; readonly value: string | null };
}) {
  const { t } = useTranslations();
  return (
    <dl
      className="flex flex-col gap-2 rounded-control border border-line bg-raised p-3 text-sm"
      data-testid="sso-domain-record"
    >
      <div className="flex flex-col gap-0.5">
        <dt className="text-xs text-ink-3">{t("admin.sso.domains.type")}</dt>
        <dd className="font-mono text-ink">{RECORD_TYPE}</dd>
      </div>
      <div className="flex flex-col gap-1">
        <dt className="text-xs text-ink-3">{t("admin.sso.domains.name")}</dt>
        <dd className="flex flex-wrap items-center gap-2">
          <code
            className="min-w-0 break-all font-mono text-ink"
            data-testid="sso-domain-record-name"
          >
            {record.name}
          </code>
          <CopyButton size="sm" text={record.name}>
            {t("admin.sso.domains.copyName")}
          </CopyButton>
        </dd>
      </div>
      {record.value !== null ? (
        <div className="flex flex-col gap-1">
          <dt className="text-xs text-ink-3">{t("admin.sso.domains.value")}</dt>
          <dd className="flex flex-wrap items-center gap-2">
            <code
              className="min-w-0 break-all font-mono text-ink"
              data-testid="sso-domain-record-value"
            >
              {record.value}
            </code>
            <CopyButton size="sm" text={record.value}>
              {t("admin.sso.domains.copyValue")}
            </CopyButton>
          </dd>
        </div>
      ) : null}
    </dl>
  );
}
