"use client";

/**
 * The import wizard (UIUX-PLAN.md §6 S-36, P6-T01b-b).
 *
 * Four steps, and each one earns its place by being a decision somebody makes:
 * which file, what each column is, whether the preview is what they meant, and
 * only then the import. Collapsing the middle two would mean confirming a
 * mapping and a write in one click, which is the one thing a person migrating
 * a quarter of somebody else's history should not be able to do by accident.
 *
 * **The table never leaves the browser between steps and is never parsed in
 * it.** The server read the bytes once; what the browser holds is rows of text
 * it posts back unchanged. That is why the preview and the import cannot see
 * different data.
 *
 * **Nothing here is disabled because AI is off.** The mapping arrives from the
 * template's aliases whether or not a provider is configured; a proposal only
 * fills columns the aliases left empty, and its chip is the only thing that
 * disappears.
 */

import { Button, Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import { useState, useTransition } from "react";
import {
  previewImportAction,
  type ReportView,
  readUploadAction,
  runImportAction,
  type UploadedColumn,
} from "./actions.ts";

interface EntityField {
  readonly field: string;
  readonly describe: string;
  readonly required: boolean;
}

export interface EntityChoice {
  readonly entity: string;
  readonly describe: string;
  readonly fields: readonly EntityField[];
}

type Step = "upload" | "mapping" | "preview" | "done";

interface Loaded {
  readonly filename: string;
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
  readonly notes: string | null;
}

export function ImportWizard({
  entities,
  aiOn,
}: {
  readonly entities: readonly EntityChoice[];
  readonly aiOn: boolean;
}) {
  const first = entities[0]?.entity ?? "goals";
  const [step, setStep] = useState<Step>("upload");
  const [entity, setEntity] = useState(first);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [columns, setColumns] = useState<readonly UploadedColumn[]>([]);
  const [report, setReport] = useState<ReportView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const template = entities.find((choice) => choice.entity === entity);
  const claimed = new Set(
    columns
      .map((column) => column.field)
      .filter((f): f is string => f !== null),
  );
  const missing = (template?.fields ?? [])
    .filter((field) => field.required && !claimed.has(field.field))
    .map((field) => field.field);

  const mappingOf = (): Record<string, string | null> =>
    Object.fromEntries(columns.map((c) => [c.header, c.field]));

  const restart = () => {
    setStep("upload");
    setLoaded(null);
    setColumns([]);
    setReport(null);
    setError(null);
  };

  const upload = (formData: FormData) => {
    setError(null);
    start(async () => {
      const answer = await readUploadAction(formData);
      if (!answer.ok) {
        setError(answer.error);
        return;
      }
      setLoaded({
        filename: answer.value.filename,
        headers: answer.value.headers,
        rows: answer.value.rows,
        notes: answer.value.notes,
      });
      setColumns(answer.value.columns);
      setStep("mapping");
    });
  };

  const run = (real: boolean) => {
    if (!loaded) {
      return;
    }
    setError(null);
    start(async () => {
      const input = {
        entity,
        name: loaded.filename,
        headers: loaded.headers,
        rows: loaded.rows,
        mapping: mappingOf(),
      };
      const answer = real
        ? await runImportAction(input)
        : await previewImportAction(input);
      if (!answer.ok) {
        setError(answer.error);
        return;
      }
      setReport(answer.value);
      setStep(real ? "done" : "preview");
    });
  };

  return (
    <Card>
      <CardHeader className="justify-between">
        <h2 className="text-sm font-bold text-ink">Import a spreadsheet</h2>
        <StepTrail step={step} />
      </CardHeader>
      <CardBody className="flex flex-col gap-4" aria-busy={pending}>
        {error ? (
          <p
            role="alert"
            data-testid="import-error"
            className="rounded-md bg-bad-bg px-2.5 py-2 text-xs text-bad"
          >
            {error}
          </p>
        ) : null}

        {step === "upload" ? (
          <form action={upload} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-xs font-semibold text-ink-2">
              What is in the file
              <select
                name="entity"
                value={entity}
                onChange={(event) => setEntity(event.target.value)}
                data-testid="import-entity"
                className="h-7.5 rounded-control border border-line-2 bg-surface px-2 text-sm font-normal text-ink"
              >
                {entities.map((choice) => (
                  <option key={choice.entity} value={choice.entity}>
                    {choice.entity}
                  </option>
                ))}
              </select>
            </label>
            {template ? (
              <p className="text-xs text-ink-3">{template.describe}</p>
            ) : null}
            <label className="flex flex-col gap-1 text-xs font-semibold text-ink-2">
              The file
              <input
                type="file"
                name="file"
                accept=".csv,.xlsx"
                required
                data-testid="import-file"
                className="text-sm font-normal text-ink-2 file:mr-2 file:rounded-control file:border file:border-line-2 file:bg-surface file:px-2 file:py-1 file:text-xs file:font-semibold file:text-ink-2"
              />
            </label>
            <p className="text-xs text-ink-3">
              CSV or XLSX. Nothing is written until you have seen the preview
              and asked for it.
            </p>
            <div>
              <Button type="submit" variant="primary" disabled={pending}>
                {pending ? "Reading" : "Read the file"}
              </Button>
            </div>
          </form>
        ) : null}

        {step === "mapping" && loaded && template ? (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-ink-3">
              {loaded.filename}, {loaded.rows.length}{" "}
              {loaded.rows.length === 1 ? "row" : "rows"}. Say what each column
              is. A column set to nothing is ignored.
            </p>
            {aiOn && loaded.notes ? (
              <p
                data-testid="import-notes"
                className="rounded-md border border-brand-line bg-surface px-2.5 py-2 text-xs text-ink-2"
              >
                <span className="font-semibold text-brand-text">
                  Proposed mapping:
                </span>{" "}
                {loaded.notes}
              </p>
            ) : null}
            <ul
              className="flex flex-col divide-y divide-line"
              data-testid="import-columns"
            >
              {columns.map((column, index) => (
                <li
                  key={column.header}
                  className="flex items-center gap-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink">
                      {column.header}
                    </p>
                    <p className="truncate text-xs text-ink-3">
                      {column.sample || "empty"}
                    </p>
                  </div>
                  {aiOn && column.proposed ? (
                    <Chip tone="brand">Proposed</Chip>
                  ) : null}
                  <select
                    aria-label={`What ${column.header} is`}
                    value={column.field ?? ""}
                    onChange={(event) => {
                      const field = event.target.value || null;
                      setColumns((previous) =>
                        previous.map((other, otherIndex) =>
                          otherIndex === index
                            ? { ...other, field, proposed: false }
                            : // A field carries one column, so naming it here
                              // takes it off whichever column held it before.
                              field !== null && other.field === field
                              ? { ...other, field: null, proposed: false }
                              : other,
                        ),
                      );
                    }}
                    className="h-7.5 w-56 rounded-control border border-line-2 bg-surface px-2 text-sm text-ink"
                  >
                    <option value="">Ignore this column</option>
                    {template.fields.map((field) => (
                      <option key={field.field} value={field.field}>
                        {field.field}
                        {field.required ? " (required)" : ""}
                      </option>
                    ))}
                  </select>
                </li>
              ))}
            </ul>
            {missing.length > 0 ? (
              <p
                data-testid="import-missing"
                className="rounded-md bg-warn-bg px-2.5 py-2 text-xs text-warn"
              >
                Nothing carries {missing.join(", ")}, and{" "}
                {missing.length === 1 ? "it is" : "they are"} required.
              </p>
            ) : null}
            <div className="flex gap-2">
              <Button
                variant="primary"
                disabled={pending || missing.length > 0}
                onClick={() => run(false)}
                data-testid="import-preview"
              >
                {pending ? "Checking" : "Preview"}
              </Button>
              <Button onClick={restart} disabled={pending}>
                Choose another file
              </Button>
            </div>
          </div>
        ) : null}

        {(step === "preview" || step === "done") && report ? (
          <div className="flex flex-col gap-3">
            <Counts report={report} />
            {report.unmappedHeaders.length > 0 ? (
              <p className="text-xs text-ink-3">
                Not imported: {report.unmappedHeaders.join(", ")}.
              </p>
            ) : null}
            <RowTable report={report} />
            {step === "preview" ? (
              <div className="flex gap-2">
                <Button
                  variant="primary"
                  disabled={pending || report.created + report.updated === 0}
                  onClick={() => run(true)}
                  data-testid="import-confirm"
                >
                  {pending
                    ? "Importing"
                    : `Import ${report.created + report.updated} ${
                        report.created + report.updated === 1 ? "row" : "rows"
                      }`}
                </Button>
                <Button
                  onClick={() => {
                    setReport(null);
                    setStep("mapping");
                  }}
                  disabled={pending}
                >
                  Back to the columns
                </Button>
              </div>
            ) : (
              <div className="flex gap-2">
                <p
                  data-testid="import-done"
                  className="rounded-md bg-ok-bg px-2.5 py-2 text-xs text-ok"
                >
                  Imported. Run the same file again and it writes nothing new.
                </p>
                <Button onClick={restart}>Import another file</Button>
              </div>
            )}
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

function Counts({ report }: { readonly report: ReportView }) {
  return (
    <dl className="flex gap-6" data-testid="import-counts">
      {[
        ["Read", report.rowsRead],
        [report.mode === "real" ? "Created" : "To create", report.created],
        [report.mode === "real" ? "Updated" : "To update", report.updated],
        ["Skipped", report.skipped],
      ].map(([label, value]) => (
        <div key={String(label)}>
          <dt className="text-xs text-ink-3">{label}</dt>
          <dd className="text-lg font-bold text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Every row, skips first.
 *
 * A person fixing a file needs the failures, and a report that made them scroll
 * past nine hundred successes to find three would be a worse report than the
 * command's, which prints them the same way.
 */
function RowTable({ report }: { readonly report: ReportView }) {
  const ordered = [...report.rows].sort((a, b) =>
    a.outcome === b.outcome
      ? a.line - b.line
      : a.outcome === "skipped"
        ? -1
        : 1,
  );
  return (
    <div className="max-h-96 overflow-y-auto rounded-md border border-line">
      <table className="w-full text-left text-xs">
        <thead className="sticky top-0 bg-raised text-ink-3">
          <tr>
            <th className="px-2.5 py-1.5 font-semibold">Line</th>
            <th className="px-2.5 py-1.5 font-semibold">Identifier</th>
            <th className="px-2.5 py-1.5 font-semibold">What happens</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line" data-testid="import-rows">
          {ordered.map((row) => (
            <tr key={row.line}>
              <td className="px-2.5 py-1.5 text-ink-3">{row.line}</td>
              <td className="px-2.5 py-1.5 text-ink-2">
                {row.externalId ?? ""}
              </td>
              <td className="px-2.5 py-1.5">
                {row.outcome === "skipped" ? (
                  <span className="text-bad">Skipped. {row.reason}</span>
                ) : (
                  <span className="text-ink-2">
                    {row.outcome === "created" ? "Created" : "Updated"}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const STEPS: readonly { readonly id: Step; readonly label: string }[] = [
  { id: "upload", label: "File" },
  { id: "mapping", label: "Columns" },
  { id: "preview", label: "Preview" },
  { id: "done", label: "Import" },
];

function StepTrail({ step }: { readonly step: Step }) {
  const at = STEPS.findIndex((one) => one.id === step);
  return (
    <ol className="flex items-center gap-2 text-xs" data-testid="import-steps">
      {STEPS.map((one, index) => (
        <li
          key={one.id}
          aria-current={one.id === step ? "step" : undefined}
          className={
            index === at
              ? "font-bold text-ink"
              : index < at
                ? "text-ink-3"
                : "text-ink-4"
          }
        >
          {index + 1}. {one.label}
        </li>
      ))}
    </ol>
  );
}
