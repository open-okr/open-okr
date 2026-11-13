"use client";

/**
 * The thumbs under a recorded answer (plan 0.9.0 FB1, screen S-39,
 * docs/design/copilot-feedback.md section 4).
 *
 * Pressing a thumb rates the answer, pressing the pressed one takes the rating
 * back, and pressing the other one replaces it (FB-D1). After a thumbs-down a
 * one-line form asks what went wrong. The note is optional and sharing the
 * conversation with AI administrators is unticked by default (FB-D2): the
 * rating is saved the moment the thumb is pressed, so Skip and Escape only
 * close the form.
 *
 * The parent draws this only for a recorded answer while the copilot can
 * answer at all (FB-D8), so nothing here knows about AI being off.
 */
import {
  Button,
  Spinner,
  TextInput,
  Tooltip,
  useTranslations,
} from "@openokr/ui";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { useState } from "react";
import { rateCopilotAnswerAction, unrateCopilotAnswerAction } from "./actions";

/** The reader's own rating of one answer, as `copilot.thread` returns it. */
export interface MyRating {
  readonly rating: "up" | "down";
  readonly note: string | null;
  readonly shared: boolean;
}

/** The longest note, which is the action's own limit. */
const NOTE_MAX = 500;

export function AnswerRating({
  messageId,
  initial,
}: {
  readonly messageId: string;
  readonly initial: MyRating | null;
}) {
  const { t } = useTranslations();
  const [current, setCurrent] = useState<"up" | "down" | null>(
    initial?.rating ?? null,
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [askingNote, setAskingNote] = useState(false);
  const [note, setNote] = useState("");
  const [shared, setShared] = useState(false);

  /** Runs one write and says its refusal here, where the press was. */
  const run = async (
    write: () => Promise<{ readonly error: string | null }>,
    onDone: () => void,
  ) => {
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      const outcome = await write();
      if (outcome.error) {
        setError(outcome.error);
      } else {
        onDone();
      }
    } catch {
      setError(t("copilot.copilotPanel.rating.couldNotSave"));
    } finally {
      setPending(false);
    }
  };

  const press = (value: "up" | "down") => {
    if (pending) {
      return;
    }
    if (current === value) {
      void run(
        () => unrateCopilotAnswerAction(messageId),
        () => {
          setCurrent(null);
          setAskingNote(false);
          setNote("");
          setShared(false);
        },
      );
      return;
    }
    void run(
      () => rateCopilotAnswerAction({ messageId, rating: value }),
      () => {
        setCurrent(value);
        // A new value starts without the last one's words and share.
        setNote("");
        setShared(false);
        setAskingNote(value === "down");
        setSaved(value === "up");
      },
    );
  };

  const send = () => {
    if (pending) {
      return;
    }
    void run(
      () =>
        rateCopilotAnswerAction({
          messageId,
          rating: "down",
          note: note.trim(),
          shared,
        }),
      () => {
        setAskingNote(false);
        setSaved(true);
      },
    );
  };

  // A fragment, so the form and a refusal can take a row of their own in the
  // action row the parent wraps, with the thumbs beside Copy and Retry.
  return (
    <>
      <fieldset
        aria-label={t("copilot.copilotPanel.rating.group")}
        className="m-0 flex min-w-0 items-center gap-1 border-0 p-0"
      >
        <Tooltip label={t("copilot.copilotPanel.rating.good")}>
          <Button
            variant="ghost"
            size="sm"
            aria-label={t("copilot.copilotPanel.rating.good")}
            aria-pressed={current === "up"}
            pending={pending}
            onClick={() => press("up")}
            className="px-1.5 text-ink-3"
          >
            <ThumbsUp
              className="size-3.5"
              fill={current === "up" ? "currentColor" : "none"}
              aria-hidden="true"
            />
          </Button>
        </Tooltip>
        <Tooltip label={t("copilot.copilotPanel.rating.poor")}>
          <Button
            variant="ghost"
            size="sm"
            aria-label={t("copilot.copilotPanel.rating.poor")}
            aria-pressed={current === "down"}
            pending={pending}
            onClick={() => press("down")}
            className="px-1.5 text-ink-3"
          >
            <ThumbsDown
              className="size-3.5"
              fill={current === "down" ? "currentColor" : "none"}
              aria-hidden="true"
            />
          </Button>
        </Tooltip>
        {pending ? <Spinner /> : null}
        <span role="status" className="text-xs text-ink-3">
          {saved && !pending ? t("copilot.copilotPanel.rating.saved") : ""}
        </span>
      </fieldset>
      {askingNote ? (
        <form
          data-testid="copilot-rating-note"
          className="flex max-w-[68ch] basis-full flex-col gap-1.5 rounded-md bg-raised px-3 py-2"
          onSubmit={(event) => {
            event.preventDefault();
            send();
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              setAskingNote(false);
            }
          }}
        >
          <TextInput
            label={t("copilot.copilotPanel.rating.noteLabel")}
            name="note"
            value={note}
            maxLength={NOTE_MAX}
            autoFocus
            onChange={(event) => setNote(event.target.value)}
          />
          <label className="flex items-start gap-2 text-xs text-ink-2">
            <input
              type="checkbox"
              name="shared"
              checked={shared}
              onChange={(event) => setShared(event.target.checked)}
              className="mt-0.5 size-3.5 rounded border-line"
            />
            <span className="flex flex-col">
              <span>{t("copilot.copilotPanel.rating.shareLabel")}</span>
              <span className="text-ink-3">
                {t("copilot.copilotPanel.rating.shareHint")}
              </span>
            </span>
          </label>
          <div className="flex items-center gap-1">
            <Button type="submit" variant="primary" size="sm" pending={pending}>
              {t("copilot.copilotPanel.rating.send")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setAskingNote(false)}
            >
              {t("copilot.copilotPanel.rating.skip")}
            </Button>
          </div>
        </form>
      ) : null}
      {error ? (
        <p role="alert" className="basis-full text-xs font-medium text-bad">
          {error}
        </p>
      ) : null}
    </>
  );
}
