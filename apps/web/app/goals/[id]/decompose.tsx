"use client";

/**
 * Drafting the work behind one key result (AI-NATIVE-PLAN §2.4, completeness
 * review M-09).
 *
 * "Decompose a key result into initiatives and tasks" was in REQUIREMENTS'
 * list of assists and in §2.4, and P4-T15 handed it to Phase 5, which never
 * took it. Its manual path is creating the work by hand on the initiatives
 * screen, which is unchanged.
 *
 * **Nothing is created until the person presses Create**, and what is created
 * is what they left ticked, in the words they left in the fields. The draft is
 * a list of editable rows, not a preview of a write the model already decided:
 * UIUX-PLAN §3's "never auto-committed", made literal. The space defaults to
 * the objective's own and can be changed, because an initiative lives in a
 * space and which one is the person's call.
 *
 * Each description is the compact editor (docs/design/guided-inputs.md §4.7),
 * holding the draft as a document, with the 1000-character cap its textarea
 * had counted as the server counts it.
 */
import { richTextLength } from "@openokr/formats";
import { Button, Chip, RichTextEditor, useTranslations } from "@openokr/ui";
import { Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  createDecomposedWorkAction,
  decomposeKeyResultAction,
} from "./assist-actions.ts";
import { DESCRIPTION_MAX_CHARACTERS } from "./decompose-limits.ts";

interface DraftTask {
  readonly title: string;
  readonly keep: boolean;
}

interface DraftRow {
  readonly title: string;
  /** The editor's document. */
  readonly description: unknown;
  readonly keep: boolean;
  readonly tasks: readonly DraftTask[];
}

