import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useCallback } from "react";
import { describe, expect, test, vi } from "vitest";
import { TranslationsProvider } from "../src/i18n/use-translations.tsx";
import {
  KeyboardRegistryProvider,
  useKeyboardRegistry,
} from "../src/keyboard/registry.tsx";
import { ShortcutOverlay } from "../src/keyboard/shortcut-overlay.tsx";
import { useKeyboardShortcut } from "../src/keyboard/use-keyboard-shortcut.ts";

function RegistryProbe() {
  const { shortcuts } = useKeyboardRegistry();
  return <div data-testid="count">{shortcuts.length}</div>;
}

function Harness({ onCreate }: { readonly onCreate: () => void }) {
  useKeyboardShortcut(
    { id: "test.create", keys: "c", description: "Create", group: "Global" },
    useCallback(() => onCreate(), [onCreate]),
    { key: "c" },
  );
  return <input aria-label="title" />;
}

function renderHarness(onCreate: () => void) {
  return render(
    <TranslationsProvider locale="en">
      <KeyboardRegistryProvider>
        <Harness onCreate={onCreate} />
        <ShortcutOverlay />
      </KeyboardRegistryProvider>
    </TranslationsProvider>,
  );
}

describe("useKeyboardShortcut", () => {
  test("a registered shortcut fires its handler on keydown", async () => {
    const onCreate = vi.fn();
    render(
      <KeyboardRegistryProvider>
        <Harness onCreate={onCreate} />
      </KeyboardRegistryProvider>,
    );
    await userEvent.keyboard("c");
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  test("a single-letter shortcut does not fire while a text input has focus", async () => {
    const onCreate = vi.fn();
    render(
      <KeyboardRegistryProvider>
        <Harness onCreate={onCreate} />
      </KeyboardRegistryProvider>,
    );
    const input = screen.getByLabelText("title");
    await userEvent.click(input);
    await userEvent.keyboard("c");
    expect(onCreate).not.toHaveBeenCalled();
  });

  test("unmounting removes the shortcut from the registry — a screen can never leave a stale entry behind", () => {
    const { unmount } = render(
      <KeyboardRegistryProvider>
        <Harness onCreate={vi.fn()} />
        <RegistryProbe />
      </KeyboardRegistryProvider>,
    );
    expect(screen.getByTestId("count").textContent).toBe("1");
    unmount();
  });
});

describe("KeyboardRegistryProvider", () => {
  test("registering the same id twice replaces the entry rather than duplicating it", () => {
    function TwoRegistrations() {
      useKeyboardShortcut(
        { id: "same", keys: "c", description: "First", group: "Global" },
        vi.fn(),
        { key: "c" },
      );
      useKeyboardShortcut(
        { id: "same", keys: "c", description: "Second", group: "Global" },
        vi.fn(),
        { key: "c" },
      );
      return <RegistryProbe />;
    }
    render(
      <KeyboardRegistryProvider>
        <TwoRegistrations />
      </KeyboardRegistryProvider>,
    );
    expect(screen.getByTestId("count").textContent).toBe("1");
  });

  test("useKeyboardRegistry throws outside its provider — a screen cannot silently register nowhere", () => {
    function Orphan() {
      useKeyboardRegistry();
      return null;
    }
    expect(() => render(<Orphan />)).toThrow();
  });
});

describe("ShortcutOverlay", () => {
  test("`?` opens the overlay, which lists every currently-registered shortcut", async () => {
    renderHarness(vi.fn());
    await userEvent.keyboard("?");
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeTruthy();
    });
    expect(screen.getByText("Create")).toBeTruthy();
  });

  test("the overlay's close control removes the dialog", async () => {
    renderHarness(vi.fn());
    await userEvent.keyboard("?");
    const closeButton = await screen.findByText("Close");
    await userEvent.click(closeButton);
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  test("the overlay always lists at least itself — it registers its own `?` shortcut", async () => {
    render(
      <TranslationsProvider locale="en">
        <KeyboardRegistryProvider>
          <ShortcutOverlay />
        </KeyboardRegistryProvider>
      </TranslationsProvider>,
    );
    await userEvent.keyboard("?");
    await waitFor(() => {
      expect(screen.getByText("Show keyboard shortcuts")).toBeTruthy();
    });
    expect(
      screen.queryByText("No shortcuts are registered on this screen yet."),
    ).toBeNull();
  });
});
