"use client";

/**
 * "From FlowyTeam" on S-36 Import (docs/design/flowyteam-connect.md §4.5,
 * card C5; prototype view "OKRGoal: Admin > Import").
 *
 * Five steps (Connect, Choose, Preview, Import, Invite people), then the
 * linked state. The step comes from the server (`flowyteam-view.ts`), worked
 * out from the runs, so a reload or a second admin's browser lands on the same
 * one. What the browser adds is live progress while a job runs, the tick the
 * import needs when the preview named restricted KPIs, and the invite step's
 * selection.
 *
 * **Nothing is sent before the admin sends it** (Q6, AC 9). The invite step
 * lists the people the import brought across with no account; "Not now"
 * closes it and leaves everybody uninvited.
 *
 * **Every sentence is the catalogue's.** What the engine wrote into the
 * report (its notes, the reasons a KPI may become more visible, what an
 * unread table holds) is shown as written, as the spreadsheet wizard shows
 * the engine's row reasons.
 */

import type { KpiSharesNoteRowKey } from "@openokr/core";
import { intlTagFor } from "@openokr/formats";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  SearchInput,
  useTranslations,
} from "@openokr/ui";
import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  type ReactNode,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import {
  disconnectFlowyteamAction,
  type InviteOutcome,
  inviteFlowyteamPeopleAction,
  previewFlowyteamAction,
  runFlowyteamAction,
} from "./flowyteam-actions.ts";
import type {
  FlowyteamCardView,
  FlowyteamPhase,
  PreviewView,
} from "./flowyteam-view.ts";

interface FlowyteamPerson {
  readonly memberId: string;
  readonly name: string;
  readonly title: string | null;
  readonly email: string;
  readonly invited: boolean;
}

export interface FlowyteamCardProps {
  readonly available: boolean;
  readonly backgroundWork: boolean;
  readonly connection: {
    readonly companyName: string;
    readonly state: "connected" | "revoked";
    readonly connectedAt: string;
  } | null;
  readonly view: FlowyteamCardView;
  readonly people: readonly FlowyteamPerson[];
  readonly domains: readonly {
    readonly key: string;
    readonly requires: readonly string[];
  }[];
  /** The word the connect flow landed with, already said in the reader's language. */
  readonly outcome: { readonly ok: boolean; readonly message: string } | null;
  /** The failure word of the latest run, already said in the reader's language. */
  readonly failureMessage: string | null;
}

/** What an operator runs instead, on an instance with FlowyTeam turned `off`. */
const FLOWYTEAM_COMMAND = "pnpm import:flowyteam";

/** The route that starts connecting (C3). */
const CONNECT_PATH = "/admin/imports/flowyteam/connect";

/** Each engine domain's name and hint, written out so the catalogue gate sees every key. */
const DOMAIN_WORDS: Readonly<Record<string, { label: string; hint: string }>> =
  {
    organisation: {
      label: "admin.imports.flowyteam.domain.organisation",
      hint: "admin.imports.flowyteam.domainHint.organisation",
    },
    objectives: {
      label: "admin.imports.flowyteam.domain.objectives",
      hint: "admin.imports.flowyteam.domainHint.objectives",
    },
    checkins: {
      label: "admin.imports.flowyteam.domain.checkins",
      hint: "admin.imports.flowyteam.domainHint.checkins",
    },
    kpis: {
      label: "admin.imports.flowyteam.domain.kpis",
      hint: "admin.imports.flowyteam.domainHint.kpis",
    },
    work: {
      label: "admin.imports.flowyteam.domain.work",
      hint: "admin.imports.flowyteam.domainHint.work",
    },
    collaboration: {
      label: "admin.imports.flowyteam.domain.collaboration",
      hint: "admin.imports.flowyteam.domainHint.collaboration",
    },
    files: {
      label: "admin.imports.flowyteam.domain.files",
      hint: "admin.imports.flowyteam.domainHint.files",
    },
    "kpi-shares": {
      label: "admin.imports.flowyteam.domain.kpiShares",
      hint: "admin.imports.flowyteam.domainHint.kpiShares",
    },
  };

/** A domain the engine adds later is named by its key until it gets words. */
function domainLabel(t: (key: string) => string, key: string): string {
  const keys = DOMAIN_WORDS[key];
  return keys ? t(keys.label) : key;
}

