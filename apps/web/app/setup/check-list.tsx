import type { ConnectionTest } from "@openokr/core";
import { VerdictDot, type VerdictState } from "@openokr/ui";

/**
 * How a connection test reads to an operator (P1-T09, restyled P2-T10).
 *
 * Three outcomes, three different words. "Not in this build" is deliberately
 * not a warning: a port with no driver yet is not a problem with their
 * deployment, and treating it as one teaches operators to ignore warnings —
 * which is why it maps to `VerdictDot`'s neutral "todo" state, not "warn".
 */
const LABELS: Record<ConnectionTest["outcome"], string> = {
  ok: "Ready",
  failed: "Problem",
  unavailable: "Not in this build",
};

const VERDICT_STATES: Record<ConnectionTest["outcome"], VerdictState> = {
  ok: "pass",
  failed: "fail",
  unavailable: "todo",
};

const PORT_NAMES: Record<string, string> = {
  database: "Database",
  mail: "Mail",
  storage: "File storage",
  channel: "Chat channels",
  ai: "AI provider",
};

export function CheckList({ tests }: { tests: readonly ConnectionTest[] }) {
  return (
    <dl className="flex flex-col gap-2.5">
      {tests.map((test) => (
        <div key={test.port} className="flex flex-col gap-0.5">
          <dt className="flex items-center gap-2 text-sm font-semibold text-ink-2">
            <VerdictDot state={VERDICT_STATES[test.outcome]} />
            {PORT_NAMES[test.port] ?? test.port}: {LABELS[test.outcome]}
          </dt>
          <dd className="pl-4 text-xs text-ink-4">{test.detail}</dd>
        </div>
      ))}
    </dl>
  );
}
