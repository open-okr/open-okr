"use client";

/**
 * A model's answer, with the little formatting models write (plan 0.8.1 CP4,
 * screen S-39).
 *
 * The copilot showed its answers as plain text, and the models it runs on
 * write `**bold**` and `- ` lists, so asterisks and dashes showed (review F8).
 * This draws a small subset and nothing more: paragraphs, line breaks, bold,
 * italics, inline code, bullet and numbered lists, and fenced code blocks
 * with a Copy button.
 *
 * **React elements only, never an HTML string.** Every character of the
 * answer reaches the page as a text node, so `<script>` in an answer is the
 * word "<script>" and nothing else. There is no `dangerouslySetInnerHTML`
 * here and there must never be one.
 *
 * **No link from the model's text.** A passage the model read can carry a
 * link somebody planted, and a model can invent one, so `[click](...)` and
 * `https://...` stay text as typed. The answer's sources are linked by the
 * panel from what retrieval found, not from what the model wrote.
 *
 * **Half-written markers show as typed.** While an answer arrives, `**on tr`
 * is not yet bold; it is the characters so far, and it turns bold when the
 * closing marker arrives. A fence is the one exception: an opened code block
 * is drawn as one at once, because its lines are code from the first.
 *
 * Not the rich-text module in `packages/core`: that is the editor's stored
 * JSON, and an answer is a text column that is never stored as rich text.
 */
import type { ReactNode } from "react";
import { useTranslations } from "../i18n/use-translations.tsx";
import { cn } from "../lib/cn.ts";
import { CopyButton } from "./copy-button.tsx";

/** A run of text with its emphasis. */
export type Inline =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "strong"; readonly children: readonly Inline[] }
  | { readonly kind: "em"; readonly children: readonly Inline[] }
  | { readonly kind: "code"; readonly text: string };

/** One block of the answer. */
export type Block =
  | {
      readonly kind: "paragraph";
      /** Each line, kept as a line, because a model breaks lines on purpose. */
      readonly lines: readonly (readonly Inline[])[];
    }
  | {
      readonly kind: "list";
      readonly ordered: boolean;
      /** The first number of a numbered list, as written. */
      readonly start: number;
      readonly items: readonly (readonly (readonly Inline[])[])[];
    }
  | {
      readonly kind: "code";
      readonly language: string | null;
      readonly text: string;
      /** False while the closing fence has not arrived. */
      readonly closed: boolean;
    };

