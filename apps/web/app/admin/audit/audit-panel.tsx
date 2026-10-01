"use client";

import { Button, useTranslations } from "@openokr/ui";
import { useRef, useState } from "react";
import {
  type AuditFilterRequest,
  type AuditPageResult,
  browseAudit,
  type ChainResult,
  exportAudit,
  verifyChain,
} from "./actions";
import { AuditLog, type LogState, type Member } from "./audit-log";

/**
 * The verification button, and the trail itself (P8-T10, completeness review
 * L-19).
 *
 * **One filter form with two buttons.** Show draws the matching rows here,
 * newest first; Export takes the same rows away as a file. They used to be
 * one button and no list, so the only way to look at the trail was to
 * download it. Two forms would have let the list and the file disagree about
 * what "the rows that match" means.
 *
 * **The file is built on the server and handed over here.** The action has
 * already assembled it, and a download route would assemble it a second time
 * to answer a question this answer already holds. The same trade
 * `exports.list` makes.
 */

const INPUT_CLASS =
  "rounded-control border border-line-2 bg-surface px-2.5 py-1.5 text-sm font-normal text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand-line";

const LABEL_CLASS =
  "flex w-full flex-col gap-1 text-xs font-semibold text-ink-2";

/** The filter a form holds right now, empty fields left out. */
function readFilter(form: HTMLFormElement): AuditFilterRequest {
  const data = new FormData(form);
  const value = (name: string) => {
    const raw = String(data.get(name) ?? "").trim();
    return raw === "" ? undefined : raw;
  };
  const from = value("from");
  const to = value("to");
  const action = value("action");
  const actorMemberId = value("actorMemberId");
  const targetType = value("targetType");
  return {
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(action ? { action } : {}),
    ...(actorMemberId ? { actorMemberId } : {}),
    ...(targetType ? { targetType } : {}),
  };
}

/** The table's next state, once a page has come back or has not. */
function settle(
  current: LogState,
  result: AuditPageResult,
  mode: "replace" | "append",
): LogState {
  if (result.denied) {
    return { rows: [], more: false, busy: null, failure: "denied" };
  }
  if (result.error !== undefined || !result.rows) {
    const message = result.error ?? "";
    // A failed "older rows" keeps what is on screen, so the retry carries on
    // from there. A failed new filter clears it: rows that answer the last
    // question, under an error about this one, would read as this answer.
    return mode === "append"
      ? { ...current, busy: null, failure: { message } }
      : { rows: [], more: false, busy: null, failure: { message } };
  }
  return {
    rows: mode === "append" ? [...current.rows, ...result.rows] : result.rows,
    more: result.more ?? false,
    busy: null,
    failure: null,
  };
}

