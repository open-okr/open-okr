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
