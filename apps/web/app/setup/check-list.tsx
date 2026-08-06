import type { ConnectionTest } from "@openokr/core";

/**
 * How a connection test reads to an operator (P1-T09).
 *
 * Three outcomes, three different words. "Not in this build" is deliberately
 * not a warning: a port with no driver yet is not a problem with their
 * deployment, and treating it as one teaches operators to ignore warnings.
 */
const LABELS: Record<ConnectionTest["outcome"], string> = {
  ok: "Ready",
  failed: "Problem",
  unavailable: "Not in this build",
};

const PORT_NAMES: Record<string, string> = {
  database: "Database",
  mail: "Mail",
  channel: "Chat channels",
  ai: "AI provider",
};

export function CheckList({ tests }: { tests: readonly ConnectionTest[] }) {
  return (
    <dl>
      {tests.map((test) => (
        <div key={test.port}>
          <dt>
            {PORT_NAMES[test.port] ?? test.port}: {LABELS[test.outcome]}
          </dt>
          <dd>{test.detail}</dd>
        </div>
      ))}
    </dl>
  );
}
