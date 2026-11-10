"use client";

import { useEffect } from "react";
import { type Shortcut, useKeyboardRegistry } from "./registry.tsx";

export interface KeyboardShortcutOptions {
  /** The literal key the browser reports (`KeyboardEvent.key`, already
   * lower-cased for letters), e.g. "?", "/", "k". */
  readonly key: string;
  /** Either modifier satisfies "⌘": Mac's actual Cmd, and Ctrl everywhere
   * else, matching how every other cross-platform shortcut in this stack
   * (VS Code, Linear, ...) treats the same glyph. */
  readonly mod?: boolean;
  /**
   * Whether Shift must be held. Left out, a letter, a digit or a named key
   * such as Enter must be pressed without it, because `J` is not `j`; a
   * symbol such as `?`, `/` or `]` matches either way, because the symbol
   * already says which keys typed it, and on most keyboards `?` needs Shift
   * (plan 0.7.0, U2: the overlay's own `?` could never fire).
   */
  readonly shift?: boolean;
  /** False while somebody is typing (see `isTyping`), so a single-letter
   * shortcut (e.g. `c`) never fires in the middle of a title. Defaults to
   * false. */
  readonly allowInInputs?: boolean;
}

/** Input types that hold no text, where a letter is not typing. */
const NOT_TEXT = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

/**
 * Whether a key pressed here belongs to what has the focus rather than to
 * the screen: a text field, a select, editable text, or a combobox, menu,
 * listbox or dialog, whose own letters move through their items. A ticked
 * box or a link is not typing, so a list's keys still work from one.
 */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target instanceof HTMLInputElement) {
    return !NOT_TEXT.has(target.type);
  }
  return (
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable ||
    // The attribute as well as the property, which not every DOM computes.
    target.closest(
      '[contenteditable]:not([contenteditable="false"]), [role="combobox"], [role="menu"], [role="listbox"], [role="dialog"], [role="alertdialog"]',
    ) !== null
  );
}

/** A single character that is not a letter or a digit. */
function isSymbol(key: string): boolean {
  return key.length === 1 && !/[\p{L}\p{N}]/u.test(key);
}

/** Whether a keydown is this shortcut. */
export function matchesShortcut(
  event: KeyboardEvent,
  options: KeyboardShortcutOptions,
): boolean {
  if (event.defaultPrevented || event.isComposing) {
    return false;
  }
  if (!options.allowInInputs && isTyping(event.target)) {
    return false;
  }
  const modOk = options.mod
    ? event.metaKey || event.ctrlKey
    : !event.metaKey && !event.ctrlKey;
  const shiftOk =
    options.shift !== undefined
      ? options.shift === event.shiftKey
      : isSymbol(options.key) || !event.shiftKey;
  return (
    modOk && shiftOk && event.key.toLowerCase() === options.key.toLowerCase()
  );
}

/**
 * Registers a shortcut for the `?` overlay to list, and attaches the
 * keydown listener that actually runs it. Both halves of one `useEffect`
 * so a shortcut can never appear in the overlay without a live handler
 * behind it, or vice versa.
 */
export function useKeyboardShortcut(
  shortcut: Shortcut,
  handler: (event: KeyboardEvent) => void,
  options: KeyboardShortcutOptions,
): void {
  const { register, unregister } = useKeyboardRegistry();
  // Destructured so the effect's dependencies are the primitive fields that
  // actually determine its behaviour, not `shortcut`'s own object identity —
  // a caller passes a fresh literal every render (every example in this
  // codebase does), and depending on identity would re-run this effect,
  // and re-render the registry's state, on every single render.
  const { id, keys, description, group } = shortcut;

  useEffect(() => {
    register({ id, keys, description, group });
    return () => unregister(id);
  }, [id, keys, description, group, register, unregister]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        matchesShortcut(event, {
          key: options.key,
          ...(options.mod === undefined ? {} : { mod: options.mod }),
          ...(options.shift === undefined ? {} : { shift: options.shift }),
          ...(options.allowInInputs === undefined
            ? {}
            : { allowInInputs: options.allowInInputs }),
        })
      ) {
        event.preventDefault();
        handler(event);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handler, options.key, options.mod, options.shift, options.allowInInputs]);
}
