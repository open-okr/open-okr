"use client";

import { Dialog } from "@base-ui-components/react/dialog";
import { Button, useTranslations } from "@openokr/ui";
import { X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, useActionState, useEffect, useRef } from "react";
import { NO_ERROR, type WriteState } from "../cycle/write-state.ts";

/**
 * The KPI grid's two forms, opened from a button rather than always open
 * (KPI redesign, 2 November 2026): New KPI as a side panel, New category as a
 * small dialog.
 *
 * **They live in the address**, `?new=kpi` and `?new=category`, the way the
 * Goals list opens its own form with `?new=objective`. So the topbar's `+ New`
 * can open the panel from any screen, and the "Add a KPI to Customer" row
 * names its category with `&in=<id>`, which the server reads to preselect it.
 * Closing takes both away and keeps the filters.
 *
 * **It closes itself when the write is accepted**, and stays open on a
 * refusal so the sentence is read beside the fields that caused it.
 */
export function KpiPanel({
  which,
  title,
  submitLabel,
  action,
  variant = "panel",
  after,
  clear = ["new", "in"],
  children,
}: {
  /** The value of `new` in the address that opens it. */
  readonly which: "kpi" | "category" | "tree" | "driver";
  readonly title: string;
  readonly submitLabel: string;
  readonly action: (
    previous: WriteState,
    formData: FormData,
  ) => Promise<WriteState>;
  /** A side panel, or a small dialog in the middle. */
  readonly variant?: "panel" | "dialog";
  /** Drawn under the form and outside it, such as the KPI suggestion. */
  readonly after?: ReactNode;
  /**
   * What closing takes out of the address. The driver panel also clears
   * `under`, the KPI it was opened for.
   */
  readonly clear?: readonly string[];
  /** The fields, rendered on the server. */
  readonly children: ReactNode;
}) {
  const { t } = useTranslations();
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const open = params.get("new") === which;

  const close = () => {
    const next = new URLSearchParams(params.toString());
    for (const key of clear) {
      next.delete(key);
    }
    const query = next.toString();
    router.replace(query === "" ? pathname : `${pathname}?${query}`, {
      scroll: false,
    });
  };

  const [state, formAction, pending] = useActionState(action, NO_ERROR);
  const sent = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: closes once a submission has finished; `close` is rebuilt each render and is not the trigger.
  useEffect(() => {
    if (pending || !sent.current) {
      return;
    }
    sent.current = false;
    if (!state.error) {
      close();
    }
  }, [pending, state]);

  const panel = variant === "panel";
  const formId = `kpi-${which}-form`;

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          close();
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-ink/25" />
        <Dialog.Popup
          data-testid={`kpi-${which}-panel`}
          className={
            panel
              ? "fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-line bg-surface shadow-lg outline-none"
              : "fixed top-28 left-1/2 z-40 flex w-[calc(100%-1.5rem)] max-w-sm -translate-x-1/2 flex-col rounded-xl border border-line bg-surface shadow-(--shadow-popover) outline-none"
          }
        >
          <header
            className={`flex flex-none items-center gap-2 px-4 ${
              panel ? "border-b border-line py-3" : "pt-4"
            }`}
          >
            <Dialog.Title className="min-w-0 flex-1 truncate text-[15px] font-bold text-ink">
              {title}
            </Dialog.Title>
            <Dialog.Close
              aria-label={t("kpis.panel.close")}
              className="flex size-7 flex-none items-center justify-center rounded-control text-ink-3 hover:bg-raised hover:text-ink"
            >
              <X className="size-4" aria-hidden="true" />
            </Dialog.Close>
          </header>
          <div
            className={`flex min-h-0 flex-col gap-3 px-4 ${
              panel ? "flex-1 overflow-y-auto py-3.5" : "py-3"
            }`}
          >
            <form
              id={formId}
              action={formAction}
              onSubmit={() => {
                sent.current = true;
              }}
              aria-busy={pending}
              className="flex flex-col gap-3"
            >
              {children}
              {state.error ? (
                <p
                  role="alert"
                  className="rounded-md bg-bad-bg px-2.5 py-1.5 text-xs text-bad"
                >
                  {state.error}
                </p>
              ) : null}
            </form>
            {/* Outside the form, so Enter in the suggestion's own field does
             * not submit the KPI beside it. */}
            {after}
          </div>
          <footer
            className={`flex flex-none justify-end gap-2 px-4 py-3 ${
              panel ? "border-t border-line" : ""
            }`}
          >
            <Dialog.Close
              render={<Button type="button">{t("common.cancel")}</Button>}
            />
            <Button
              type="submit"
              form={formId}
              variant="primary"
              pending={pending}
            >
              {submitLabel}
            </Button>
          </footer>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
