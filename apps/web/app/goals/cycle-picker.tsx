"use client";

import type { CycleCadence } from "@openokr/db";
import { Button, useTranslations } from "@openokr/ui";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { addCycle } from "./editor-actions.ts";

/** What the explorer substitutes a cycle id for when it builds the template. */
export const CYCLE_PLACEHOLDER = "__cycle__";

/**
 * Which cycle is on screen, and how another one is created (S-13, P8-G12).
 *
 * The explorer listed every cycle as a chip in the filter bar, which is a row
 * that grows by one every quarter and never shrinks. A searchable picker is
 * the same choice in constant space, and it is where somebody looking for a
 * cycle looks for the way to add one.
 *
 * **Creating a cycle here creates the frame, not the practice.** `cycles.create`
 * derives the period's start, end and name from one date and the cadence, so
 * the form cannot produce a cycle whose end precedes its start. The eight
 * phases and their gates are set up on /cycle afterwards, and the picker says
 * so rather than implying this is the whole setup.
 */

export function CyclePicker({
  cycles,
  cycleId,
  hrefTemplate,
  canCreate,
}: {
  readonly cycles: readonly { readonly id: string; readonly name: string }[];
  readonly cycleId: string | null;
  /**
   * The explorer's own URL with the cycle replaced by `CYCLE_PLACEHOLDER`, so
   * choosing a cycle keeps every other filter.
   *
   * A template rather than the builder itself. The explorer is a server
   * component and this is a client one, so a function prop does not survive
   * the boundary: it throws at render and the route's error boundary draws
   * "We could not load the goals", which is how this arrived.
   */
  readonly hrefTemplate: string;
  readonly canCreate: boolean;
}) {
  const { t } = useTranslations();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    cadence: "quarterly" as CycleCadence,
    on: new Date().toISOString().slice(0, 10),
  });
  const dialogId = useId();

  const current = cycles.find((cycle) => cycle.id === cycleId);
  const matches = cycles.filter((cycle) =>
    cycle.name.toLowerCase().includes(query.trim().toLowerCase()),
  );

  const create = () => {
    setProblem(null);
    start(async () => {
      const result = await addCycle({
        on: form.on,
        cadence: form.cadence,
        ...(form.name.trim() ? { name: form.name.trim() } : {}),
      });
      if (result.error) {
        setProblem(result.error);
        return;
      }
      setCreating(false);
      setForm((value) => ({ ...value, name: "" }));
      if (result.id) {
        router.push(hrefTemplate.replace(CYCLE_PLACEHOLDER, result.id));
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="flex items-center gap-2">
      <div className="relative">
        <Button
          type="button"
          aria-expanded={open}
          aria-haspopup="listbox"
          onClick={() => setOpen((value) => !value)}
        >
          {current?.name ?? t("goals.editor.noCycle")}
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            aria-hidden="true"
            className="size-2.5 opacity-60"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </Button>

        {open ? (
          <div className="absolute left-0 top-9 z-30 w-64 rounded-lg border border-line bg-surface p-1.5 shadow-popover">
            <input
              value={query}
              aria-label={t("goals.editor.searchCycle")}
              placeholder={t("goals.editor.searchCycle")}
              onChange={(event) => setQuery(event.target.value)}
              className="w-full rounded-control border border-line bg-bg px-2 py-1 text-xs text-ink outline-none focus:border-brand focus:bg-surface"
            />
            <ul className="mt-1.5 max-h-52 overflow-auto">
              {matches.map((cycle) => (
                <li key={cycle.id}>
                  <a
                    href={hrefTemplate.replace(CYCLE_PLACEHOLDER, cycle.id)}
                    aria-current={cycle.id === cycleId ? "true" : undefined}
                    className={`block rounded-control px-2 py-1.5 text-xs hover:bg-bg ${
                      cycle.id === cycleId
                        ? "bg-brand-weak font-semibold text-brand-text"
                        : "text-ink-2"
                    }`}
                  >
                    {cycle.name}
                  </a>
                </li>
              ))}
              {matches.length === 0 ? (
                <li className="px-2 py-1.5 text-xs text-ink-4">
                  {t("goals.editor.noCycleMatch")}
                </li>
              ) : null}
            </ul>
          </div>
        ) : null}
      </div>

      {canCreate ? (
        <Button
          type="button"
          aria-label={t("goals.editor.addCycle")}
          aria-haspopup="dialog"
          onClick={() => {
            setOpen(false);
            setCreating(true);
          }}
        >
          +
        </Button>
      ) : null}

      {creating ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={dialogId}
            className="w-104 max-w-full overflow-hidden rounded-lg border border-line bg-surface shadow-popover"
          >
            <h2
              id={dialogId}
              className="border-b border-line px-4 py-3 text-sm font-bold text-ink"
            >
              {t("goals.editor.addCycle")}
            </h2>
            <div className="flex flex-col gap-3 px-4 py-3.5">
              <label className="flex flex-col gap-1 text-[11px] font-semibold text-ink-3">
                {t("goals.editor.cycleName")}
                <input
                  value={form.name}
                  placeholder={t("goals.editor.cycleNameHint")}
                  onChange={(event) =>
                    setForm((value) => ({ ...value, name: event.target.value }))
                  }
                  className="rounded-control border border-line-2 bg-surface px-2 py-1.5 text-xs font-normal text-ink outline-none focus:border-brand"
                />
              </label>
              <label className="flex flex-col gap-1 text-[11px] font-semibold text-ink-3">
                {t("goals.editor.cycleCadence")}
                <select
                  value={form.cadence}
                  onChange={(event) =>
                    setForm((value) => ({
                      ...value,
                      cadence: event.target.value as CycleCadence,
                    }))
                  }
                  className="rounded-control border border-line-2 bg-surface px-2 py-1.5 text-xs font-normal text-ink outline-none focus:border-brand"
                >
                  <option value="quarterly">
                    {t("goals.editor.cadenceQuarterly")}
                  </option>
                  <option value="annual">
                    {t("goals.editor.cadenceAnnual")}
                  </option>
                  <option value="semiannual">
                    {t("goals.editor.cadenceSemiannual")}
                  </option>
                  <option value="monthly">
                    {t("goals.editor.cadenceMonthly")}
                  </option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[11px] font-semibold text-ink-3">
                {t("goals.editor.cycleOn")}
                <input
                  type="date"
                  value={form.on}
                  onChange={(event) =>
                    setForm((value) => ({ ...value, on: event.target.value }))
                  }
                  className="rounded-control border border-line-2 bg-surface px-2 py-1.5 text-xs font-normal text-ink outline-none focus:border-brand"
                />
              </label>
              <p className="text-[11px] text-ink-4">
                {t("goals.editor.cycleHelp")}
              </p>
              {problem ? (
                <p role="alert" className="text-xs text-bad">
                  {problem}
                </p>
              ) : null}
            </div>
            <div className="flex justify-end gap-2 border-t border-line bg-bg px-4 py-3">
              <Button
                type="button"
                disabled={pending}
                onClick={() => setCreating(false)}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="button"
                variant="primary"
                disabled={pending}
                onClick={create}
              >
                {t("goals.editor.createCycle")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