const FENCE = /^\s{0,3}```\s*([\w+#.-]*)\s*$/;
const BULLET = /^\s{0,3}[-*+]\s+(.*)$/;
const NUMBERED = /^\s{0,3}(\d{1,9})[.)]\s+(.*)$/;
/** A line indented under a list item, which continues it. */
const CONTINUATION = /^\s{2,}\S/;

/** Whether `char` is a letter or a digit, for the rule that `_` inside a word is not emphasis. */
const wordChar = (char: string | undefined): boolean =>
  char !== undefined && /[\p{L}\p{N}]/u.test(char);

/**
 * The emphasis in one line, read left to right.
 *
 * A marker is only a marker when it closes: an opener with no closer is the
 * character itself. Every search starts after the opener, so a long run of
 * unmatched markers costs a scan each, never a backtracking regex.
 */
export function parseInline(line: string): Inline[] {
  const out: Inline[] = [];
  let text = "";
  const flush = () => {
    if (text !== "") {
      out.push({ kind: "text", text });
      text = "";
    }
  };

  let i = 0;
  while (i < line.length) {
    const char = line[i] as string;

    // A backslash keeps the next marker as a character.
    if (
      char === "\\" &&
      i + 1 < line.length &&
      "*_`\\".includes(line[i + 1] as string)
    ) {
      text += line[i + 1];
      i += 2;
      continue;
    }

    if (char === "`") {
      const close = line.indexOf("`", i + 1);
      if (close > i + 1) {
        flush();
        out.push({ kind: "code", text: line.slice(i + 1, close) });
        i = close + 1;
        continue;
      }
      text += char;
      i += 1;
      continue;
    }

    if ((char === "*" || char === "_") && line[i + 1] === char) {
      const marker = char + char;
      const close = line.indexOf(marker, i + 2);
      const inner = close === -1 ? "" : line.slice(i + 2, close);
      if (
        close !== -1 &&
        inner.trim() !== "" &&
        !/^\s/.test(inner) &&
        !/\s$/.test(inner)
      ) {
        flush();
        out.push({ kind: "strong", children: parseInline(inner) });
        i = close + 2;
        continue;
      }
      text += marker;
      i += 2;
      continue;
    }

    if (char === "*" || char === "_") {
      const next = line[i + 1];
      // `snake_case` and `2*3*4` are not emphasis.
      const opens =
        next !== undefined &&
        !/\s/.test(next) &&
        !(char === "_" && wordChar(line[i - 1]));
      if (opens) {
        let close = line.indexOf(char, i + 1);
        while (
          close !== -1 &&
          (/\s/.test(line[close - 1] as string) ||
            line[close + 1] === char ||
            (char === "_" && wordChar(line[close + 1])))
        ) {
          close = line.indexOf(
            char,
            close + (line[close + 1] === char ? 2 : 1),
          );
        }
        if (close > i + 1) {
          flush();
          out.push({
            kind: "em",
            children: parseInline(line.slice(i + 1, close)),
          });
          i = close + 1;
          continue;
        }
      }
      text += char;
      i += 1;
      continue;
    }

    text += char;
    i += 1;
  }
  flush();
  return out;
}

