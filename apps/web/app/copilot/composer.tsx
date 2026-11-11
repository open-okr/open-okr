"use client";

/**
 * The copilot's composer (plan 0.8.1 CP6, screen S-39).
 *
 * One rounded box holding the question and the button, the way current chat
 * products draw it: a row at rest, growing with what is typed to 40% of the
 * panel's height, then scrolling inside. The field is the kit's `TextArea`
 * with its border taken off, because the box around it is the border, so the
 * field rule holds (no raw `<textarea>` in a screen file).
 *
 * **Typing is allowed while an answer arrives; sending is not.** The box was
 * disabled for the whole answer, which threw focus to the page after every
 * question and kept the next one from being written while the first was read
 * (review F4, F17). The button is Send, or Stop in the same place while an
 * answer can be stopped.
 *
 * **Enter sends unless an input method is composing.** A Japanese, Chinese or
 * Korean writer confirms a word with Enter, and that Enter is not a send.
 */
import { Button, TextArea, useTranslations } from "@openokr/ui";
import { ArrowUp, Square } from "lucide-react";
import type { RefObject } from "react";

export function Composer({
  value,
  onChange,
  onSend,
  onStop,
  answering,
  canStop,
  placeholder,
  error,
  inputRef,
  composing,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onSend: () => void;
  readonly onStop: () => void;
  /** An answer is arriving, so a second question waits. */
  readonly answering: boolean;
  /** The answer arriving can be stopped from here. */
  readonly canStop: boolean;
  readonly placeholder: string;
  /** Why the last send was refused, under the box. */
  readonly error: string | null;
  readonly inputRef: RefObject<HTMLTextAreaElement | null>;
  /** True while an input method is composing in the box. */
  readonly composing: RefObject<boolean>;
}) {
  const { t } = useTranslations();
  const empty = value.trim() === "";

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-end gap-1.5 rounded-xl border border-line-2 bg-surface py-1 pr-1 pl-1 focus-within:border-brand focus-within:ring-2 focus-within:ring-brand-line">
        <TextArea
          label={t("copilot.copilotPanel.yourQuestion")}
          hideLabel
          ref={inputRef}
          rows={1}
          value={value}
          error={error}
          onChange={(event) => onChange(event.target.value)}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey) {
              return;
            }
            // `isComposing` on the event, the flag, and the 229 some browsers
            // still report for a key an input method took.
            if (
              event.nativeEvent.isComposing ||
              composing.current ||
              event.keyCode === 229
            ) {
              return;
            }
            event.preventDefault();
            if (!answering) {
              onSend();
            }
          }}
          placeholder={placeholder}
          maxLength={4000}
          className="min-w-0 flex-1"
          // The box around it is the border and the focus ring. Grows with
          // the text to 40% of the panel, then scrolls inside.
          inputClassName="min-h-0 max-h-[40dvh] resize-none overflow-y-auto border-0 bg-transparent px-2 py-1.5 shadow-none focus:ring-0 placeholder:text-ink-4"
        />
        {canStop ? (
          <Button
            variant="default"
            onClick={onStop}
            aria-label={t("copilot.copilotPanel.stopTheAnswer")}
            className="size-8 flex-none rounded-full px-0"
          >
            <Square className="size-3.5 fill-current" aria-hidden="true" />
          </Button>
        ) : (
          <Button
            variant="primary"
            onClick={onSend}
            disabled={answering || empty}
            aria-label={t("copilot.copilotPanel.sendTheQuestion")}
            className="size-8 flex-none rounded-full px-0"
          >
            <ArrowUp className="size-4" aria-hidden="true" />
          </Button>
        )}
      </div>
    </div>
  );
}