export function DecomposeKeyResult({
  goalId,
  keyResultId,
  keyResultTitle,
  spaces,
  defaultSpaceId,
}: {
  readonly goalId: string;
  readonly keyResultId: string;
  readonly keyResultTitle: string;
  /** Where the work could live. The reader's own spaces. */
  readonly spaces: readonly { readonly id: string; readonly name: string }[];
  /** The objective's own space, when it has one. */
  readonly defaultSpaceId: string | null;
}) {
  const { t } = useTranslations();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [rows, setRows] = useState<readonly DraftRow[] | null>(null);
  const [spaceId, setSpaceId] = useState(defaultSpaceId ?? spaces[0]?.id ?? "");
  const [notice, setNotice] = useState<string | null>(null);
  const [refused, setRefused] = useState<readonly string[]>([]);

  const change = (index: number, next: Partial<DraftRow>) =>
    setRows((current) =>
      current === null
        ? current
        : current.map((row, at) => (at === index ? { ...row, ...next } : row)),
    );
  const changeTask = (index: number, task: number, next: Partial<DraftTask>) =>
    setRows((current) =>
      current === null
        ? current
        : current.map((row, at) =>
            at === index
              ? {
                  ...row,
                  tasks: row.tasks.map((one, which) =>
                    which === task ? { ...one, ...next } : one,
                  ),
                }
              : row,
          ),
    );

  if (spaces.length === 0) {
    // Work lives in a space, and this reader has none to put it in. The
    // affordance would only ever end in a refusal.
    return null;
  }

  if (rows === null) {
    return (
      <div className="flex flex-col gap-1" data-testid="decompose">
        <Button
          type="button"
          variant="ai"
          size="sm"
          className="self-start"
          disabled={pending}
          aria-label={t("goals.detail.decompose.draftTheWorkFor", {
            title: keyResultTitle,
          })}
          onClick={() => {
            setNotice(null);
            setRefused([]);
            start(async () => {
              try {
                const drafted = await decomposeKeyResultAction(
                  goalId,
                  keyResultId,
                );
                if (!drafted) {
                  setNotice(t("assists.reading.nothingThisTime"));
                  return;
                }
                setRows(
                  drafted.initiatives.map((initiative) => ({
                    title: initiative.title,
                    description: initiative.description,
                    keep: true,
                    tasks: initiative.tasks.map((task) => ({
                      title: task,
                      keep: true,
                    })),
                  })),
                );
              } catch {
                setNotice(t("assists.reading.couldNotRun"));
              }
            });
          }}
        >
          <Sparkles className="size-3" />
          {pending
            ? t("assists.reading.working")
            : t("goals.detail.decompose.draftTheWork")}
        </Button>
        {notice ? (
          <p role="status" className="text-xs text-ink-4">
            {notice}
          </p>
        ) : null}
        {refused.length > 0 ? (
          <ul role="alert" className="flex flex-col gap-1 text-xs text-bad">
            {refused.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }

  const kept = rows.filter((row) => row.keep && row.title.trim() !== "");
  // The server refuses a description over the cap, so the button waits for
  // the counter that already says so.
  const overLimit = kept.some(
    (row) => richTextLength(row.description) > DESCRIPTION_MAX_CHARACTERS,
  );

  return (
    <section
      aria-label={t("goals.detail.decompose.draftTheWorkFor", {
        title: keyResultTitle,
      })}
      className="flex w-full flex-col gap-2.5 rounded-md border border-line bg-surface p-3"
      data-testid="decompose"
    >
      <span className="flex flex-wrap items-center gap-2">
        <Chip tone="agent">{t("common.ai")}</Chip>
        <span className="text-xs text-ink-4">
          {t("goals.detail.decompose.nothingIsCreatedYet")}
        </span>
      </span>
      <ul className="flex flex-col gap-2.5">
        {rows.map((row, index) => (
          <li
            // A draft row has no identity but its place in the list, and the
            // list never reorders while it is on screen.
            // biome-ignore lint/suspicious/noArrayIndexKey: see above
            key={index}
            className="flex flex-col gap-1.5 rounded-md border border-line p-2.5"
          >
            <label className="flex items-center gap-2 text-xs text-ink-3">
              <input
                type="checkbox"
                checked={row.keep}
                disabled={pending}
                onChange={(event) =>
                  change(index, { keep: event.target.checked })
                }
              />
              {t("goals.detail.decompose.createThisInitiative")}
            </label>
            <input
              aria-label={t("goals.detail.decompose.initiativeTitle")}
              value={row.title}
              maxLength={500}
              disabled={pending || !row.keep}
              onChange={(event) => change(index, { title: event.target.value })}
              className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
            />
            <div className="rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-ink-2">
              <RichTextEditor
                label={t("goals.detail.decompose.whatItChanges")}
                variant="compact"
                content={row.description}
                editable={!pending && row.keep}
                maxCharacters={DESCRIPTION_MAX_CHARACTERS}
                onUpdate={(json) => change(index, { description: json })}
              />
            </div>
            {row.tasks.length > 0 ? (
              <fieldset className="flex flex-col gap-1 pl-3">
                <legend className="text-xs font-medium text-ink-3">
                  {t("goals.detail.decompose.firstTasks")}
                </legend>
                {row.tasks.map((task, which) => (
                  <span
                    // biome-ignore lint/suspicious/noArrayIndexKey: as above
                    key={which}
                    className="flex items-center gap-2"
                  >
                    <input
                      type="checkbox"
                      aria-label={t("goals.detail.decompose.createThisTask")}
                      checked={task.keep}
                      disabled={pending || !row.keep}
                      onChange={(event) =>
                        changeTask(index, which, {
                          keep: event.target.checked,
                        })
                      }
                    />
                    <input
                      aria-label={t("goals.detail.decompose.taskTitle")}
                      value={task.title}
                      maxLength={500}
                      disabled={pending || !row.keep || !task.keep}
                      onChange={(event) =>
                        changeTask(index, which, { title: event.target.value })
                      }
                      className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink"
                    />
                  </span>
                ))}
              </fieldset>
            ) : null}
          </li>
        ))}
      </ul>
      <label className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
        {t("goals.detail.decompose.createThemIn")}
        <select
          value={spaceId}
          disabled={pending}
          onChange={(event) => setSpaceId(event.target.value)}
          className="rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink-2"
        >
          {spaces.map((space) => (
            <option key={space.id} value={space.id}>
              {space.name}
            </option>
          ))}
        </select>
      </label>
      <span className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="primary"
          size="sm"
          disabled={pending || kept.length === 0 || spaceId === "" || overLimit}
          onClick={() => {
            setNotice(null);
            start(async () => {
              try {
                const created = await createDecomposedWorkAction({
                  goalId,
                  keyResultId,
                  spaceId,
                  initiatives: kept.map((row) => ({
                    title: row.title,
                    description: row.description,
                    tasks: row.tasks
                      .filter((task) => task.keep)
                      .map((task) => task.title),
                  })),
                });
                setRefused(created.refused);
                setRows(null);
                setNotice(
                  t("goals.detail.decompose.created", {
                    initiatives:
                      created.initiatives === 1
                        ? t("common.count.initiativeOne", {
                            count: created.initiatives,
                          })
                        : t("common.count.initiativeOther", {
                            count: created.initiatives,
                          }),
                    tasks:
                      created.tasks === 1
                        ? t("common.count.taskOne", { count: created.tasks })
                        : t("common.count.taskOther", {
                            count: created.tasks,
                          }),
                  }),
                );
                router.refresh();
              } catch {
                setNotice(t("assists.reading.couldNotRun"));
              }
            });
          }}
        >
          {t("goals.detail.decompose.createWhatIsTicked")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => setRows(null)}
        >
          {t("common.dismiss")}
        </Button>
      </span>
      {notice ? (
        <p role="status" className="text-xs text-ink-4">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