/** The engine's names for its reconciliation rows, as a person reads them. */
const ROW_WORDS: Readonly<Record<string, string>> = {
  members: "admin.imports.flowyteam.row.members",
  spaces: "admin.imports.flowyteam.row.spaces",
  "space members": "admin.imports.flowyteam.row.spaceMembers",
  cycles: "admin.imports.flowyteam.row.cycles",
  objectives: "admin.imports.flowyteam.row.objectives",
  "key results": "admin.imports.flowyteam.row.keyResults",
  alignment: "admin.imports.flowyteam.row.alignment",
  "check-ins": "admin.imports.flowyteam.row.checkIns",
  "key result history": "admin.imports.flowyteam.row.keyResultHistory",
  "KPI categories": "admin.imports.flowyteam.row.kpiCategories",
  KPIs: "admin.imports.flowyteam.row.kpis",
  "KPI records": "admin.imports.flowyteam.row.kpiRecords",
  "KPI formulas": "admin.imports.flowyteam.row.kpiFormulas",
  initiatives: "admin.imports.flowyteam.row.initiatives",
  tasks: "admin.imports.flowyteam.row.tasks",
  checklists: "admin.imports.flowyteam.row.checklists",
  comments: "admin.imports.flowyteam.row.comments",
  watchers: "admin.imports.flowyteam.row.watchers",
  files: "admin.imports.flowyteam.row.files",
  "comment images": "admin.imports.flowyteam.row.commentImages",
  "KPI shares": "admin.imports.flowyteam.row.kpiShares",
};

/** A row the engine adds later is shown by its own name until it gets words. */
function rowLabel(t: (key: string) => string, domain: string): string {
  const key = ROW_WORDS[domain];
  return key ? t(key) : domain;
}

const SHARE_ROW_KEYS: Readonly<Record<KpiSharesNoteRowKey, string>> = {
  rowsRead: "admin.imports.flowyteam.kpiShares.rowsRead",
  writtenAtView: "admin.imports.flowyteam.kpiShares.writtenAtView",
  writtenAtEdit: "admin.imports.flowyteam.kpiShares.writtenAtEdit",
  raised: "admin.imports.flowyteam.kpiShares.raised",
  unchanged: "admin.imports.flowyteam.kpiShares.unchanged",
  coveredByRole: "admin.imports.flowyteam.kpiShares.coveredByRole",
  takesEffectWhenClaimed:
    "admin.imports.flowyteam.kpiShares.takesEffectWhenClaimed",
  revoked: "admin.imports.flowyteam.kpiShares.revoked",
  kpiNotImported: "admin.imports.flowyteam.kpiShares.kpiNotImported",
  personNotImported: "admin.imports.flowyteam.kpiShares.personNotImported",
  teamSharesNotCarried:
    "admin.imports.flowyteam.kpiShares.teamSharesNotCarried",
};

const STEPS = ["connect", "choose", "preview", "import", "invite"] as const;
type Step = (typeof STEPS)[number];

const STEP_KEYS: Readonly<Record<Step, string>> = {
  connect: "admin.imports.flowyteam.step.connect",
  choose: "admin.imports.flowyteam.step.choose",
  preview: "admin.imports.flowyteam.step.preview",
  import: "admin.imports.flowyteam.step.import",
  invite: "admin.imports.flowyteam.step.invite",
};

function stepOf(
  connected: boolean,
  phase: FlowyteamPhase,
  inviting: boolean,
): Step {
  if (!connected) return "connect";
  if (inviting) return "invite";
  switch (phase.kind) {
    case "choose":
      return "choose";
    case "previewing":
    case "preview":
      return "preview";
    case "importing":
      return "import";
    case "linked":
      return "invite";
  }
}

/**
 * Where the admin is in the five steps (UIUX-PLAN.md §2 tokens).
 *
 * From `sm` up, an ordered list with a connector between steps that turns ok
 * once the step on its start side is done. Below `sm` five labels do not fit
 * on one line, so it says "Step 2 of 5 · Choose" over a five-segment bar
 * instead of wrapping. Each step's state is spoken, not only coloured.
 */
