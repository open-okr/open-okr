"use client";

import { Dialog } from "@base-ui-components/react/dialog";
import { useCallback, useState } from "react";
import { Kbd } from "../components/kbd.tsx";
import { useTranslations } from "../i18n/use-translations.tsx";
import { useKeyboardRegistry } from "./registry.tsx";
import { useKeyboardShortcut } from "./use-keyboard-shortcut.ts";

/**
 * §4: "`?` opens the shortcut overlay." Lists exactly what is registered
 * right now on this screen — never a fixed, hand-maintained list — so it
 * can never claim a shortcut that is not actually live.
 */
export function ShortcutOverlay() {
  const [open, setOpen] = useState(false);
  const { shortcuts } = useKeyboardRegistry();
  const { t } = useTranslations();

  useKeyboardShortcut(
    {
      id: "shortcut-overlay.open",
      keys: "?",
      description: t("shell.shortcuts.overlayDescription"),
      group: "Global",
    },
    useCallback(() => setOpen(true), []),
    { key: "?" },
  );

  const groups = new Map<string, typeof shortcuts>();
  for (const shortcut of shortcuts) {
    groups.set(shortcut.group, [
      ...(groups.get(shortcut.group) ?? []),
      shortcut,
    ]);
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 bg-ink/20 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup className="fixed top-1/2 left-1/2 max-h-[80vh] w-105 -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-line bg-surface p-4 shadow-(--shadow-popover)">
          <Dialog.Title className="text-lg font-bold text-ink">
            {t("shell.shortcuts.title")}
          </Dialog.Title>
          <div className="mt-3 flex flex-col gap-4">
            {[...groups.entries()].map(([group, groupShortcuts]) => (
              <div key={group}>
                <div className="mb-1.5 text-xs font-bold tracking-wide text-ink-4 uppercase">
                  {group}
                </div>
                <ul className="flex flex-col gap-1.5">
                  {groupShortcuts.map((shortcut) => (
                    <li
                      key={shortcut.id}
                      className="flex items-center justify-between gap-3 text-sm text-ink-2"
                    >
                      <span>{shortcut.description}</span>
                      <Kbd>{shortcut.keys}</Kbd>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {shortcuts.length === 0 ? (
              <p className="text-sm text-ink-3">{t("shell.shortcuts.empty")}</p>
            ) : null}
          </div>
          <Dialog.Close className="mt-4 text-sm font-semibold text-brand-600 hover:underline">
            {t("shell.shortcuts.close")}
          </Dialog.Close>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
