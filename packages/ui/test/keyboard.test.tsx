import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useCallback, useEffect } from "react";
import { describe, expect, test, vi } from "vitest";
import { TranslationsProvider } from "../src/i18n/use-translations.tsx";
import { KeyboardList } from "../src/keyboard/keyboard-list.tsx";
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
    { id: "test.create", keys: "c", description: "Create", group: "global" },
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

function TwoRegistrations() {
  useKeyboardShortcut(
    { id: "same", keys: "c", description: "First", group: "global" },
    vi.fn(),
    { key: "c" },
  );
  useKeyboardShortcut(
    { id: "same", keys: "c", description: "Second", group: "global" },
    vi.fn(),
    { key: "c" },
  );
  return <RegistryProbe />;
}

function Orphan() {
  useKeyboardRegistry();
  return null;
}

describe("KeyboardRegistryProvider", () => {
  test("registering the same id twice replaces the entry rather than duplicating it", () => {
    render(
      <KeyboardRegistryProvider>
        <TwoRegistrations />
      </KeyboardRegistryProvider>,
    );
    expect(screen.getByTestId("count").textContent).toBe("1");
  });

  test("useKeyboardRegistry throws outside its provider — a screen cannot silently register nowhere", () => {
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

  test("`?` opens it with Shift held, which is how most keyboards type it (plan 0.7.0, U2)", async () => {
    renderHarness(vi.fn());
    await userEvent.keyboard("{Shift>}?{/Shift}");
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeTruthy();
    });
  });

  test("names its groups in the reader's language, in a fixed order", async () => {
    render(
      <TranslationsProvider locale="ms">
        <KeyboardRegistryProvider>
          <DetailAndList />
          <ShortcutOverlay />
        </KeyboardRegistryProvider>
      </TranslationsProvider>,
    );
    await userEvent.keyboard("{Shift>}?{/Shift}");
    const dialog = await screen.findByRole("dialog");
    const headings = [
      ...dialog.querySelectorAll('[data-testid="shortcut-group"]'),
    ].map((one) => one.textContent);
    expect(headings).toEqual(["Umum", "Senarai", "Butiran"]);
  });
});

function DetailAndList() {
  useKeyboardShortcut(
    { id: "test.next", keys: "]", description: "Next", group: "detail" },
    vi.fn(),
    { key: "]" },
  );
  return (
    <KeyboardList>
      <ul>
        <li data-keyboard-row>
          <a href="/one">One</a>
        </li>
      </ul>
    </KeyboardList>
  );
}

/** Where a person types, which no single-key shortcut may interrupt. */
function Fields({ onCreate }: { readonly onCreate: () => void }) {
  useKeyboardShortcut(
    { id: "test.create", keys: "c", description: "Create", group: "global" },
    useCallback(() => onCreate(), [onCreate]),
    { key: "c" },
  );
  return (
    <>
      <select aria-label="status">
        <option>committed</option>
        <option>cancelled</option>
      </select>
      <textarea aria-label="notes" />
      <div data-testid="editor" contentEditable suppressContentEditableWarning>
        text
      </div>
      <input type="checkbox" aria-label="tick" />
    </>
  );
}

