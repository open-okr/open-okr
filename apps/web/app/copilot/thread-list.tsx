"use client";

/**
 * History: the member's conversations, grouped by when each was last used
 * (plan 0.8.1 CP2, screen S-39).
 *
 * The list used to show only while a conversation was empty, so once one was
 * open there was no way back to it and no way to start another without a
 * reload (review F2). It is a view inside the panel now, reached from the
 * header, with the open one marked.
 *
 * **Deleting asks first, in the row.** UIUX-PLAN §4 gives a reversible delete
 * an undo toast and keeps a confirmation for what cannot be undone. Nothing
 * restores a copilot conversation, so for the person deleting it this cannot
 * be undone, and the row asks once before it goes. In the row rather than in a
 * dialog, because §1 puts inline before modal.
 */
import { Button, useTranslations } from "@openokr/ui";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { groupThreads, type ThreadBucket } from "./thread-buckets";

export interface ThreadSummary {
  readonly id: string;
  readonly title: string | null;
  readonly updatedAt: string;
}

/** Each group's heading, spelled out so the catalogue check finds every key. */
const BUCKET_KEYS: Readonly<Record<ThreadBucket, string>> = {
  today: "copilot.copilotPanel.history.today",
  yesterday: "copilot.copilotPanel.history.yesterday",
  thisWeek: "copilot.copilotPanel.history.thisWeek",
  earlier: "copilot.copilotPanel.history.earlier",
};

export function ThreadList({
  threads,
  openId,
  loading,
  onOpen,
  onDelete,
}: {
  /** Null while the list is being read. */
  readonly threads: readonly ThreadSummary[] | null;
  readonly openId: string | null;
  readonly loading: boolean;
  readonly onOpen: (id: string) => void;
  /** Resolves with an error sentence, or null once it is gone. */
  readonly onDelete: (id: string) => Promise<string | null>;
}) {
  const { t } = useTranslations();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [refused, setRefused] = useState<{
    readonly id: string;
    readonly message: string;
  } | null>(null);

  if (threads === null) {
    return (
      <p role="status" className="text-sm text-ink-3">
        {loading
          ? t("copilot.copilotPanel.history.loading")
          : t("copilot.copilotPanel.history.couldNotLoad")}
      </p>
    );
  }
  if (threads.length === 0) {
    return (
      <p className="text-sm text-ink-3">
        {t("copilot.copilotPanel.history.empty")}
      </p>
    );
  }

  const remove = async (id: string) => {
    setDeleting(id);
    setRefused(null);
    const error = await onDelete(id);
    setDeleting(null);
    setConfirming(null);
    if (error) {
      setRefused({ id, message: error });
    }
  };

  return (
    <nav
      aria-label={t("copilot.copilotPanel.history.title")}
      className="flex flex-col gap-4"
    >
      {groupThreads(threads, new Date()).map((group) => (
        <section key={group.bucket} className="flex flex-col gap-1">
          <h3 className="text-xs font-semibold text-ink-4">
            {t(BUCKET_KEYS[group.bucket])}
          </h3>
          <ul className="flex flex-col">
            {group.threads.map((thread) => {
              const title = thread.title ?? t("copilot.copilotPanel.untitled");
              const current = thread.id === openId;
              return (
                <li key={thread.id} className="flex flex-col">
                  {confirming === thread.id ? (
                    <div className="flex flex-wrap items-center gap-2 rounded-control bg-raised px-2 py-1.5">
                      <p className="min-w-0 flex-1 text-sm text-ink-2">
                        {t("copilot.copilotPanel.history.confirmDelete", {
                          title,
                        })}
                      </p>
                      <Button
                        variant="primary"
                        size="sm"
                        pending={deleting === thread.id}
                        onClick={() => void remove(thread.id)}
                      >
                        {t("copilot.copilotPanel.history.delete")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={deleting === thread.id}
                        onClick={() => setConfirming(null)}
                      >
                        {t("copilot.copilotPanel.history.keep")}
                      </Button>
                    </div>
                  ) : (
                    <div className="group flex items-center gap-1">
                      <button
                        type="button"
                        aria-current={current ? "true" : undefined}
                        onClick={() => onOpen(thread.id)}
                        className={`min-w-0 flex-1 truncate rounded-control px-2 py-1.5 text-left text-sm hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-strong ${
                          current
                            ? "bg-raised font-semibold text-ink"
                            : "text-ink-2"
                        }`}
                      >
                        {title}
                      </button>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={t(
                          "copilot.copilotPanel.history.deleteNamed",
                          { title },
                        )}
                        onClick={() => setConfirming(thread.id)}
                        className="flex-none px-1.5 text-ink-4"
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                      </Button>
                    </div>
                  )}
                  {refused?.id === thread.id ? (
                    <p role="alert" className="px-2 text-xs text-bad">
                      {refused.message}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </nav>
  );
}
