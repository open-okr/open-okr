// @vitest-environment jsdom
import { TranslationsProvider } from "@openokr/ui";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// Plan 0.8.0 Y1: the avatar's circle drew the workspace's initials, and
// nothing in the menu said who was signed in.

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("../app/tour-actions", () => ({ finishTour: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const { AvatarMenu, SignOutItem } = await import("../app/avatar-menu");

let host: HTMLDivElement;
let root: Root;

const render = async (props: Partial<Parameters<typeof AvatarMenu>[0]>) => {
  await act(async () => {
    root.render(
      <TranslationsProvider locale="en">
        <AvatarMenu
          name="Priya Raman"
          email="priya@northwind.example"
          roleName="Admin"
          items={[{ href: "/account", label: "Your account" }]}
          signOut={null}
          appearance={null}
          sourceUrl="https://github.com/open-okr/open-okr"
          {...props}
        />
      </TranslationsProvider>,
    );
  });
};

const open = async () => {
  const trigger = host.querySelector<HTMLButtonElement>(
    '[data-testid="account-menu"]',
  );
  await act(async () => {
    trigger?.click();
  });
};

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

describe("the avatar menu", () => {
  test("its circle is the person's, and its name says whose menu it is", async () => {
    await render({});
    const trigger = host.querySelector('[data-testid="account-menu"]');
    expect(trigger?.getAttribute("aria-label")).toBe(
      "Account menu for Priya Raman, PR",
    );
    expect(trigger?.textContent).toContain("PR");
  });

  test("opens with who is signed in, their email and their role, linking to Your account", async () => {
    await render({});
    await open();
    const header = document.querySelector<HTMLAnchorElement>(
      '[data-testid="account-menu-header"]',
    );
    expect(header?.getAttribute("href")).toBe("/account");
    expect(header?.textContent).toContain("Priya Raman");
    expect(header?.textContent).toContain("priya@northwind.example");
    expect(header?.textContent).toContain("Admin");
  });

  test("marks a guest, a demo account and a support session", async () => {
    for (const [badge, text] of [
      ["guest", "Guest"],
      ["demo", "Demo account"],
      ["support", "Support access"],
    ] as const) {
      await render({ badge, roleName: null });
      await open();
      expect(
        document.querySelector(`[data-testid="account-badge-${badge}"]`)
          ?.textContent,
      ).toBe(text);
      await act(async () => root.unmount());
      document.body.innerHTML = "";
      host = document.createElement("div");
      document.body.appendChild(host);
      root = createRoot(host);
    }
  });

  // Q-10a (0.8.0 acceptance test): "Sign out" was a plain button inside the
  // menu, so the arrow keys went past it and only Tab reached it.
  test("Sign out is a menu item the arrow keys reach, and it submits its form", async () => {
    const action = vi.fn(async () => {});
    await render({ signOut: <SignOutItem action={action} /> });
    await open();

    const signOut = [
      ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ].find((item) => item.textContent === "Sign out");
    expect(signOut).toBeDefined();
    // A submit button, so it still works as a form without JavaScript.
    expect(signOut?.tagName).toBe("BUTTON");
    expect(signOut?.getAttribute("type")).toBe("submit");
    expect(signOut?.closest("form")).not.toBeNull();

    // Down from the row above it, the source code link, lands on it.
    const source = document.querySelector<HTMLElement>(
      'a[href="https://github.com/open-okr/open-okr"]',
    );
    await act(async () => source?.focus());
    await act(async () => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    expect(document.activeElement).toBe(signOut);
  });
});
