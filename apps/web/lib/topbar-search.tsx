"use client";

import {
  TopbarSearch,
  useKeyboardShortcut,
  useTranslations,
} from "@openokr/ui";
import { useRouter } from "next/navigation";
import { useCallback, useRef } from "react";

/**
 * The topbar's search box, and `/` to reach it (UIUX-PLAN §3 and §4; plan
 * 0.7.0, U2).
 *
 * Enter sends what was typed to the search page, whose address holds the
 * phrase, so the box is a real search rather than a field that does nothing.
 * The box is hidden on a narrow screen, so there `/` opens the search page
 * itself. `⌘K` is the palette, a separate way in.
 */
export function TopbarSearchField() {
  const { t } = useTranslations();
  const router = useRouter();
  const field = useRef<HTMLInputElement>(null);

  useKeyboardShortcut(
    {
      id: "search.focus",
      keys: "/",
      description: t("shell.shortcuts.search"),
      group: "global",
    },
    useCallback(() => {
      const input = field.current;
      // A DOM that cannot tell whether it is drawn is taken to be drawing it.
      if (input && (input.checkVisibility?.() ?? true)) {
        input.focus();
        input.select();
      } else {
        router.push("/search");
      }
    }, [router]),
    { key: "/" },
  );

  return <TopbarSearch inputRef={field} action="/search" />;
}