export function AuditPanel({
  members,
  timeZone,
  initial,
}: {
  /** Everybody who can have acted, for the filter and for naming rows. */
  readonly members: readonly Member[];
  readonly timeZone: string;
  /** The newest page, read on the server so the first paint has rows. */
  readonly initial: AuditPageResult;
}) {
  const { t } = useTranslations();
  const [checking, setChecking] = useState(false);
  const [verdict, setVerdict] = useState<ChainResult | null>(null);

  const [exporting, setExporting] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const [log, setLog] = useState<LogState>(() =>
    settle(
      { rows: [], more: false, busy: null, failure: null },
      initial,
      "replace",
    ),
  );
  // The filter the rows on screen answer, which is what "older rows" pages
  // through. Not the form's current fields: somebody who edits a field and
  // then asks for older rows wants more of what they are looking at.
  const [applied, setApplied] = useState<AuditFilterRequest>({});
  const lastLoad = useRef<{
    filter: AuditFilterRequest;
    mode: "replace" | "append";
  }>({ filter: {}, mode: "replace" });
  // Only the newest request may draw. Two quick filters can answer out of
  // order, and the slower one would otherwise overwrite the one asked last.
  const latest = useRef(0);

  const rowsPhrase = (count: number) =>
    count === 1
      ? t("common.count.rowOne", { count })
      : t("common.count.rowOther", { count });

  const check = async () => {
    setChecking(true);
    setVerdict(null);
    try {
      setVerdict(await verifyChain());
    } finally {
      setChecking(false);
    }
  };

  const load = async (
    filter: AuditFilterRequest,
    mode: "replace" | "append",
  ) => {
    const ticket = latest.current + 1;
    latest.current = ticket;
    lastLoad.current = { filter, mode };

    // The cursor is the last row already on screen, so a page is exactly
    // the rows after it, however many arrived at the top in the meantime.
    const last = mode === "append" ? log.rows.at(-1) : undefined;
    setLog((current) => ({ ...current, busy: mode, failure: null }));
    if (mode === "replace") {
      setApplied(filter);
    }

    const result = await browseAudit({
      ...filter,
      ...(last ? { cursor: { at: last.at, id: last.id } } : {}),
    });
    if (ticket === latest.current) {
      setLog((current) => settle(current, result, mode));
    }
  };

  const show = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void load(readFilter(event.currentTarget), "replace");
  };

  const download = async (form: HTMLFormElement) => {
    setExporting(true);
    setNote("");
    setError("");

    try {
      const result = await exportAudit(readFilter(form));

      if (result.error || !result.csv || !result.filename) {
        setError(result.error ?? t("admin.audit.exportEmpty"));
        return;
      }

      // A blob rather than a link to a route: the bytes are already here.
      const url = URL.createObjectURL(
        new Blob([result.csv], { type: "text/csv;charset=utf-8" }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = result.filename;
      anchor.click();
      URL.revokeObjectURL(url);

      const count = result.rowCount ?? 0;
      setNote(
        result.truncated
          ? t("admin.audit.rowsAtCeiling", { rows: rowsPhrase(count) })
          : count === 1
            ? t("admin.audit.exportedRowsOne", { count })
            : t("admin.audit.exportedRowsOther", { count }),
      );
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col items-start gap-3">
        <h3 className="text-sm font-bold text-ink">
          {t("admin.audit.checkTheChain")}
        </h3>
        <Button
          type="button"
          variant="primary"
          size="sm"
          disabled={checking}
          onClick={check}
        >
          {checking ? t("admin.audit.checking") : t("admin.audit.verify")}
        </Button>

        {verdict ? (
          <p
            role="status"
            data-testid="chain-verdict"
            className={
              verdict.ok && !verdict.error
                ? "rounded-md bg-ok-bg px-2.5 py-1.5 text-sm font-medium text-ok"
                : "rounded-md bg-red-50 px-2.5 py-1.5 text-sm font-medium text-red-700"
            }
          >
            {verdict.error
              ? verdict.error
              : verdict.ok
                ? t("admin.audit.chainIntact", {
                    rows: rowsPhrase(verdict.checked),
                    pending: verdict.pending,
                  })
                : verdict.brokenAtSeq === null
                  ? t("admin.audit.chainBrokenUnknown", {
                      reason: verdict.reason ?? "",
                    })
                  : t("admin.audit.chainBroken", {
                      position: verdict.brokenAtSeq,
                      reason: verdict.reason ?? "",
                    })}
          </p>
        ) : null}
      </section>

      <section className="flex flex-col gap-3 border-t border-line pt-4">
        <h3 className="text-sm font-bold text-ink">
          {t("admin.audit.browseAndExport")}
        </h3>
        <p className="max-w-prose text-sm text-ink-3">
          {t("admin.audit.browseIntro")}
        </p>
        <p className="max-w-prose text-sm text-ink-3">
          {t("admin.audit.exportIntro")}
        </p>

        <form onSubmit={show} className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label htmlFor="audit-from" className={LABEL_CLASS}>
              {t("admin.audit.from")}
              <input
                id="audit-from"
                name="from"
                type="date"
                className={INPUT_CLASS}
              />
            </label>
            <label htmlFor="audit-to" className={LABEL_CLASS}>
              {t("admin.audit.to")}
              <input
                id="audit-to"
                name="to"
                type="date"
                className={INPUT_CLASS}
              />
            </label>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label htmlFor="audit-action" className={LABEL_CLASS}>
              {t("admin.audit.action")}
              <input
                id="audit-action"
                name="action"
                placeholder={t("admin.audit.actionPlaceholder")}
                className={INPUT_CLASS}
              />
            </label>
            <label htmlFor="audit-actor" className={LABEL_CLASS}>
              {t("admin.audit.actor")}
              <select
                id="audit-actor"
                name="actorMemberId"
                defaultValue=""
                className={INPUT_CLASS}
              >
                <option value="">{t("admin.audit.anyone")}</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
            </label>
            <label htmlFor="audit-target-type" className={LABEL_CLASS}>
              {t("admin.audit.targetType")}
              <input
                id="audit-target-type"
                name="targetType"
                placeholder={t("admin.audit.targetTypePlaceholder")}
                className={INPUT_CLASS}
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={log.busy !== null}
            >
              {t("admin.audit.show")}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={exporting}
              onClick={(event) => {
                const form = event.currentTarget.form;
                if (form) {
                  void download(form);
                }
              }}
            >
              {exporting
                ? t("admin.audit.building")
                : t("admin.audit.exportAsCsv")}
            </Button>
            {note ? (
              <p
                role="status"
                data-testid="export-note"
                className="text-sm text-ink-3"
              >
                {note}
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="text-sm text-red-600">
                {error}
              </p>
            ) : null}
          </div>
        </form>

        <AuditLog
          state={log}
          members={members}
          timeZone={timeZone}
          filtered={Object.keys(applied).length > 0}
          onOlder={() => void load(applied, "append")}
          onRetry={() =>
            void load(lastLoad.current.filter, lastLoad.current.mode)
          }
        />
      </section>
    </div>
  );
}