/** The answer as blocks. Pure, so every rule is tested without a browser. */
export function parseAnswer(answer: string): Block[] {
  const lines = answer.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: Inline[][] = [];
  let list: {
    ordered: boolean;
    start: number;
    items: Inline[][][];
  } | null = null;

  const endParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ kind: "paragraph", lines: paragraph });
      paragraph = [];
    }
  };
  const endList = () => {
    if (list) {
      blocks.push({ kind: "list", ...list });
      list = null;
    }
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] as string;

    const fence = FENCE.exec(line);
    if (fence) {
      endParagraph();
      endList();
      const body: string[] = [];
      let closed = false;
      for (index += 1; index < lines.length; index += 1) {
        const inner = lines[index] as string;
        if (/^\s{0,3}```\s*$/.test(inner)) {
          closed = true;
          break;
        }
        body.push(inner);
      }
      blocks.push({
        kind: "code",
        language: fence[1] ? fence[1] : null,
        text: body.join("\n"),
        closed,
      });
      continue;
    }

    if (line.trim() === "") {
      endParagraph();
      // A blank line between two items of one list keeps the list going.
      const after = lines.slice(index + 1).find((next) => next.trim() !== "");
      const current = list as { ordered: boolean } | null;
      if (
        current &&
        after !== undefined &&
        (current.ordered ? NUMBERED.test(after) : BULLET.test(after))
      ) {
        continue;
      }
      endList();
      continue;
    }

    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    if (bullet || numbered) {
      endParagraph();
      const ordered = numbered !== null;
      const current = list as { ordered: boolean } | null;
      if (current && current.ordered !== ordered) {
        endList();
      }
      if (!list) {
        list = {
          ordered,
          start: numbered ? Number(numbered[1]) : 1,
          items: [],
        };
      }
      (list as { items: Inline[][][] }).items.push([
        parseInline((bullet ? bullet[1] : numbered?.[2]) ?? ""),
      ]);
      continue;
    }

    const open = list as { items: Inline[][][] } | null;
    if (open && CONTINUATION.test(line)) {
      open.items.at(-1)?.push(parseInline(line.trim()));
      continue;
    }

    endList();
    paragraph.push(parseInline(line));
  }
  endParagraph();
  endList();
  return blocks;
}

function Inlines({ parts }: { readonly parts: readonly Inline[] }) {
  return (
    <>
      {parts.map((part, index) => {
        switch (part.kind) {
          case "text":
            // biome-ignore lint/suspicious/noArrayIndexKey: parts never move; the index is their place in the line.
            return <span key={index}>{part.text}</span>;
          case "strong":
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: as above.
              <strong key={index} className="font-semibold">
                <Inlines parts={part.children} />
              </strong>
            );
          case "em":
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: as above.
              <em key={index}>
                <Inlines parts={part.children} />
              </em>
            );
          default:
            // The last kind, `code`: a default so every path returns.
            return (
              <code
                // biome-ignore lint/suspicious/noArrayIndexKey: as above.
                key={index}
                className="rounded-sm bg-raised px-1 py-px font-mono text-[0.9em]"
              >
                {part.text}
              </code>
            );
        }
      })}
    </>
  );
}

/** Lines of one paragraph or list item, broken where the model broke them. */
function Lines({
  lines,
  trailing,
}: {
  readonly lines: readonly (readonly Inline[])[];
  /** Drawn after the last line, inside it. */
  readonly trailing?: ReactNode;
}) {
  const out: ReactNode[] = [];
  lines.forEach((line, index) => {
    if (index > 0) {
      // biome-ignore lint/suspicious/noArrayIndexKey: lines never move.
      out.push(<br key={`break-${index}`} />);
    }
    // biome-ignore lint/suspicious/noArrayIndexKey: as above.
    out.push(<Inlines key={`line-${index}`} parts={line} />);
  });
  return (
    <>
      {out}
      {trailing}
    </>
  );
}

/**
 * An answer, drawn. Long words and code wrap or scroll inside the answer's
 * own width rather than widening the panel.
 */
export function AnswerText({
  text,
  className,
  trailing,
}: {
  readonly text: string;
  readonly className?: string;
  /**
   * Drawn at the very end of the text, inside its last line: the caret of an
   * answer still arriving (plan 0.8.1 CP9). After a block of its own would
   * put it on a line of its own, which reads as a cursor waiting for input.
   */
  readonly trailing?: ReactNode;
}) {
  const { t } = useTranslations();
  const blocks = parseAnswer(text);
  const lastBlock = blocks.length - 1;
  return (
    <div className={cn("flex flex-col gap-2 break-words", className)}>
      {blocks.map((block, index) => {
        const end = index === lastBlock ? trailing : undefined;
        switch (block.kind) {
          case "paragraph":
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: blocks only grow at the end while an answer arrives.
              <p key={index}>
                <Lines lines={block.lines} trailing={end} />
              </p>
            );
          case "list": {
            const items = block.items.map((item, itemIndex) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: as above.
              <li key={itemIndex} className="pl-0.5">
                <Lines
                  lines={item}
                  trailing={
                    itemIndex === block.items.length - 1 ? end : undefined
                  }
                />
              </li>
            ));
            return block.ordered ? (
              <ol
                // biome-ignore lint/suspicious/noArrayIndexKey: as above.
                key={index}
                start={block.start}
                className="flex list-decimal flex-col gap-1 pl-5"
              >
                {items}
              </ol>
            ) : (
              // biome-ignore lint/suspicious/noArrayIndexKey: as above.
              <ul key={index} className="flex list-disc flex-col gap-1 pl-5">
                {items}
              </ul>
            );
          }
          default:
            // The last kind, a code block: a default so every path returns.
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: as above.
              <div key={index} className="flex flex-col gap-1">
                <pre className="overflow-x-auto rounded-md border border-line bg-raised px-3 py-2 font-mono text-xs leading-relaxed">
                  <code>{block.text}</code>
                  {end}
                </pre>
                {/* Only once it is whole: half a block copied is a bug
                    pasted somewhere else. */}
                {block.closed ? (
                  <CopyButton text={block.text} variant="ghost" size="sm">
                    {t("copy.code")}
                  </CopyButton>
                ) : null}
              </div>
            );
        }
      })}
    </div>
  );
}
