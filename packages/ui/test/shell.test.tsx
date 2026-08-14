import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { AppShell } from "../src/shell/app-shell.tsx";
import { MobileTabBar } from "../src/shell/mobile-tab-bar.tsx";
import { Sidebar } from "../src/shell/sidebar.tsx";

/**
 * A real viewport (resize, media query evaluation, actual layout) needs a
 * browser — `pnpm test:e2e`'s Playwright suite, not this sandbox. What is
 * checked here, and what "mobile viewport smoke test" can mean without one:
 * the sidebar and the mobile tab bar carry the exact Tailwind breakpoint
 * classes §3 specifies (hidden below `md`, icon-only from `md`, full from
 * `xl`), so the mechanism is provably in place even though no test here can
 * watch it actually respond to a resize.
 */
describe("responsive shell classes (§3)", () => {
  test("the sidebar is hidden below md and full-width from xl", () => {
    const { container } = render(
      <Sidebar
        groups={[
          {
            id: "g",
            items: [{ id: "home", label: "Home", href: "/", icon: <span /> }],
          },
        ]}
        workspaceSwitcher={<div>Workspace</div>}
      />,
    );
    const nav = container.querySelector("nav");
    expect(nav?.className).toContain("hidden");
    expect(nav?.className).toContain("md:flex");
    expect(nav?.className).toContain("md:w-17");
    expect(nav?.className).toContain("xl:w-59");
  });

  test("the mobile tab bar only shows below md", () => {
    const { container } = render(
      <MobileTabBar
        items={[{ id: "home", label: "Home", href: "/", icon: <span /> }]}
      />,
    );
    const nav = container.querySelector("nav");
    expect(nav?.className).toContain("md:hidden");
  });

  test("a sidebar item's label is hidden until xl, unlike its icon", () => {
    render(
      <Sidebar
        groups={[
          {
            id: "g",
            items: [{ id: "home", label: "Home", href: "/", icon: <span /> }],
          },
        ]}
        workspaceSwitcher={<div>Workspace</div>}
      />,
    );
    const label = screen.getByText("Home");
    expect(label.className).toContain("xl:inline");
  });
});

/**
 * The Review badge (UIUX-PLAN.md §3, S-02 "drives the sidebar badge", P3-T08).
 *
 * The count is drawn twice for two different readers: a chip beside the label
 * from `xl`, and a dot on the icon below it, where the label and the chip are
 * both hidden. Whichever is visible, the accessible name carries the number, so
 * the one reader who cannot see either gets the count rather than "Review".
 */
describe("the sidebar badge", () => {
  const withBadge = (badge?: number) =>
    render(
      <Sidebar
        groups={[
          {
            id: "g",
            items: [
              {
                id: "review",
                label: "Review",
                href: "/review",
                icon: <span />,
                ...(badge === undefined ? {} : { badge }),
              },
            ],
          },
        ]}
        workspaceSwitcher={<div>Workspace</div>}
      />,
    );

  test("puts the count in the link's accessible name at every width", () => {
    withBadge(3);
    expect(screen.getByRole("link", { name: /3 waiting on you/ })).toBeTruthy();
  });

  test("keeps a dot on the icon where the chip is hidden", () => {
    const { container } = withBadge(3);
    const dot = container.querySelector("span.rounded-full.bg-bad");
    // Present below xl, gone from xl, which is exactly where the chip appears.
    expect(dot?.className).toContain("xl:hidden");
    const chip = screen.getByText("3", {
      selector: "span[class*='xl:inline']",
    });
    expect(chip.className).toContain("hidden");
  });

  test("draws nothing at all when there is no badge", () => {
    const { container } = withBadge();
    expect(container.querySelector("span.rounded-full.bg-bad")).toBeNull();
    expect(screen.queryByText(/waiting on you/)).toBeNull();
  });
});

describe("AppShell composition", () => {
  test("renders every slot", () => {
    render(
      <AppShell
        sidebar={<div>sidebar-slot</div>}
        topbar={<div>topbar-slot</div>}
        mobileTabBar={<div>tabbar-slot</div>}
      >
        <div>content-slot</div>
      </AppShell>,
    );
    expect(screen.getByText("sidebar-slot")).toBeTruthy();
    expect(screen.getByText("topbar-slot")).toBeTruthy();
    expect(screen.getByText("tabbar-slot")).toBeTruthy();
    expect(screen.getByText("content-slot")).toBeTruthy();
  });
});