function Steps({ current }: { current: Step }) {
  const { t } = useTranslations();
  const at = STEPS.indexOf(current);
  return (
    <div
      className="border-line border-b px-3.5 py-3"
      data-testid="flowyteam-steps"
    >
      <ol
        className="hidden items-center gap-2 sm:flex"
        aria-label={t("admin.imports.flowyteam.steps")}
      >
        {STEPS.map((step, index) => {
          const isDone = index < at;
          const isCurrent = index === at;
          const last = index === STEPS.length - 1;
          return (
            <li
              key={step}
              aria-current={isCurrent ? "step" : undefined}
              className={`flex min-w-0 items-center gap-2 ${last ? "" : "flex-1"}`}
            >
              <span
                aria-hidden="true"
                className={
                  isDone
                    ? "grid size-6 shrink-0 place-items-center rounded-full bg-ok-bg text-ok"
                    : isCurrent
                      ? "grid size-6 shrink-0 place-items-center rounded-full bg-brand text-xs font-semibold text-on-brand"
                      : "grid size-6 shrink-0 place-items-center rounded-full border border-line bg-raised text-xs text-ink-3"
                }
              >
                {isDone ? (
                  <Check className="size-3.5" strokeWidth={3} />
                ) : (
                  index + 1
                )}
              </span>
              <span
                className={
                  isCurrent
                    ? "whitespace-nowrap text-xs font-semibold text-ink"
                    : isDone
                      ? "whitespace-nowrap text-xs text-ink-2"
                      : "whitespace-nowrap text-xs text-ink-3"
                }
              >
                {t(STEP_KEYS[step])}
                <span className="sr-only">
                  {" "}
                  {isDone
                    ? t("admin.imports.flowyteam.stepCompleted")
                    : isCurrent
                      ? t("admin.imports.flowyteam.stepCurrent")
                      : t("admin.imports.flowyteam.stepUpcoming")}
                </span>
              </span>
              {last ? null : (
                <span
                  aria-hidden="true"
                  className={`h-px min-w-3 flex-1 ${isDone ? "bg-ok" : "bg-line"}`}
                />
              )}
            </li>
          );
        })}
      </ol>
      <div className="flex flex-col gap-1.5 sm:hidden">
        <p className="text-xs font-semibold text-ink">
          {t("admin.imports.flowyteam.stepOfTotal", {
            index: at + 1,
            total: STEPS.length,
            name: t(STEP_KEYS[current]),
          })}
        </p>
        <div className="grid grid-cols-5 gap-1" aria-hidden="true">
          {STEPS.map((step, index) => (
            <span
              key={step}
              className={`h-1 rounded-full ${index < at ? "bg-ok" : index === at ? "bg-brand" : "bg-line"}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * The step's actions, along the card's bottom edge as the settings footer bar
 * (settings-page-layout.md §B): Back at the start, the one primary at the end
 * with any secondary action before it.
 */
function Footer({
  start,
  children,
}: {
  start?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="-mx-3.5 -mb-3.5 flex flex-wrap items-center gap-2 border-line border-t px-3.5 py-3">
      {start}
      <div className="ms-auto flex flex-wrap items-center justify-end gap-2">
        {children}
      </div>
    </div>
  );
}

/** Disconnect reads as the risky action it is, at the same height as the rest. */
const DANGER = "text-bad hover:border-bad";

function Notice({
  tone,
  children,
  testId,
}: {
  tone: "ok" | "bad" | "warn" | "info";
  children: React.ReactNode;
  testId?: string;
}) {
  const colours = {
    ok: "border-ok/30 bg-ok-bg text-ok",
    bad: "border-bad/30 bg-bad-bg text-bad",
    warn: "border-warn/30 bg-warn-bg text-ink",
    info: "border-line bg-raised text-ink-2",
  } as const;
  return (
    <div
      role={tone === "bad" ? "alert" : "status"}
      className={`rounded-md border px-3 py-2 text-sm ${colours[tone]}`}
      data-testid={testId}
    >
      {children}
    </div>
  );
}

export function FlowyteamCard(props: FlowyteamCardProps) {
  const { t, locale } = useTranslations();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Which button the pending press belongs to, so only that one spins.
  const [busy, setBusy] = useState<string | null>(null);
  const spinning = (name: string) => pending && busy === name;
  const [refusal, setRefusal] = useState<string | null>(null);
  const [progress, setProgress] = useState<{
    domain: string;
    index: number;
    total: number;
  } | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [backToChoose, setBackToChoose] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [connecting, setConnecting] = useState(false);
  // The re-read after a job ends, so the invite step can say it is loading
  // rather than "nobody" while the people the import wrote are on their way.
  const [refreshing, startRefresh] = useTransition();

  const when = useMemo(
    () =>
      new Intl.DateTimeFormat(intlTagFor(locale), {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [locale],
  );
  const date = (iso: string | null) => (iso ? when.format(new Date(iso)) : "");

  const { connection, view } = props;
  const connected = connection?.state === "connected";
  const phase: FlowyteamPhase =
    backToChoose && view.phase.kind === "preview"
      ? { kind: "choose" }
      : view.phase;
  const running = phase.kind === "previewing" || phase.kind === "importing";
  const uninvited = props.people.filter((person) => !person.invited);

  // Live progress while a job runs, and a re-read when it ends. A slow
  // re-read as well, in case the stream cannot reach this browser (a proxy
  // that buffers): the server render is the only writer of the step.
  useEffect(() => {
    if (!running) {
      setProgress(null);
      return;
    }
    const wasImporting = phase.kind === "importing";
    const source = new EventSource("/api/imports/flowyteam/live");
    const onProgress = (event: MessageEvent) => {
      try {
        const data = JSON.parse(String(event.data)) as {
          domain: string;
          index: number;
          total: number;
        };
        setProgress({
          domain: data.domain,
          index: data.index,
          total: data.total,
        });
      } catch {
        // An unreadable event changes nothing; the next one or the re-read will.
      }
    };
    const onFinished = (event: MessageEvent) => {
      try {
        const data = JSON.parse(String(event.data)) as { status: string };
        if (wasImporting && data.status === "completed") {
          setInviting(true);
        }
      } catch {
        // Re-read below either way.
      }
      startRefresh(() => router.refresh());
    };
    source.addEventListener("progress", onProgress);
    source.addEventListener("finished", onFinished);
    const slow = setInterval(() => router.refresh(), 15_000);
    return () => {
      clearInterval(slow);
      source.close();
    };
  }, [running, phase.kind, router]);

  function press<T>(
    name: string,
    action: () => Promise<
      { ok: true; value: T } | { ok: false; reason: string; message: string }
    >,
    then?: (value: T) => void,
  ) {
    setRefusal(null);
    setBusy(name);
    startTransition(async () => {
      const answer = await action();
      if (answer.ok) {
        then?.(answer.value);
        router.refresh();
      } else {
        setRefusal(answer.message);
        if (answer.reason === "revoked" || answer.reason === "unauthorised") {
          router.refresh();
        }
      }
    });
  }

  const preview = (name: string) =>
    press(name, previewFlowyteamAction, () => {
      setBackToChoose(false);
      setAccepted(false);
    });

  const header = (
    <CardHeader className="flex-wrap justify-between">
      <div className="flex min-w-0 flex-col gap-0.5">
        <h2 className="text-sm font-semibold text-ink">
          {t("admin.imports.flowyteam.title")}
        </h2>
        <p className="text-xs text-ink-3">
          {t("admin.imports.flowyteam.description")}
        </p>
      </div>
      {props.available && connection?.state !== "connected" ? (
        <Chip
          tone={
            connected
              ? "ok"
              : connection?.state === "revoked"
                ? "bad"
                : "neutral"
          }
          data-testid="flowyteam-state"
        >
          {connected
            ? t("admin.imports.flowyteam.connected")
            : connection?.state === "revoked"
              ? t("admin.imports.flowyteam.revokedChip")
              : t("admin.imports.flowyteam.notConnected")}
        </Chip>
      ) : null}
    </CardHeader>
  );

  if (!props.available) {
    return (
      <Card data-testid="flowyteam-card">
        {header}
        <CardBody className="flex flex-col gap-2 text-sm text-ink-2">
          <p>{t("admin.imports.flowyteam.unavailable")}</p>
          <code className="w-fit rounded-control bg-raised px-2 py-1 text-xs">
            {FLOWYTEAM_COMMAND}
          </code>
        </CardBody>
      </Card>
    );
  }

  const step = stepOf(connected, phase, inviting);
  // The linked state shows its summary instead of the steps, as the
  // prototype does.
  const done = connected && phase.kind === "linked" && !inviting;

  // The page is served with `form-action 'self'`, which refuses a form post
  // redirected to FlowyTeam's origin. So the card asks the route for the
  // address and moves the page itself; the form stays for a browser with no
  // script, where the route still answers with a redirect.
  async function connect(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRefusal(null);
    setConnecting(true);
    try {
      const response = await fetch(CONNECT_PATH, {
        method: "POST",
        credentials: "same-origin",
        headers: { accept: "application/json" },
      });
      const body = (await response.json()) as { url?: unknown };
      if (!response.ok || typeof body.url !== "string") {
        throw new Error("no address");
      }
      window.location.assign(body.url);
    } catch {
      setConnecting(false);
      setRefusal(t("admin.imports.flowyteam.reason.error"));
    }
  }

  const connectForm = (again: boolean) => (
    <form method="post" action={CONNECT_PATH} onSubmit={connect}>
      <Footer>
        <span className="text-xs text-ink-3">
          {t("admin.imports.flowyteam.connectHint")}
        </span>
        <Button
          type="submit"
          variant="primary"
          pending={connecting}
          data-testid="flowyteam-connect"
        >
          {again
            ? t("admin.imports.flowyteam.connectAgain")
            : t("admin.imports.flowyteam.connect")}
        </Button>
      </Footer>
    </form>
  );

  return (
    <Card data-testid="flowyteam-card">
      {header}
      {done ? null : <Steps current={step} />}
      <CardBody className="flex flex-col gap-4">
        {/* Good news needs no banner: the connection row says it. The word
            stays in the address, so a later revocation must not show it. */}
        {props.outcome && !props.outcome.ok ? (
          <Notice
            tone={props.outcome.ok ? "ok" : "bad"}
            testId="flowyteam-outcome"
          >
            {props.outcome.message}
          </Notice>
        ) : null}
        {refusal ? (
          <Notice tone="bad" testId="flowyteam-refusal">
            {refusal}
          </Notice>
        ) : null}
        {/* A revoked connection has its own notice below, with the way back. */}
        {props.failureMessage && !running && connection?.state !== "revoked" ? (
          <Notice tone="bad" testId="flowyteam-failure">
            {props.failureMessage}
          </Notice>
        ) : null}
        {connected && !props.backgroundWork ? (
          <Notice tone="warn" testId="flowyteam-background-off">
            {t("admin.imports.flowyteam.reason.backgroundOff")}
          </Notice>
        ) : null}

        {connection === null ? (
          <>
            <p className="max-w-prose text-sm text-ink-2">
              {t("admin.imports.flowyteam.connectIntro")}
            </p>
            <div className="rounded-md border border-line bg-raised px-3 py-2 text-sm">
              <p className="font-semibold text-ink">
                {t("admin.imports.flowyteam.oneCompanyTitle")}
              </p>
              <p className="text-ink-2">
                {t("admin.imports.flowyteam.oneCompanyBody")}
              </p>
            </div>
            {connectForm(false)}
          </>
        ) : null}

        {connection?.state === "revoked" ? (
          <>
            <Notice tone="bad" testId="flowyteam-revoked">
              {t("admin.imports.flowyteam.revokedBody", {
                company: connection.companyName,
              })}
            </Notice>
            {connectForm(true)}
          </>
        ) : null}

        {connected && connection ? (
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-line px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p
                  className="text-sm font-semibold text-ink"
                  data-testid="flowyteam-company"
                >
                  {done
                    ? t("admin.imports.flowyteam.linkedTo", {
                        company: connection.companyName,
                      })
                    : t("admin.imports.flowyteam.connectedTo", {
                        company: connection.companyName,
                      })}
                </p>
                <Chip tone="ok" data-testid="flowyteam-state">
                  {t("admin.imports.flowyteam.connected")}
                </Chip>
              </div>
              <p className="text-xs text-ink-3">
                {view.lastImport
                  ? t("admin.imports.flowyteam.lastImport", {
                      when: date(view.lastImport.finishedAt),
                      written: view.lastImport.written,
                      skipped: view.lastImport.skipped,
                    })
                  : t("admin.imports.flowyteam.connectedOn", {
                      when: date(connection.connectedAt),
                    })}
              </p>
            </div>
            {confirmDisconnect ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-ink-2">
                  {t("admin.imports.flowyteam.disconnectConfirm")}
                </span>
                <Button onClick={() => setConfirmDisconnect(false)}>
                  {t("admin.imports.flowyteam.cancel")}
                </Button>
                <Button
                  className={DANGER}
                  pending={spinning("disconnect")}
                  onClick={() =>
                    press("disconnect", disconnectFlowyteamAction, () =>
                      setConfirmDisconnect(false),
                    )
                  }
                  data-testid="flowyteam-disconnect-confirm"
                >
                  {t("admin.imports.flowyteam.disconnect")}
                </Button>
              </div>
            ) : (
              <Button
                className={DANGER}
                disabled={running}
                onClick={() => setConfirmDisconnect(true)}
                data-testid="flowyteam-disconnect"
              >
                {t("admin.imports.flowyteam.disconnect")}
              </Button>
            )}
          </div>
        ) : null}

        {connected && phase.kind === "choose" && !inviting ? (
          <ChooseStep
            domains={props.domains}
            pending={spinning("preview")}
            disabled={!props.backgroundWork}
            onPreview={() => preview("preview")}
          />
        ) : null}

        {connected && running ? (
          <Running
            importing={phase.kind === "importing"}
            company={connection?.companyName ?? ""}
            progress={progress}
          />
        ) : null}

        {connected && phase.kind === "preview" && !inviting ? (
          <PreviewStep
            preview={phase.preview}
            readAt={date(phase.preview.readAt)}
            accepted={accepted}
            onAccept={setAccepted}
            pending={spinning("import")}
            disabled={!props.backgroundWork}
            onBack={() => setBackToChoose(true)}
            onImport={() =>
              press(
                "import",
                () => runFlowyteamAction(accepted),
                () => undefined,
              )
            }
          />
        ) : null}

        {connected && inviting ? (
          <InviteStep
            people={props.people}
            loading={refreshing}
            onClose={() => setInviting(false)}
          />
        ) : null}

        {connected && phase.kind === "linked" && !inviting ? (
          <div className="flex flex-col gap-3" data-testid="flowyteam-linked">
            <div className="rounded-md border border-line bg-raised px-3 py-2 text-sm">
              <p className="font-semibold text-ink">
                {t("admin.imports.flowyteam.importNewDataTitle")}
              </p>
              <p className="text-ink-2">
                {t("admin.imports.flowyteam.importNewDataBody")}
              </p>
            </div>
            <Footer>
              {uninvited.length > 0 ? (
                <Button
                  onClick={() => setInviting(true)}
                  data-testid="flowyteam-open-invite"
                >
                  {t("admin.imports.flowyteam.invitePeople", {
                    count: uninvited.length,
                  })}
                </Button>
              ) : null}
              <Button
                variant="primary"
                pending={spinning("importNew")}
                disabled={!props.backgroundWork}
                onClick={() => preview("importNew")}
                data-testid="flowyteam-import-new"
              >
                {t("admin.imports.flowyteam.importNewData")}
              </Button>
            </Footer>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

function ChooseStep({
  domains,
  pending,
  disabled,
  onPreview,
}: {
  domains: FlowyteamCardProps["domains"];
  pending: boolean;
  disabled: boolean;
  onPreview: () => void;
}) {
  const { t } = useTranslations();
  return (
    <div className="flex flex-col gap-3" data-testid="flowyteam-choose">
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-sm font-semibold text-ink">
          {t("admin.imports.flowyteam.whatToBring")}
        </legend>
        {domains.map((domain) => (
          <label
            key={domain.key}
            className="flex items-start gap-2.5 text-sm text-ink-2"
          >
            <input type="checkbox" checked disabled readOnly className="mt-1" />
            <span>
              <span className="font-medium text-ink">
                {domainLabel(t, domain.key)}
              </span>
              <span className="block text-xs text-ink-3">
                {DOMAIN_WORDS[domain.key]
                  ? t(DOMAIN_WORDS[domain.key]?.hint ?? "")
                  : null}
              </span>
              {domain.requires.length > 0 ? (
                <span className="block text-xs text-ink-3">
                  {t("admin.imports.flowyteam.needs", {
                    domains: domain.requires
                      .map((key) => domainLabel(t, key))
                      .join(", "),
                  })}
                </span>
              ) : null}
            </span>
          </label>
        ))}
      </fieldset>
      <p className="text-xs text-ink-3">
        {t("admin.imports.flowyteam.everythingComes")}
      </p>
      <Footer>
        <span className="text-xs text-ink-3">
          {t("admin.imports.flowyteam.previewHint")}
        </span>
        <Button
          variant="primary"
          pending={pending}
          disabled={disabled}
          onClick={onPreview}
          data-testid="flowyteam-run-preview"
        >
          {t("admin.imports.flowyteam.runPreview")}
        </Button>
      </Footer>
    </div>
  );
}

function Running({
  importing,
  company,
  progress,
}: {
  importing: boolean;
  company: string;
  progress: { domain: string; index: number; total: number } | null;
}) {
  const { t } = useTranslations();
  return (
    <div
      className="flex flex-col gap-2 rounded-md border border-line px-3 py-3 text-sm"
      data-testid={importing ? "flowyteam-importing" : "flowyteam-previewing"}
      aria-live="polite"
    >
      <p className="font-semibold text-ink">
        {importing
          ? t("admin.imports.flowyteam.importingTitle")
          : t("admin.imports.flowyteam.previewingTitle", { company })}
      </p>
      <p className="text-ink-2">{t("admin.imports.flowyteam.canLeave")}</p>
      {progress ? (
        <>
          <p className="text-xs text-ink-3">
            {t("admin.imports.flowyteam.progress", {
              domain: domainLabel(t, progress.domain),
              index: progress.index + 1,
              total: progress.total,
            })}
          </p>
          <progress
            className="h-1.5 w-full"
            max={progress.total}
            value={progress.index}
            aria-label={t("admin.imports.flowyteam.progressLabel")}
          />
        </>
      ) : null}
    </div>
  );
}

function PreviewStep({
  preview,
  readAt,
  accepted,
  onAccept,
  pending,
  disabled,
  onBack,
  onImport,
}: {
  preview: PreviewView;
  readAt: string;
  accepted: boolean;
  onAccept: (value: boolean) => void;
  pending: boolean;
  disabled: boolean;
  onBack: () => void;
  onImport: () => void;
}) {
  const { t } = useTranslations();
  const restricted = preview.restricted.length;
  const blocked = restricted > 0 && !accepted;
  // A domain FlowyTeam holds nothing for is noise in a table of twenty rows.
  const shownDomains = preview.domains.filter(
    (row) => row.read + row.created + row.matched + row.skipped > 0,
  );
  const shareRows = (preview.kpiShares?.rows ?? []).filter(
    (row) => row.count > 0,
  );
  return (
    <div className="flex flex-col gap-4" data-testid="flowyteam-preview">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-ink">
          {t("admin.imports.preview")}
        </h3>
        <Chip tone="neutral">{t("admin.imports.flowyteam.dryRun")}</Chip>
        <span className="text-xs text-ink-3">
          {t("admin.imports.flowyteam.readAt", { when: readAt })}
        </span>
      </div>

      {shownDomains.length === 0 ? (
        <p
          className="rounded-md border border-line border-dashed px-3 py-4 text-center text-sm text-ink-3"
          data-testid="flowyteam-counts"
        >
          {t("admin.imports.flowyteam.nothingToBring")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-line">
          <table className="w-full text-sm" data-testid="flowyteam-counts">
            <thead className="bg-raised text-xs text-ink-3">
              <tr>
                <th scope="col" className="px-3 py-1.5 text-start font-medium">
                  {t("admin.imports.flowyteam.col.data")}
                </th>
                <th scope="col" className="px-3 py-1.5 text-end font-medium">
                  {t("admin.imports.flowyteam.col.inFlowyteam")}
                </th>
                <th scope="col" className="px-3 py-1.5 text-end font-medium">
                  {t("admin.imports.flowyteam.col.willAdd")}
                </th>
                <th scope="col" className="px-3 py-1.5 text-end font-medium">
                  {t("admin.imports.flowyteam.col.alreadyHere")}
                </th>
                <th scope="col" className="px-3 py-1.5 text-end font-medium">
                  {t("admin.imports.flowyteam.col.skipped")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {shownDomains.map((row) => (
                <tr key={row.domain}>
                  <th
                    scope="row"
                    className="px-3 py-1.5 text-start font-normal"
                  >
                    {rowLabel(t, row.domain)}
                  </th>
                  <td className="whitespace-nowrap px-3 py-1.5 text-end tabular-nums">
                    {row.read}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-end tabular-nums">
                    {row.created}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-end tabular-nums">
                    {row.matched}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-end tabular-nums">
                    {row.skipped}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {restricted > 0 ? (
        <div
          className="flex flex-col gap-2 rounded-md border border-warn/40 bg-warn-bg px-3 py-2 text-sm"
          data-testid="flowyteam-restricted"
        >
          <p className="font-semibold text-ink">
            {t("admin.imports.flowyteam.restrictedTitle", {
              count: restricted,
            })}
          </p>
          <p className="text-ink-2">
            {t("admin.imports.flowyteam.restrictedBody")}
          </p>
          <details>
            <summary className="cursor-pointer text-xs text-ink-2">
              {t("admin.imports.flowyteam.restrictedShow", {
                count: restricted,
              })}
            </summary>
            <ul className="mt-1 list-disc ps-5 text-xs text-ink-2">
              {preview.restricted.slice(0, 50).map((kpi) => (
                <li key={kpi.source}>{kpi.reason}</li>
              ))}
            </ul>
          </details>
          <label className="flex items-start gap-2 text-ink">
            <input
              type="checkbox"
              checked={accepted}
              onChange={(event) => onAccept(event.currentTarget.checked)}
              className="mt-1"
              data-testid="flowyteam-accept"
            />
            <span>
              {t("admin.imports.flowyteam.restrictedAccept", {
                count: restricted,
              })}
            </span>
          </label>
        </div>
      ) : null}

      {preview.combined > 0 ||
      preview.recomputed > 0 ||
      shareRows.length > 0 ||
      preview.notes.length > 0 ? (
        <section className="flex flex-col gap-1 text-sm">
          <h3 className="font-semibold text-ink">
            {t("admin.imports.flowyteam.changedTitle")}
          </h3>
          <ul className="list-disc ps-5 text-ink-2">
            {preview.combined > 0 ? (
              <li>
                {t("admin.imports.flowyteam.changedCombined", {
                  count: preview.combined,
                })}
              </li>
            ) : null}
            {preview.recomputed > 0 ? (
              <li>
                {t("admin.imports.flowyteam.changedRecomputed", {
                  count: preview.recomputed,
                })}
              </li>
            ) : null}
            <li>{t("admin.imports.flowyteam.changedDerived")}</li>
            {preview.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
          {shareRows.length > 0 ? (
            <div
              className="mt-2 flex flex-col gap-1"
              data-testid="flowyteam-kpi-shares"
            >
              <h4 className="font-medium text-ink">
                {t("admin.imports.flowyteam.kpiShares.title")}
              </h4>
              <dl className="max-w-md divide-y divide-line rounded-md border border-line">
                {shareRows.map((row) => (
                  <div
                    key={row.key}
                    className="flex items-baseline justify-between gap-3 px-3 py-1.5"
                  >
                    <dt className="text-ink-2">{t(SHARE_ROW_KEYS[row.key])}</dt>
                    <dd className="whitespace-nowrap tabular-nums">
                      {row.count}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}
        </section>
      ) : null}

      {preview.unread.length > 0 || preview.notImported.length > 0 ? (
        <section
          className="flex flex-col gap-1 text-sm"
          data-testid="flowyteam-not-brought"
        >
          <h3 className="font-semibold text-ink">
            {t("admin.imports.flowyteam.notBroughtTitle")}
          </h3>
          <ul className="list-disc ps-5 text-ink-2">
            {preview.unread.map((row) => (
              <li key={row.table}>
                {t("admin.imports.flowyteam.notBroughtRow", {
                  table: row.table,
                  rows: row.rows,
                  holds: row.holds,
                })}
              </li>
            ))}
            {preview.notImported.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="text-xs text-ink-3">
            {t("admin.imports.flowyteam.notBroughtFoot")}
          </p>
        </section>
      ) : null}

      <Footer
        start={
          <Button onClick={onBack}>{t("admin.imports.flowyteam.back")}</Button>
        }
      >
        {blocked ? (
          <span className="text-xs text-ink-3" id="flowyteam-tick-hint">
            {t("admin.imports.flowyteam.tickToImport")}
          </span>
        ) : null}
        <Button
          variant="primary"
          pending={pending}
          disabled={blocked || disabled}
          aria-describedby={blocked ? "flowyteam-tick-hint" : undefined}
          onClick={onImport}
          data-testid="flowyteam-import"
        >
          {t("admin.imports.flowyteam.importRows", { count: preview.toAdd })}
        </Button>
      </Footer>
    </div>
  );
}

function InviteStep({
  people,
  loading,
  onClose,
}: {
  people: readonly FlowyteamPerson[];
  /** The people the import just wrote are still being read. */
  loading: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslations();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [filter, setFilter] = useState("");
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [result, setResult] = useState<InviteOutcome | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  const open = people.filter((person) => !person.invited);
  const invitedCount = people.length - open.length;
  const words = filter.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = people.filter((person) =>
    words.every((word) =>
      `${person.name} ${person.email} ${person.title ?? ""}`
        .toLowerCase()
        .includes(word),
    ),
  );
  const shownOpen = shown.filter((person) => !person.invited);
  const allShown =
    shownOpen.length > 0 &&
    shownOpen.every((person) => chosen.has(person.memberId));

  function toggle(memberId: string) {
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(memberId)) next.delete(memberId);
      else next.add(memberId);
      return next;
    });
  }

  function toggleAll() {
    setChosen((current) => {
      const next = new Set(current);
      for (const person of shownOpen) {
        if (allShown) next.delete(person.memberId);
        else next.add(person.memberId);
      }
      return next;
    });
  }

  function send() {
    setRefusal(null);
    startTransition(async () => {
      const answer = await inviteFlowyteamPeopleAction([...chosen]);
      if (answer.ok) {
        setResult(answer.value);
        setChosen(new Set());
        router.refresh();
      } else {
        setRefusal(answer.message);
      }
    });
  }

  return (
    <div className="flex flex-col gap-3" data-testid="flowyteam-invite">
      {people.length === 0 && loading ? null : (
        <div className="flex flex-col gap-1 text-sm text-ink-2">
          <p>
            {t("admin.imports.flowyteam.inviteIntro", {
              count: people.length,
            })}
          </p>
          <p>
            {invitedCount === 0
              ? t("admin.imports.flowyteam.inviteNobodyEmailed")
              : t("admin.imports.flowyteam.inviteSomeInvited", {
                  count: invitedCount,
                })}
          </p>
        </div>
      )}
      <p className="text-xs text-ink-3">
        {t("admin.imports.flowyteam.inviteEveryone")}
      </p>
      {result ? (
        <Notice
          tone={result.failed.length > 0 ? "warn" : "ok"}
          testId="flowyteam-invite-result"
        >
          <p>
            {t("admin.imports.flowyteam.inviteSent", { count: result.sent })}
          </p>
          {result.failed.length > 0 ? (
            <ul className="mt-1 list-disc ps-5 text-xs">
              {result.failed.map((failure) => (
                <li key={failure.email}>
                  {failure.email}: {failure.message}
                </li>
              ))}
            </ul>
          ) : null}
        </Notice>
      ) : null}
      {refusal ? <Notice tone="bad">{refusal}</Notice> : null}
      {people.length === 0 && loading ? (
        <p
          className="rounded-md border border-line border-dashed px-3 py-4 text-center text-sm text-ink-3"
          aria-live="polite"
          data-testid="flowyteam-invite-loading"
        >
          {t("admin.imports.flowyteam.inviteLoading")}
        </p>
      ) : people.length === 0 ? (
        <p className="rounded-md border border-line border-dashed px-3 py-4 text-center text-sm text-ink-3">
          {t("admin.imports.flowyteam.inviteNobody")}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-12 items-end gap-3">
            <div className="col-span-12 sm:col-span-6">
              <SearchInput
                label={t("admin.imports.flowyteam.inviteFilter")}
                value={filter}
                onChange={(event) => setFilter(event.currentTarget.value)}
              />
            </div>
            <label className="col-span-12 flex items-center gap-2 text-sm text-ink-2 sm:col-span-6 sm:justify-end">
              <input
                type="checkbox"
                checked={allShown}
                disabled={shownOpen.length === 0}
                onChange={toggleAll}
                data-testid="flowyteam-invite-all"
              />
              {t("admin.imports.flowyteam.selectAllShown", {
                count: shownOpen.length,
              })}
            </label>
          </div>
          <ul
            // biome-ignore lint/a11y/noNoninteractiveTabindex: a scroll region must be focusable to scroll by keyboard
            tabIndex={0}
            aria-label={t("admin.imports.flowyteam.invitePeopleList")}
            className="max-h-[296px] divide-y divide-line overflow-y-auto overscroll-contain rounded-lg border border-line"
          >
            {shown.map((person) => (
              <li key={person.memberId} className="px-3 py-2 text-sm">
                <label className="flex items-center gap-2.5">
                  <input
                    type="checkbox"
                    checked={chosen.has(person.memberId)}
                    disabled={person.invited}
                    onChange={() => toggle(person.memberId)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-ink">
                      {person.name}
                    </span>
                    <span className="block truncate text-xs text-ink-3">
                      {person.email}
                      {person.title ? ` · ${person.title}` : ""}
                    </span>
                  </span>
                  {person.invited ? (
                    <Chip tone="info">
                      {t("admin.imports.flowyteam.invited")}
                    </Chip>
                  ) : null}
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
      <Footer>
        <Button onClick={onClose} data-testid="flowyteam-invite-not-now">
          {result
            ? t("admin.imports.flowyteam.done")
            : t("admin.imports.flowyteam.notNow")}
        </Button>
        <Button
          variant="primary"
          pending={pending}
          disabled={chosen.size === 0}
          onClick={send}
          data-testid="flowyteam-invite-send"
        >
          {t("admin.imports.flowyteam.sendInvitations", { count: chosen.size })}
        </Button>
      </Footer>
    </div>
  );
}
