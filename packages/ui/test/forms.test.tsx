import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  UnsavedChangesProvider,
  useUnsavedGuard,
} from "../src/forms/unsaved-changes.tsx";
import { useFormDirty } from "../src/forms/use-form-dirty.ts";
import { useSubmitShortcut } from "../src/forms/use-submit-shortcut.ts";

/**
 * The three pieces a settings form needs to stop losing work (P8-G11).
 *
 * `/admin/rhythm` carried 123 fields under one Save 7,785px below the first of
 * them, nothing in this product warned about unsaved edits, and no form bound
 * the ⌘⏎ that UIUX-PLAN.md §4 lists. These are the parts of that fix which are
 * not specific to one screen.
 */

function Harness({
  onSubmit,
  guard = true,
}: {
  readonly onSubmit?: () => void;
  readonly guard?: boolean;
}) {
  const form = useRef<HTMLFormElement>(null);
  const { dirty, markSaved } = useFormDirty(form);
  const onKeyDown = useSubmitShortcut();
  useUnsavedGuard("harness", guard && dirty);

  return (
    <form
      ref={form}
      onKeyDown={onKeyDown}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit?.();
      }}
    >
      <input aria-label="grace" name="grace" defaultValue="7" />
      <textarea aria-label="notes" name="notes" defaultValue="" />
      <output data-testid="dirty">{dirty ? "dirty" : "clean"}</output>
      <button type="button" onClick={markSaved}>
        Mark saved
      </button>
      <button type="submit">Save</button>
    </form>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useFormDirty", () => {
  test("a form nobody has touched is not dirty", async () => {
    render(<Harness />);
    await waitFor(() =>
      expect(screen.getByTestId("dirty").textContent).toBe("clean"),
    );
  });

  test("typing makes it dirty", async () => {
    render(<Harness />);
    await userEvent.type(screen.getByLabelText("grace"), "5");
    await waitFor(() =>
      expect(screen.getByTestId("dirty").textContent).toBe("dirty"),
    );
  });

  test("typing a value back is not dirty, which a first-keystroke flag cannot tell", async () => {
    // The reason this compares against a snapshot rather than setting a flag.
    // On a screen with 123 fields a flag would fire the leave-guard on most
    // visits, and a guard that cries wolf is one people click through.
    const field = screen.queryByLabelText("grace");
    expect(field).toBeNull();
    render(<Harness />);
    const input = screen.getByLabelText("grace");
    await userEvent.type(input, "5");
    await waitFor(() =>
      expect(screen.getByTestId("dirty").textContent).toBe("dirty"),
    );
    await userEvent.clear(input);
    await userEvent.type(input, "7");
    await waitFor(() =>
      expect(screen.getByTestId("dirty").textContent).toBe("clean"),
    );
  });

  test("marking it saved takes the current values as the baseline", async () => {
    render(<Harness />);
    await userEvent.type(screen.getByLabelText("grace"), "5");
    await waitFor(() =>
      expect(screen.getByTestId("dirty").textContent).toBe("dirty"),
    );
    await userEvent.click(screen.getByRole("button", { name: "Mark saved" }));
    await waitFor(() =>
      expect(screen.getByTestId("dirty").textContent).toBe("clean"),
    );
  });
});

describe("useSubmitShortcut", () => {
  test("⌘⏎ submits the form the caret is in", async () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    screen.getByLabelText("grace").focus();
    await userEvent.keyboard("{Meta>}{Enter}{/Meta}");
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  test("Ctrl+Enter does the same, because either modifier satisfies ⌘", async () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    screen.getByLabelText("grace").focus();
    await userEvent.keyboard("{Control>}{Enter}{/Control}");
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  test("Enter on its own is left to the browser", async () => {
    // Asserted in a textarea, where a bare Enter is a newline and nothing
    // else. A single-input form implicitly submits on Enter, in jsdom as in a
    // browser, so testing the same claim in the text field would be measuring
    // the browser rather than this hook.
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    screen.getByLabelText("notes").focus();
    await userEvent.keyboard("{Enter}");
    expect(onSubmit).not.toHaveBeenCalled();

    // And the modified one still fires from the same field.
    await userEvent.keyboard("{Meta>}{Enter}{/Meta}");
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

describe("UnsavedChangesProvider", () => {
  function Page({ guard }: { readonly guard: boolean }) {
    return (
      <UnsavedChangesProvider message="Leave and lose them?">
        <Harness guard={guard} />
        <a href="/elsewhere">Elsewhere</a>
      </UnsavedChangesProvider>
    );
  }

  test("a link click is asked about while the form holds unsaved work", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<Page guard />);
    await userEvent.type(screen.getByLabelText("grace"), "5");
    await waitFor(() =>
      expect(screen.getByTestId("dirty").textContent).toBe("dirty"),
    );

    await userEvent.click(screen.getByRole("link", { name: "Elsewhere" }));
    expect(confirm).toHaveBeenCalledWith("Leave and lose them?");
  });

  test("answering yes lets the navigation through", async () => {
    // The branch a browser-driven check cannot see cleanly, because the
    // driver's own dialog handler races this one. Asserted on the event
    // instead: saying yes means the click is not cancelled.
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<Page guard />);
    await userEvent.type(screen.getByLabelText("grace"), "5");
    await waitFor(() =>
      expect(screen.getByTestId("dirty").textContent).toBe("dirty"),
    );

    const link = screen.getByRole("link", { name: "Elsewhere" });
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(false);
  });

  test("answering no cancels it", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<Page guard />);
    await userEvent.type(screen.getByLabelText("grace"), "5");
    await waitFor(() =>
      expect(screen.getByTestId("dirty").textContent).toBe("dirty"),
    );

    const link = screen.getByRole("link", { name: "Elsewhere" });
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
  });

  test("a clean form is not asked about", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<Page guard />);
    await waitFor(() =>
      expect(screen.getByTestId("dirty").textContent).toBe("clean"),
    );

    await userEvent.click(screen.getByRole("link", { name: "Elsewhere" }));
    expect(confirm).not.toHaveBeenCalled();
  });

  test("a form that reports nothing leaves the link alone", async () => {
    // The guard is opt-in per form, so a screen that never calls the hook
    // behaves exactly as it did before this existed.
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<Page guard={false} />);
    await userEvent.type(screen.getByLabelText("grace"), "5");

    await userEvent.click(screen.getByRole("link", { name: "Elsewhere" }));
    expect(confirm).not.toHaveBeenCalled();
  });

  test("a form works without a provider, and simply does not guard", async () => {
    // Throwing instead would make the provider a requirement of rendering a
    // form, including in a test and in the component gallery.
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(
      <>
        <Harness />
        <a href="/elsewhere">Elsewhere</a>
      </>,
    );
    await userEvent.type(screen.getByLabelText("grace"), "5");
    await userEvent.click(screen.getByRole("link", { name: "Elsewhere" }));
    expect(confirm).not.toHaveBeenCalled();
  });
});
