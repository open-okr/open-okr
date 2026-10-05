"use client";

import type { GoalLevel } from "@openokr/db";
import type { OkrKind } from "@openokr/method";
import { Button, useTranslations } from "@openokr/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addObjective } from "./editor-actions.ts";
import {
  RestrictedWriting,
  type WritingRefusal,
} from "./restricted-writing.tsx";

/**
 * Starting an objective from the top of the screen (S-13).
 *
 * The set already carries an add row under it, which is where somebody adds
 * one while reading the set. This is the other moment: arriving at an empty
 * cycle, or deciding to add one before reading anything. A reader should not
 * have to scroll past nine objectives to reach the control that makes the
 * tenth.
 *
 * **It writes nothing until a title is typed**, the same as the add row: a
 * mis-click leaves nothing behind for somebody else to clean up. Both call the
 * same server action, so there is one way an objective is created and two
 * places to reach it.
 */
export function NewObjectiveButton({
  cycleId,
  level,
  refusal,
  initiallyOpen,
  kinds,
  defaultKind,
}: {
  readonly cycleId: string;
  readonly level: GoalLevel;
  /**
   * Why the workspace holds writing back here now, or null when it does
   * not (P9-T07b-a). The button then opens the reason instead of a field.
   */
  readonly refusal: WritingRefusal | null;
  /** Open on arrival, for the topbar's `+ New`, which links here. */
  readonly initiallyOpen?: boolean;
  /**
   * The kinds the workspace uses, and the one a new objective starts as
   * (METHOD.md §2.8, decision D2). The choice is offered only where there
   * are two.
   */
  readonly kinds: readonly OkrKind[];
  readonly defaultKind: OkrKind;
}) {
  const { t } = useTranslations();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(initiallyOpen === true);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<OkrKind>(defaultKind);
  const [problem, setProblem] = useState<string | null>(null);

  const save = () => {
    const wanted = title.trim();
    if (wanted === "") {
      return;
    }
    setProblem(null);
    start(async () => {
      const created = await addObjective({
        cycleId,
        level,
        title: wanted,
        ...(kinds.length > 1 ? { kind } : {}),
      });
      if (created.error) {
        setProblem(created.error);
        return;
      }
      setTitle("");
      setOpen(false);
      router.refresh();
    });
  };

  if (!open) {
    return (
      <Button type="button" variant="primary" onClick={() => setOpen(true)}>
        {t("goals.editor.newObjective")}
      </Button>
    );
  }

  if (refusal) {
    return (
      <RestrictedWriting refusal={refusal} onClose={() => setOpen(false)} />
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 items-center gap-2">
        {kinds.length > 1 ? (
          <select
            aria-label={t("okrKind.label")}
            value={kind}
            disabled={pending}
            onChange={(event) => setKind(event.target.value as OkrKind)}
            className="h-7.5 rounded-control border border-line bg-surface px-1.5 text-xs text-ink outline-none focus:border-brand"
          >
            <option value="aspirational">{t("okrKind.aspirational")}</option>
            <option value="committed">{t("okrKind.committed")}</option>
          </select>
        ) : null}
        <input
          // Focused through a ref rather than `autoFocus`, which also steals
          // focus when a page loads with one of these already open.
          ref={(node) => node?.focus()}
          value={title}
          aria-label={t("goals.editor.newObjective")}
          placeholder={t("goals.editor.objectivePlaceholder")}
          disabled={pending}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              save();
            }
            if (event.key === "Escape") {
              setTitle("");
              setOpen(false);
            }
          }}
          className="h-7.5 w-64 min-w-0 rounded-control border border-line bg-surface px-2 text-xs text-ink outline-none focus:border-brand"
        />
        <Button
          type="button"
          variant="primary"
          disabled={pending || title.trim() === ""}
          onClick={save}
        >
          {t("common.save")}
        </Button>
        <Button
          type="button"
          disabled={pending}
          onClick={() => {
            setTitle("");
            setOpen(false);
          }}
        >
          {t("common.cancel")}
        </Button>
      </div>
      {problem ? (
        <span role="alert" className="text-xs text-bad">
          {problem}
        </span>
      ) : null}
    </div>
  );
}
