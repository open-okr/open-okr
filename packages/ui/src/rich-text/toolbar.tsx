"use client";

import { Toolbar } from "@base-ui-components/react/toolbar";
import { type Editor, useEditorState } from "@tiptap/react";
import {
  Bold,
  Code,
  Italic,
  Link,
  List,
  ListOrdered,
  Strikethrough,
} from "lucide-react";
import { type KeyboardEvent, type ReactNode, useState } from "react";
import { TextInput } from "../fields/text-input.tsx";
import { useTranslations } from "../i18n/use-translations.tsx";
import { cn } from "../lib/cn.ts";

/** What a link may point at. The same rule the editor's link mark holds. */
export const LINK_HREF = /^(https?:|mailto:)/;

interface Format {
  readonly key: string;
  readonly icon: ReactNode;
  readonly active: (editor: Editor) => boolean;
  readonly toggle: (editor: Editor) => void;
  readonly shortcut: string;
}

const FORMATS: readonly Format[] = [
  {
    key: "bold",
    icon: <Bold className="size-4" aria-hidden="true" />,
    active: (editor) => editor.isActive("bold"),
    toggle: (editor) => editor.chain().focus().toggleBold().run(),
    shortcut: "Control+B Meta+B",
  },
  {
    key: "italic",
    icon: <Italic className="size-4" aria-hidden="true" />,
    active: (editor) => editor.isActive("italic"),
    toggle: (editor) => editor.chain().focus().toggleItalic().run(),
    shortcut: "Control+I Meta+I",
  },
  {
    key: "strike",
    icon: <Strikethrough className="size-4" aria-hidden="true" />,
    active: (editor) => editor.isActive("strike"),
    toggle: (editor) => editor.chain().focus().toggleStrike().run(),
    shortcut: "Control+Shift+S Meta+Shift+S",
  },
  {
    key: "code",
    icon: <Code className="size-4" aria-hidden="true" />,
    active: (editor) => editor.isActive("code"),
    toggle: (editor) => editor.chain().focus().toggleCode().run(),
    shortcut: "Control+E Meta+E",
  },
  {
    key: "bulletList",
    icon: <List className="size-4" aria-hidden="true" />,
    active: (editor) => editor.isActive("bulletList"),
    toggle: (editor) => editor.chain().focus().toggleBulletList().run(),
    shortcut: "Control+Shift+8 Meta+Shift+8",
  },
  {
    key: "orderedList",
    icon: <ListOrdered className="size-4" aria-hidden="true" />,
    active: (editor) => editor.isActive("orderedList"),
    toggle: (editor) => editor.chain().focus().toggleOrderedList().run(),
    shortcut: "Control+Shift+7 Meta+Shift+7",
  },
];

const BUTTON_CLASS =
  "flex size-7 items-center justify-center rounded-control text-ink-3 outline-none hover:bg-raised hover:text-ink focus-visible:ring-2 focus-visible:ring-brand-line aria-pressed:bg-brand-weak aria-pressed:text-brand-text";

/**
 * The compact editor's formatting toolbar (docs/design/guided-inputs.md §4.7).
 *
 * Base UI `Toolbar`: one Tab stop for the whole row, the arrow keys between
 * its buttons, and `aria-pressed` on each, so a screen reader hears whether
 * bold is on as well as that it is there. The shortcuts the editor already
 * had are named on each button. A link asks for its address beside the row
 * rather than in a dialog, and refuses one that is not a web or mail link,
 * which the stored format would refuse too.
 */
export function EditorToolbar({ editor }: { readonly editor: Editor }) {
  const { t } = useTranslations();
  // One literal call per key, so the catalogue's own check can see each is
  // used.
  const labels: Record<string, string> = {
    bold: t("editor.toolbar.bold"),
    italic: t("editor.toolbar.italic"),
    strike: t("editor.toolbar.strike"),
    code: t("editor.toolbar.code"),
    bulletList: t("editor.toolbar.bulletList"),
    orderedList: t("editor.toolbar.orderedList"),
  };
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      active: FORMATS.map((format) => format.active(current)),
      link: current.isActive("link"),
      href: String(current.getAttributes("link").href ?? ""),
    }),
  });
  const [asking, setAsking] = useState(false);
  const [href, setHref] = useState("");

  const applyLink = () => {
    const address = href.trim();
    if (!LINK_HREF.test(address)) {
      return;
    }
    editor
      .chain()
      .focus()
      .extendMarkRange("link")
      .setLink({ href: address })
      .run();
    setAsking(false);
  };

  const removeLink = () => {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    setAsking(false);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <Toolbar.Root
        aria-label={t("editor.toolbar.label")}
        className="flex flex-wrap items-center gap-0.5 border-line border-b pb-1"
      >
        {FORMATS.map((format, index) => (
          <Toolbar.Button
            key={format.key}
            type="button"
            aria-label={labels[format.key]}
            aria-pressed={state.active[index] ?? false}
            aria-keyshortcuts={format.shortcut}
            title={labels[format.key]}
            onClick={() => format.toggle(editor)}
            className={BUTTON_CLASS}
          >
            {format.icon}
          </Toolbar.Button>
        ))}
        <Toolbar.Separator className="mx-1 h-4 w-px bg-line" />
        <Toolbar.Button
          type="button"
          aria-label={t("editor.toolbar.link")}
          aria-pressed={state.link}
          aria-expanded={asking}
          title={t("editor.toolbar.link")}
          onClick={() => {
            setHref(state.href);
            setAsking((open) => !open);
          }}
          className={BUTTON_CLASS}
        >
          <Link className="size-4" aria-hidden="true" />
        </Toolbar.Button>
      </Toolbar.Root>
      {asking ? (
        <div className="flex flex-wrap items-end gap-2">
          <TextInput
            label={t("editor.link.address")}
            value={href}
            placeholder="https://"
            className="min-w-56 flex-1"
            autoFocus
            check={(value) =>
              value.trim() === "" || LINK_HREF.test(value.trim())
                ? null
                : t("editor.link.invalid")
            }
            onChange={(event) => setHref(event.target.value)}
            onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
              // The editor often sits in a form; Enter here adds the link
              // rather than submitting what the form is for.
              if (event.key === "Enter") {
                event.preventDefault();
                applyLink();
              }
            }}
          />
          <button
            type="button"
            onClick={applyLink}
            className={cn(
              "h-7.5 rounded-control border border-line-2 px-2.5 text-xs font-semibold text-ink-2 hover:border-ink-4",
            )}
          >
            {t("editor.link.apply")}
          </button>
          {state.link ? (
            <button
              type="button"
              onClick={removeLink}
              className="h-7.5 px-1.5 text-xs font-medium text-ink-3 hover:text-ink"
            >
              {t("editor.link.remove")}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
