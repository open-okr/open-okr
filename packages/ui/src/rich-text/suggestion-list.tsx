"use client";

import type { Editor } from "@tiptap/react";
import { ReactRenderer } from "@tiptap/react";
import {
  forwardRef,
  type ReactNode,
  useEffect,
  useImperativeHandle,
  useState,
} from "react";
import { cn } from "../lib/cn.ts";

/**
 * The shared floating list every `@tiptap/suggestion` popup renders
 * through — `@` mentions, `#` entity links, and the `/` slash menu (§6,
 * §9). One component, one keyboard-navigation implementation, so the
 * three affordances behave identically rather than each reinventing
 * arrow-key handling slightly differently.
 */
export interface SuggestionItem {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly icon?: ReactNode;
}

interface SuggestionListHandle {
  onKeyDown(event: { readonly event: KeyboardEvent }): boolean;
}

interface SuggestionListProps {
  readonly items: readonly SuggestionItem[];
  readonly command: (item: SuggestionItem) => void;
}

const SuggestionList = forwardRef<SuggestionListHandle, SuggestionListProps>(
  ({ items, command }, ref) => {
    const [selected, setSelected] = useState(0);

    // biome-ignore lint/correctness/useExhaustiveDependencies: `items` drives when this resets (a new result set arrived), not something the body reads.
    useEffect(() => {
      setSelected(0);
    }, [items]);

    useImperativeHandle(ref, () => ({
      onKeyDown({ event }) {
        if (items.length === 0) {
          return false;
        }
        if (event.key === "ArrowDown") {
          setSelected((current) => (current + 1) % items.length);
          return true;
        }
        if (event.key === "ArrowUp") {
          setSelected((current) => (current + items.length - 1) % items.length);
          return true;
        }
        if (event.key === "Enter") {
          const item = items[selected];
          if (item) {
            command(item);
          }
          return true;
        }
        return false;
      },
    }));

    if (items.length === 0) {
      return (
        <div className="rounded-lg border border-line bg-surface p-2 text-sm text-ink-3 shadow-(--shadow-popover)">
          No matches.
        </div>
      );
    }

    return (
      <div className="max-h-60 w-64 overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-(--shadow-popover)">
        {items.map((item, index) => (
          <button
            key={item.id}
            type="button"
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink-2",
              index === selected
                ? "bg-brand-weak text-brand-text"
                : "hover:bg-raised",
            )}
            onMouseEnter={() => setSelected(index)}
            onClick={() => command(item)}
          >
            {item.icon ? <span className="flex-none">{item.icon}</span> : null}
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {item.description ? (
              <span className="flex-none truncate text-xs text-ink-4">
                {item.description}
              </span>
            ) : null}
          </button>
        ))}
      </div>
    );
  },
);
SuggestionList.displayName = "SuggestionList";

/**
 * Wraps `SuggestionList` into the `{onStart, onUpdate, onKeyDown, onExit}`
 * shape `@tiptap/suggestion`'s own `render()` option expects — an
 * imperative `ReactRenderer`, not a normal React render, because the
 * popup mounts and positions itself outside this component tree
 * entirely, driven by ProseMirror's own plugin state.
 */
export function createSuggestionRender<TItem extends SuggestionItem>() {
  return function render() {
    let renderer: ReactRenderer<
      SuggestionListHandle,
      SuggestionListProps
    > | null = null;
    let element: HTMLElement | null = null;

    function position(
      getClientRect: (() => DOMRect | null) | null | undefined,
    ) {
      const rect = getClientRect?.();
      if (!element || !rect) {
        return;
      }
      element.style.position = "fixed";
      element.style.top = `${rect.bottom + 4}px`;
      element.style.left = `${rect.left}px`;
      element.style.zIndex = "50";
    }

    return {
      // Deliberately synchronous, not async: `renderer` used to be created
      // after `await import("@tiptap/react")`, which meant a `/`'s
      // synchronous `items()` result (unlike `@`'s async member search)
      // could arrive via `onUpdate` *before* that await resolved. `renderer`
      // was still null, `renderer?.updateProps(...)` silently did nothing,
      // and the popup that finally mounted a tick later carried this
      // call's original (often empty) items forever — reproduced directly
      // by typing `/` and watching a real "No matches" that never
      // recovers, not a theoretical race.
      onStart(props: {
        items: readonly TItem[];
        // The suggestion plugin's own insertion trigger: calling this with
        // the chosen item is what actually runs the extension's configured
        // `command` (inserting the node). Not a separate business callback.
        command: (item: TItem) => void;
        clientRect?: (() => DOMRect | null) | null;
        editor: Editor;
      }) {
        renderer = new ReactRenderer(SuggestionList, {
          editor: props.editor,
          props: { items: props.items, command: props.command },
        });
        element = renderer.element;
        document.body.append(element);
        position(props.clientRect);
      },
      onUpdate(props: {
        items: readonly TItem[];
        command: (item: TItem) => void;
        clientRect?: (() => DOMRect | null) | null;
      }) {
        renderer?.updateProps({ items: props.items, command: props.command });
        position(props.clientRect);
      },
      onKeyDown(props: { event: KeyboardEvent }) {
        if (props.event.key === "Escape") {
          element?.remove();
          return true;
        }
        return renderer?.ref?.onKeyDown(props) ?? false;
      },
      onExit() {
        element?.remove();
        renderer?.destroy();
      },
    };
  };
}
