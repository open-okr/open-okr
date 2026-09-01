import {
  BarChart3,
  CalendarDays,
  CheckCircle2,
  Circle,
  ClipboardCheck,
  Home,
  Layers,
  MessageSquare,
  RefreshCw,
  Shield,
  Target,
  Trophy,
} from "lucide-react";
import type { ReactNode } from "react";

/**
 * A Lucide icon per registered navigation item (UIUX-PLAN.md §2: "Lucide.
 * Fixed entity iconography").
 *
 * Its own module rather than a constant inside `app-shell.tsx` so
 * `test/nav-icons.test.ts` can assert the map covers the registry without
 * importing a server component. That test is the point: the map used to sit
 * behind an `?? <Inbox/>` default, and four of the eleven sidebar items fell
 * through it, so Scorecard, Sessions, Spaces and "Where to reach you" all
 * drew the same envelope.
 *
 * The mapping stays here rather than in the registry on purpose:
 * `NavigationItem` (P2-T08) carries no icon field, because the registry is
 * database-free synchronous data and an icon is a presentation detail each
 * consumer chooses for itself.
 */
const ICONS: Readonly<Record<string, ReactNode>> = {
  overview: <Home className="size-full" />,
  review: <ClipboardCheck className="size-full" />,
  cycle: <RefreshCw className="size-full" />,
  goals: <Target className="size-full" />,
  kpis: <BarChart3 className="size-full" />,
  scorecard: <Trophy className="size-full" />,
  "check-in": <CheckCircle2 className="size-full" />,
  sessions: <CalendarDays className="size-full" />,
  spaces: <Layers className="size-full" />,
  "account-channels": <MessageSquare className="size-full" />,
  "account-security": <Shield className="size-full" />,
};

/** The ids the map covers. Exported for the test, not for rendering. */
export const NAV_ICON_IDS: readonly string[] = Object.keys(ICONS);

/**
 * The icon for a navigation id.
 *
 * The fallback is a plain circle, deliberately meaningless. It used to be an
 * inbox, which is a real entity in §3's information architecture, so an
 * unmapped module did not look unmapped: it looked like the Inbox.
 */
export function iconFor(id: string): ReactNode {
  return ICONS[id] ?? <Circle className="size-full" />;
}
