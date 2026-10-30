// @vitest-environment jsdom
import { TranslationsProvider } from "@openokr/ui";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

/**
 * The shell's link while the next page is on its way.
 *
 * A click on the sidebar used to look ignored: the segment's skeleton only
 * appears once the server answers, so a slow or unreachable server left the
 * old page on screen with nothing to say the click had landed. The pending
 * state is Next's own `useLinkStatus`, stood in for here so the test can hold
 * a navigation open for as long as it likes.
 */

const status = { pending: false };
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
  useLinkStatus: () => status,
}));

const { NavLink, NAVIGATION_STALL_MS } = await import("../lib/nav-link.tsx");

let container: HTMLDivElement;
let root: Root;

function render() {
  act(() => {
    root.render(
      <TranslationsProvider locale="en">
        <NavLink href="/review" className="">
          Review
        </NavLink>
      </TranslationsProvider>,
    );
  });
}

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  status.pending = false;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const progress = () =>
  document.querySelector('[data-testid="navigation-progress"]');
const stalled = () =>
  document.querySelector('[data-testid="navigation-stalled"]');

describe("NavLink", () => {
  test("shows nothing extra when no navigation is pending", () => {
    render();
    expect(progress()).toBeNull();
    expect(stalled()).toBeNull();
  });

  test("shows the progress bar at once while the navigation is pending", () => {
    status.pending = true;
    render();
    expect(progress()).not.toBeNull();
    // The bar is outside the link, so it is not interactive content inside it.
    expect(
      container.querySelector('[data-testid="navigation-progress"]'),
    ).toBeNull();
    expect(stalled()).toBeNull();
  });

  test("says the server is not answering once the wait passes the limit", () => {
    status.pending = true;
    render();
    act(() => {
      vi.advanceTimersByTime(NAVIGATION_STALL_MS - 1);
    });
    expect(stalled()).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(stalled()?.getAttribute("role")).toBe("alert");
    expect(stalled()?.textContent).toContain("The server is not answering");
    expect(stalled()?.textContent).toContain("Try again");
  });

  test("says the browser is offline without waiting", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    status.pending = true;
    render();
    expect(stalled()?.textContent).toContain("You are offline");
  });

  test("clears the bar and the message when the page arrives", () => {
    status.pending = true;
    render();
    act(() => {
      vi.advanceTimersByTime(NAVIGATION_STALL_MS);
    });
    expect(stalled()).not.toBeNull();
    status.pending = false;
    render();
    expect(progress()).toBeNull();
    expect(stalled()).toBeNull();
  });
});
