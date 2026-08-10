"use client";

/**
 * The keyboard registry (UIUX-PLAN.md §4 "Keyboard" pattern, P2-T10 item
 * 7). Every registered-and-mounted shortcut shows up in the `?` overlay
 * automatically — a screen that wants "keyboard-first" (§1's design
 * principle) mounts `useKeyboardShortcut`, and the overlay's own list is
 * never hand-maintained, so a screen cannot register a key without it
 * also being documented.
 *
 * Deliberately not wired to any specific key here: `⌘K` (the palette,
 * S-32), `⌘J` (Ask AI, S-39), `c` (create), and the list/detail keys
 * (`j`/`k`/`x`/`e`/`⌘⏎`/`[`/`]`) all name a screen or a feature that does
 * not exist yet. Wiring the key without a real destination would be a
 * dead button — the same thing §4's "AI degradation" rule refuses for a
 * missing provider, generalised to a missing feature. Only `?` (this
 * overlay itself) is registered by the shell, because it is the one
 * shortcut this task actually builds a destination for.
 */
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

export interface Shortcut {
  readonly id: string;
  /** Display form, e.g. "⌘K", "j", "?". Not parsed — matching happens in
   * `use-keyboard-shortcut.ts` against a normalised key combo instead. */
  readonly keys: string;
  readonly description: string;
  /** Groups the overlay's sections (§3's own grouping: "Global", "Lists",
   * "Detail"). */
  readonly group: string;
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
