"use client";

import { Button } from "@openokr/ui";
import { useState, useTransition } from "react";
import { setFormula } from "./actions.ts";

const OPERATORS = [
  { key: "add" as const, label: "sum" },
  { key: "sub" as const, label: "difference" },
  { key: "mul" as const, label: "product" },
  { key: "div" as const, label: "ratio" },
];

/**
 * The formula builder S-21 asks for (P3-T14, closing what P3-T13 left open).
 *
 * References and one operator, with the sources listed in the order they will
 * be folded, because `sub` and `div` are not commutative and an order the
 * reader cannot see is an answer they cannot predict. Validation is the
 * engine's: the action refuses a cycle or a self-reference and the refusal is
 * shown here in its own words.
 */
export function FormulaBuilder({
  kpiId,
  candidates,
  today,
  current,
}: {
  readonly kpiId: string;
  readonly candidates: readonly {
    readonly id: string;
    readonly title: string;
    readonly frequency: string;
  }[];
  readonly today: string;
  readonly current: readonly string[];
}) {
  const [operator, setOperator] = useState<"add" | "sub" | "mul" | "div">(
    "add",
  );
  const [picked, setPicked] = useState<string[]>([...current]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  const toggle = (id: string) => {
    setSaved(false);
    setPicked((previous) =>
      previous.includes(id)
        ? previous.filter((entry) => entry !== id)
        : [...previous, id],
    );
  };

  const titleOf = (id: string) =>
    candidates.find((candidate) => candidate.id === id)?.title ?? "a KPI";

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-ink-3">Combine the sources as a</span>
        {OPERATORS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            onClick={() => {
              setOperator(entry.key);
              setSaved(false);
            }}
            className={
              entry.key === operator
                ? "rounded-full bg-brand-weak px-2.5 py-1 text-xs font-semibold text-brand-text"
                : "rounded-full border border-line px-2.5 py-1 text-xs text-ink-2 hover:border-brand"
            }
          >
            {entry.label}
          </button>
        ))}
      </div>

      <ul className="flex max-h-56 flex-col overflow-y-auto rounded-md border border-line">
        {candidates.length === 0 ? (
          <li className="p-2.5 text-xs text-ink-3">
            There is no other KPI to calculate from yet.
          </li>
        ) : null}
        {candidates.map((candidate) => (
          <li
            key={candidate.id}
            className="flex items-center gap-2 border-line border-b px-2.5 py-1.5 last:border-b-0"
          >
            <input
              type="checkbox"
              id={`source-${candidate.id}`}
              checked={picked.includes(candidate.id)}
              onChange={() => toggle(candidate.id)}
            />
            <label
              htmlFor={`source-${candidate.id}`}
              className="min-w-0 flex-1 truncate text-xs text-ink"
            >
              {candidate.title}
            </label>
            <span className="text-xs text-ink-4">{candidate.frequency}</span>
          </li>
        ))}
      </ul>

      {picked.length > 0 ? (
        <p className="text-xs text-ink-2">
          {picked
            .map(titleOf)
            .join(
              operator === "add"
                ? " + "
                : operator === "sub"
                  ? " − "
                  : operator === "mul"
                    ? " × "
                    : " ÷ ",
            )}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="primary"
          disabled={pending || picked.length === 0}
          onClick={() =>
            start(async () => {
              const result = await setFormula(kpiId, operator, picked, today);
              setError(result.error);
              setSaved(result.error === null);
            })
          }
        >
          {pending ? "Saving" : "Save the formula"}
        </Button>
        {saved ? (
          <span className="text-xs text-ok">
            Saved and evaluated for this period.
          </span>
        ) : null}
      </div>
      {error ? <p className="text-xs text-bad">{error}</p> : null}
      <p className="text-xs text-ink-4">
        A source measured more often than this KPI rolls up with its own
        aggregate. A cycle or a self-reference is refused when you save, not
        after it has been stored.
      </p>
    </div>
  );
}
