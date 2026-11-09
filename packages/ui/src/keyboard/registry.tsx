"use client";

/**
 * The keyboard registry (UIUX-PLAN.md §4 "Keyboard" pattern, P2-T10 item
 * 7). Every registered-and-mounted shortcut shows up in the `?` overlay
 * automatically — a screen that wants "keyboard-first" (§1's design
 * principle) mounts `useKeyboardShortcut`, and the overlay's own list is
 * never hand-maintained, so a screen cannot register a key without it
 * also being documented.
 *
 * No key is wired here. Each is registered by what it acts on, so a key is
 * live, and listed, only where its destination is on screen (plan 0.7.0,
 * U2): `?` by the overlay, `⌘K` by the palette, `⌘J` by the copilot, `/` by
 * the topbar's search, `c` by `+ New`, `j`/`k`/`x`/`e` by a `KeyboardList`,
 * `[` and `]` by a detail screen with neighbours, and `⌘⏎` by a settings
 * screen whose forms bind it. A key with no real destination would be a dead
 * button, the same thing §4's "AI degradation" rule refuses for a missing
 * provider.
 */
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

/**
 * The overlay's sections, in the order it shows them: §4's own grouping,
 * "Global", "Lists" and "Detail", and "Forms" for `⌘⏎`, which a settings
 * screen binds with no list in sight. An id rather than words, so the
 * overlay can name each in the reader's language.
 */
export const SHORTCUT_GROUPS = ["global", "lists", "detail", "forms"] as const;

export type ShortcutGroup = (typeof SHORTCUT_GROUPS)[number];

export interface Shortcut {
  readonly id: string;
  /** Display form, e.g. "⌘K", "j", "?". Not parsed — matching happens in
   * `use-keyboard-shortcut.ts` against a normalised key combo instead. */
  readonly keys: string;
  readonly description: string;
  readonly group: ShortcutGroup;
}

interface KeyboardRegistryValue {
  readonly shortcuts: readonly Shortcut[];
  register(shortcut: Shortcut): void;
  unregister(id: string): void;
}

const KeyboardRegistryContext = createContext<KeyboardRegistryValue | null>(
  null,
);

export function KeyboardRegistryProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const [shortcuts, setShortcuts] = useState<readonly Shortcut[]>([]);

  const register = useCallback((shortcut: Shortcut) => {
    setShortcuts((current) => {
      const existing = current.find((entry) => entry.id === shortcut.id);
      // A caller's own `shortcut` object is very often reconstructed every
      // render (a fresh literal with the same field values). Skipping the
      // update when nothing actually changed is what keeps that a no-op
      // instead of a new array reference every render — which, chained
      // through this state and the effect that calls `register`, would
      // otherwise re-render forever.
      if (
        existing &&
        existing.keys === shortcut.keys &&
        existing.description === shortcut.description &&
        existing.group === shortcut.group
      ) {
        return current;
      }
      return [...current.filter((entry) => entry.id !== shortcut.id), shortcut];
    });
  }, []);

  const unregister = useCallback((id: string) => {
    setShortcuts((current) => current.filter((existing) => existing.id !== id));
  }, []);

  const value = useMemo<KeyboardRegistryValue>(
    () => ({ shortcuts, register, unregister }),
    [shortcuts, register, unregister],
  );

  return (
    <KeyboardRegistryContext.Provider value={value}>
      {children}
    </KeyboardRegistryContext.Provider>
  );
}

export function useKeyboardRegistry(): KeyboardRegistryValue {
  const context = useContext(KeyboardRegistryContext);
  if (!context) {
    throw new Error(
      "useKeyboardRegistry must be used within a KeyboardRegistryProvider.",
    );
  }
  return context;
}
