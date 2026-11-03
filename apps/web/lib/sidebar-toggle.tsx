"use client";

import { Tooltip, useTranslations } from "@openokr/ui";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useEffect, useState } from "react";

/** Where the choice is kept, per browser. */
const KEY = "openokr.sidebar";

/**
 * Narrows the sidebar to its icon rail on a wide screen, and back
 * (usability review TB1).
 *
 * Below 1280px the rail is already icons only, so the button is drawn from
 * xl up. The state is `data-sidebar="rail"` on `<html>`, which the sidebar's
 * own classes read, so the server-rendered sidebar needs no prop. Read after
 * mount; a refused storage leaves the full sidebar.
 */
export function SidebarToggle() {
  const { t } = useTranslations();
  const [rail, setRail] = useState(false);

  useEffect(() => {
    try {
      setRail(window.localStorage.getItem(KEY) === "rail");
    } catch {
      // The full sidebar.
    }
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (rail) {
      root.setAttribute("data-sidebar", "rail");
    } else {
      root.removeAttribute("data-sidebar");
    }
  }, [rail]);

  const label = rail ? t("shell.sidebar.expand") : t("shell.sidebar.collapse");
  const Icon = rail ? PanelLeftOpen : PanelLeftClose;

  return (
    <Tooltip label={label} side="right">
      <button
        type="button"
        aria-label={label}
        aria-pressed={rail}
        data-testid="sidebar-toggle"
        onClick={() => {
          const next = !rail;
          setRail(next);
          try {
            if (next) {
              window.localStorage.setItem(KEY, "rail");
            } else {
              window.localStorage.removeItem(KEY);
            }
          } catch {
            // Not remembered.
          }
        }}
        className="hidden size-8 items-center justify-center rounded-control text-ink-3 hover:bg-ink/[0.045] hover:text-ink xl:flex"
      >
        <Icon aria-hidden="true" className="size-4" />
      </button>
    </Tooltip>
  );
}
