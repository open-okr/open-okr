// @vitest-environment jsdom
import { Topbar, TranslationsProvider } from "@openokr/ui";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// Plan 0.8.0 D1: a demonstration instance says so on sign-in and in the top
// bar, not only in the persona panel that is hidden when nobody is listed.

const { DemoPill } = await import("../lib/demo-pill");

let host: HTMLDivElement;
let root: Root;

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
  vi.restoreAllMocks();
});

describe("the Demo pill", () => {
  test("shows one word, and gives a screen reader the sentence once", async () => {
    await act(async () => {
      root.render(
        <TranslationsProvider locale="en">
          <DemoPill />
        </TranslationsProvider>,
      );
    });
    const pill = host.querySelector<HTMLElement>('[data-testid="demo-pill"]');
    expect(pill).not.toBeNull();
    // A keyboard reaches it, so the tooltip opens on focus as on hover.
    expect(pill?.tabIndex).toBe(0);
    const visible = pill?.querySelector('[aria-hidden="true"]');
    expect(visible?.textContent).toBe("Demo");
    const spoken = pill?.querySelector(".sr-only");
    expect(spoken?.textContent).toBe(
      "This is a demonstration instance. It is rebuilt on a schedule and nothing in it is real.",
    );
  });

  test("sits in the top bar after the breadcrumb", async () => {
    await act(async () => {
      root.render(
        <TranslationsProvider locale="en">
          <Topbar breadcrumb="Northwind" badge={<DemoPill />} />
        </TranslationsProvider>,
      );
    });
    const header = host.querySelector("header");
    const text = header?.textContent ?? "";
    expect(text.indexOf("Northwind")).toBeLessThan(text.indexOf("Demo"));
  });

  test("is absent from a top bar given none", async () => {
    await act(async () => {
      root.render(
        <TranslationsProvider locale="en">
          <Topbar breadcrumb="Northwind" />
        </TranslationsProvider>,
      );
    });
    expect(host.querySelector('[data-testid="demo-pill"]')).toBeNull();
  });
});
