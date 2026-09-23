import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ToastProvider, useToast } from "../src/feedback/toast.tsx";

/**
 * Messages that find the reader (P8-G11a).
 *
 * UIUX-PLAN.md has specified toasts in four places since the interface was
 * designed and none existed, which is how a save refusal on `/admin/rhythm`
 * could render above the fold of a 1,700px card and be invisible to the person
 * who had just pressed Save.
 */

function Raiser() {
  const { show } = useToast();
  return (
    <div>
      <button
        type="button"
        onClick={() => show({ tone: "ok", message: "Saved." })}
      >
        Confirm
      </button>
      <button
        type="button"
        onClick={() =>
          show({
            tone: "bad",
            title: "Confidence and scoring",
            message: "scoring.progressCeilingPct: Too big.",
          })
        }
      >
        Refuse
      </button>
    </div>
  );
}

const renderToasts = () =>
  render(
    <ToastProvider dismissLabel="Dismiss">
      <Raiser />
    </ToastProvider>,
  );

afterEach(() => {
  vi.useRealTimers();
});

describe("ToastProvider", () => {
  test("a confirmation appears", async () => {
    renderToasts();
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByTestId("toast")).toHaveProperty("dataset");
    expect(screen.getByTestId("toast").textContent).toContain("Saved.");
  });

  test("a refusal carries its title and its sentence", async () => {
    renderToasts();
    await userEvent.click(screen.getByRole("button", { name: "Refuse" }));
    const toast = await screen.findByTestId("toast");
    expect(toast.dataset.tone).toBe("bad");
    expect(toast.textContent).toContain("Confidence and scoring");
    expect(toast.textContent).toContain("scoring.progressCeilingPct");
  });

  test("both live regions exist before anything is raised", () => {
    // A live region created in the same commit as its text is not reliably
    // announced, which is the most common way a toast ends up silent.
    renderToasts();
    expect(screen.getByTestId("toast-region-status")).toBeDefined();
    expect(screen.getByTestId("toast-region-alert")).toBeDefined();
  });

  test("and they take no role, so they are invisible to getByRole", () => {
    // **The regions are on every page from first paint.** Giving them
    // `role="status"` and `role="alert"` put two permanently empty matches
    // into every `getByRole("status")` on the site, and four existing specs
    // went red on screens with no toast in them. `aria-live` is the part that
    // does the work; the role only restated it.
    renderToasts();
    expect(screen.queryAllByRole("status")).toHaveLength(0);
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
  });

  test("a confirmation is polite and a refusal interrupts", () => {
    renderToasts();
    expect(
      screen.getByTestId("toast-region-status").getAttribute("aria-live"),
    ).toBe("polite");
    expect(
      screen.getByTestId("toast-region-alert").getAttribute("aria-live"),
    ).toBe("assertive");
  });

  test("a confirmation clears itself after the six second window", () => {
    // `fireEvent` rather than `userEvent` in the two timer tests. userEvent
    // waits on its own timers, which the fake clock also owns, so the two sit
    // waiting for each other and the test times out rather than failing.
    vi.useFakeTimers();
    renderToasts();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(screen.getAllByTestId("toast")).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(6_000);
    });
    expect(screen.queryAllByTestId("toast")).toHaveLength(0);
  });

  test("a refusal runs longer than a confirmation, then clears too", () => {
    // Agung asked for both to close on their own. A refusal gets the longer
    // window because it carries a key and a bound and the reader has to look
    // away from it to find the field; it is safe to let it go because the
    // caller also marks that field and prints the sentence under it.
    vi.useFakeTimers();
    renderToasts();
    fireEvent.click(screen.getByRole("button", { name: "Refuse" }));

    act(() => {
      vi.advanceTimersByTime(6_000);
    });
    expect(screen.getAllByTestId("toast")).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(9_000);
    });
    expect(screen.queryAllByTestId("toast")).toHaveLength(0);
  });

  test("it can be dismissed by hand", async () => {
    renderToasts();
    await userEvent.click(screen.getByRole("button", { name: "Refuse" }));
    await screen.findByTestId("toast");

    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await waitFor(() =>
      expect(screen.queryAllByTestId("toast")).toHaveLength(0),
    );
  });

  test("several stack rather than replacing one another", async () => {
    renderToasts();
    await userEvent.click(screen.getByRole("button", { name: "Refuse" }));
    await userEvent.click(screen.getByRole("button", { name: "Refuse" }));
    await waitFor(() => expect(screen.getAllByTestId("toast")).toHaveLength(2));
  });

  test("a second toast from the same source replaces the first", async () => {
    // Without this a refusal outlives what it was about: it stays until
    // dismissed, so somebody who reads it, fixes the value and saves again is
    // left looking at the old refusal beside the new confirmation.
    function Sourced() {
      const { show } = useToast();
      return (
        <div>
          <button
            type="button"
            onClick={() =>
              show({ tone: "bad", message: "Too big.", source: "cadence" })
            }
          >
            Refuse
          </button>
          <button
            type="button"
            onClick={() =>
              show({ tone: "ok", message: "Saved.", source: "cadence" })
            }
          >
            Confirm
          </button>
        </div>
      );
    }
    render(
      <ToastProvider dismissLabel="Dismiss">
        <Sourced />
      </ToastProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Refuse" }));
    await waitFor(() => expect(screen.getAllByTestId("toast")).toHaveLength(1));

    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => {
      const toasts = screen.getAllByTestId("toast");
      expect(toasts).toHaveLength(1);
      expect(toasts[0]?.textContent).toContain("Saved.");
    });
  });

  test("a component without a provider still renders, and raises nothing", async () => {
    // Throwing instead would make the provider a requirement of rendering any
    // component that might one day want to say something.
    render(<Raiser />);
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(screen.queryAllByTestId("toast")).toHaveLength(0);
  });
});
