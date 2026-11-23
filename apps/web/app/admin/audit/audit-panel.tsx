"use client";

import {
  Button,
  Card,
  CardBody,
  CardHeader,
  DateRangeInput,
  EntityPicker,
  useTranslations,
} from "@openokr/ui";
import { useRef, useState } from "react";
import { peopleOptions } from "../../../lib/entity-options.ts";
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

/** A name as the filter offers it: the name itself, as the rows print it. */
const nameOptions = (names: readonly string[]) =>
  names.map((name) => ({ id: name, label: name }));

export function AuditPanel({
  members,
  names,
  timeZone,
  initial,
}: {
  /** Everybody who can have acted, for the filter and for naming rows. */
  readonly members: readonly Member[];
  /**
   * The action and target type names the trail holds (guided-inputs §4.11).
   * Two free-text boxes asked for names nobody could know, and a typo found
   * no rows rather than the wrong ones.
   */
  readonly names: {
    readonly actions: readonly string[];
    readonly targetTypes: readonly string[];
  };
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

  const rowsPhrase = (count: number) => t("common.count.row", { count });

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
          : t("admin.audit.exportedRows", { count }),
      );
    } finally {
      setExporting(false);
    }
  };

  const cardHeader = "flex-col items-stretch gap-0.5";
  const footer =
    "flex flex-wrap items-center justify-between gap-3 border-t border-line px-3.5 py-2.5";

  return (
    <>
      <Card>
        <CardHeader className="items-center justify-between gap-3">
          <h2 className="font-semibold text-ink text-sm">
            {t("admin.audit.checkTheChain")}
          </h2>
          <Button
            type="button"
            variant="primary"
            size="sm"
            pending={checking}
            onClick={check}
          >
            {checking ? t("admin.audit.checking") : t("admin.audit.verify")}
          </Button>
        </CardHeader>
        {verdict ? (
          <CardBody>
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
          </CardBody>
        ) : null}
      </Card>

      <Card>
        <CardHeader className={cardHeader}>
          <h2 className="font-semibold text-ink text-sm">
            {t("admin.audit.browseAndExport")}
          </h2>
          <p className="text-ink-3 text-xs">
            {t("admin.audit.browseIntro")} {t("admin.audit.exportIntro")}
          </p>
        </CardHeader>
        <form onSubmit={show}>
          <CardBody className="grid grid-cols-12 gap-x-6 gap-y-4">
            <div className="col-span-12 flex flex-col gap-1">
              <DateRangeInput
                startLabel={t("admin.audit.from")}
                endLabel={t("admin.audit.to")}
                startName="from"
                endName="to"
                startId="audit-from"
                endId="audit-to"
                className="[&>span]:grid [&>span]:grid-cols-1 [&>span]:gap-x-6 [&>span]:gap-y-4 md:[&>span]:grid-cols-2"
                inputClassName="w-full"
              />
              {/* The server reads the two days in this zone, which is the one
                  the rows below are stamped in. */}
              <p className="text-xs text-ink-3">
                {t("admin.audit.daysIn", { zone: timeZone })}
              </p>
            </div>

            <EntityPicker
              className="col-span-12 lg:col-span-4"
              id="audit-action"
              label={t("admin.audit.action")}
              name="action"
              defaultValue={null}
              options={nameOptions(names.actions)}
              noneLabel={t("admin.audit.anyAction")}
            />
            <EntityPicker
              className="col-span-12 lg:col-span-4"
              id="audit-actor"
              label={t("admin.audit.actor")}
              name="actorMemberId"
              defaultValue={null}
              options={peopleOptions(
                members.map((member) => ({
                  id: member.id,
                  label: member.name,
                })),
              )}
              noneLabel={t("admin.audit.anyone")}
            />
            <EntityPicker
              className="col-span-12 lg:col-span-4"
              id="audit-target-type"
              label={t("admin.audit.targetType")}
              name="targetType"
              defaultValue={null}
              options={nameOptions(names.targetTypes)}
              noneLabel={t("admin.audit.anyTargetType")}
            />
          </CardBody>
          <div className={footer}>
            <div className="flex flex-col gap-1">
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
            <div className="flex flex-wrap items-center gap-2.5">
              <Button
                type="button"
                size="sm"
                pending={exporting}
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
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={log.busy !== null}
                pending={log.busy === "replace"}
              >
                {t("admin.audit.show")}
              </Button>
            </div>
          </div>
        </form>
      </Card>

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
    </>
  );
}