describe("never while typing (plan 0.7.0, U2)", () => {
  test("not in a select, a text area or editable text", async () => {
    const onCreate = vi.fn();
    render(
      <KeyboardRegistryProvider>
        <Fields onCreate={onCreate} />
      </KeyboardRegistryProvider>,
    );
    for (const field of [
      screen.getByLabelText("status"),
      screen.getByLabelText("notes"),
      screen.getByTestId("editor"),
    ]) {
      field.focus();
      await userEvent.keyboard("c");
    }
    expect(onCreate).not.toHaveBeenCalled();
  });

  test("but a ticked box is not typing", async () => {
    const onCreate = vi.fn();
    render(
      <KeyboardRegistryProvider>
        <Fields onCreate={onCreate} />
      </KeyboardRegistryProvider>,
    );
    screen.getByLabelText("tick").focus();
    await userEvent.keyboard("c");
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  test("a letter with Shift held is another key", async () => {
    const onCreate = vi.fn();
    render(
      <KeyboardRegistryProvider>
        <Fields onCreate={onCreate} />
      </KeyboardRegistryProvider>,
    );
    await userEvent.keyboard("{Shift>}c{/Shift}");
    expect(onCreate).not.toHaveBeenCalled();
  });
});

/**
 * `j`, `k`, `x` and `e` on a list (UIUX-PLAN §4, the Keyboard row). The rows
 * and their controls are marked, so a list drawn on the server takes the keys
 * without becoming a client component.
 */
function List({
  edit,
  select,
  onTick,
}: {
  readonly edit?: boolean;
  readonly select?: boolean;
  readonly onTick?: (name: string) => void;
}) {
  return (
    <KeyboardList {...(edit ? { edit } : {})} {...(select ? { select } : {})}>
      <ul>
        {["One", "Two", "Three"].map((name) => (
          <li key={name} data-keyboard-row>
            <a href={`/${name}`}>{name}</a>
            <span data-keyboard-edit>
              <input aria-label={`Title of ${name}`} defaultValue={name} />
            </span>
            <input
              type="checkbox"
              aria-label={`Choose ${name}`}
              data-keyboard-select
              onChange={() => onTick?.(name)}
            />
          </li>
        ))}
      </ul>
    </KeyboardList>
  );
}

function renderList(props: Parameters<typeof List>[0] = {}) {
  return render(
    <TranslationsProvider locale="en">
      <KeyboardRegistryProvider>
        <List {...props} />
        <ShortcutOverlay />
      </KeyboardRegistryProvider>
    </TranslationsProvider>,
  );
}

const focused = () => document.activeElement?.textContent ?? "";

describe("KeyboardList", () => {
  test("j moves down the rows and k up, and both stop at the ends", async () => {
    renderList();
    await userEvent.keyboard("j");
    expect(focused()).toBe("One");
    await userEvent.keyboard("jjj");
    expect(focused()).toBe("Three");
    await userEvent.keyboard("k");
    expect(focused()).toBe("Two");
    await userEvent.keyboard("kkk");
    expect(focused()).toBe("One");
  });

  test("starts from the row a pointer put the focus in", async () => {
    renderList();
    screen.getByText("Two").focus();
    await userEvent.keyboard("j");
    expect(focused()).toBe("Three");
  });

  test("e puts the caret in the row's own edit control, where j is a letter again", async () => {
    renderList({ edit: true });
    await userEvent.keyboard("jj");
    await userEvent.keyboard("e");
    expect(document.activeElement).toBe(screen.getByLabelText("Title of Two"));
    await userEvent.keyboard("j");
    expect(document.activeElement).toBe(screen.getByLabelText("Title of Two"));
  });

  test("x chooses the row with the focus", async () => {
    const onTick = vi.fn();
    renderList({ select: true, onTick });
    await userEvent.keyboard("jjx");
    expect(onTick).toHaveBeenCalledWith("Two");
    expect(
      (screen.getByLabelText("Choose Two") as HTMLInputElement).checked,
    ).toBe(true);
  });

  test("offers only the keys it has: no x or e on a list with nothing to choose or edit", async () => {
    renderList();
    await userEvent.keyboard("jx");
    expect(
      (screen.getByLabelText("Choose One") as HTMLInputElement).checked,
    ).toBe(false);
    await userEvent.keyboard("{Shift>}?{/Shift}");
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("Move to the next row");
    expect(dialog.textContent).toContain("Move to the previous row");
    expect(dialog.textContent).not.toContain("Choose the row");
    expect(dialog.textContent).not.toContain("Edit the row");
  });

  test("lists x and e in the overlay where the list has them", async () => {
    renderList({ edit: true, select: true });
    await userEvent.keyboard("{Shift>}?{/Shift}");
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("Choose the row");
    expect(dialog.textContent).toContain("Edit the row");
  });
});

/** What the Rhythm and Practice screens register for their forms' `⌘⏎`. */
function SettingsScreen() {
  const { register, unregister } = useKeyboardRegistry();
  useEffect(() => {
    register({
      id: "form.save",
      keys: "⌘⏎",
      description: "Save the card",
      group: "forms",
    });
    return () => unregister("form.save");
  }, [register, unregister]);
  return null;
}

describe("⌘⏎ in the overlay", () => {
  test("sits under Forms, not under a list or a detail screen", async () => {
    render(
      <TranslationsProvider locale="en">
        <KeyboardRegistryProvider>
          <SettingsScreen />
          <ShortcutOverlay />
        </KeyboardRegistryProvider>
      </TranslationsProvider>,
    );
    await userEvent.keyboard("{Shift>}?{/Shift}");
    const dialog = await screen.findByRole("dialog");
    const headings = [
      ...dialog.querySelectorAll('[data-testid="shortcut-group"]'),
    ].map((one) => one.textContent);
    expect(headings).toEqual(["Global", "Forms"]);
    expect(dialog.textContent).toContain("Save the card");
  });
});
