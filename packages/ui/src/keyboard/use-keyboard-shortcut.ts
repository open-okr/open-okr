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
  readonly shift?: boolean;
  /** False while a text input, textarea or contenteditable has focus, so a
   * single-letter shortcut (e.g. `c`) never fires while someone is typing
   * a title. Defaults to true. */
  readonly allowInInputs?: boolean;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.isContentEditable
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
      if (!options.allowInInputs && isTypingTarget(event.target)) {
        return;
      }
      const modOk = options.mod
        ? event.metaKey || event.ctrlKey
        : !event.metaKey && !event.ctrlKey;
      const shiftOk = options.shift ? event.shiftKey : !event.shiftKey;
      if (
        modOk &&
        shiftOk &&
        event.key.toLowerCase() === options.key.toLowerCase()
      ) {
        event.preventDefault();
        handler(event);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handler, options.key, options.mod, options.shift, options.allowInInputs]);
}
