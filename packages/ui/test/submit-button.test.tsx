import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "../src/components/button.tsx";
import { Spinner } from "../src/components/spinner.tsx";
import { SubmitButton } from "../src/components/submit-button.tsx";

/**
 * A press that the server is still working on says so (UIUX-PLAN §4,
 * "Acting"): the button refuses a second press at once, and a spinner follows
 * after the same 200 milliseconds the bar at the top waits, so a fast answer
 * shows nothing. The refusal is `aria-disabled`, not `disabled`, so the pressed
 * button keeps keyboard focus.
 */

/** Longer than the spinner's 200 ms wait. */
const wait = (ms: number) =>
  act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));

const holdAction = () => {
  let finish: () => void = () => {};
  const action = () =>
    new Promise<void>((resolve) => {
      finish = resolve;
    });
  return { action, done: () => finish() };
};

describe("SubmitButton", () => {
  it("is busy and disabled while its form is being sent, then free again", async () => {
    const { action, done } = holdAction();
    render(
      <form action={action}>
        <SubmitButton>Save</SubmitButton>
      </form>,
    );
    const button = screen.getByRole("button", { name: "Save" });
    expect(button.getAttribute("aria-disabled")).toBeNull();

    await act(async () => {
      fireEvent.click(button);
    });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.getAttribute("aria-busy")).toBe("true");
    await wait(250);
    expect(screen.queryByTestId("button-pending")).not.toBeNull();

    await act(async () => {
      done();
    });
    expect(button.getAttribute("aria-disabled")).toBeNull();
    expect(screen.queryByTestId("button-pending")).toBeNull();
  });
});

describe("Button pending", () => {
  it("refuses a second press at once and shows the spinner after the wait", async () => {
    render(<Button pending>Create</Button>);
    const button = screen.getByRole("button", { name: "Create" });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(screen.queryByTestId("button-pending")).toBeNull();
    await wait(250);
    expect(screen.queryByTestId("button-pending")).not.toBeNull();
  });
});

describe("Button as a submit button", () => {
  it("is busy while its form is being sent, then free again", async () => {
    const { action, done } = holdAction();
    render(
      <form action={action}>
        <Button type="submit">Save</Button>
      </form>,
    );
    const button = screen.getByRole("button", { name: "Save" });
    await act(async () => {
      fireEvent.click(button);
    });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(screen.queryByTestId("button-pending")).toBeNull();
    await wait(250);
    expect(screen.queryByTestId("button-pending")).not.toBeNull();

    await act(async () => {
      done();
    });
    expect(button.getAttribute("aria-disabled")).toBeNull();
    expect(screen.queryByTestId("button-pending")).toBeNull();
  });

  it("never shows the spinner when the server answers within the wait", async () => {
    const { action, done } = holdAction();
    render(
      <form action={action}>
        <Button type="submit">Save</Button>
      </form>,
    );
    const button = screen.getByRole("button", { name: "Save" });
    await act(async () => {
      fireEvent.click(button);
    });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    await act(async () => {
      done();
    });
    await wait(250);
    expect(button.getAttribute("aria-disabled")).toBeNull();
    expect(screen.queryByTestId("button-pending")).toBeNull();
  });

  it("spins only the button that was pressed and disables the other", async () => {
    const { action, done } = holdAction();
    render(
      <form action={action}>
        <Button type="submit">Save</Button>
        <Button type="submit">Reset</Button>
      </form>,
    );
    const save = screen.getByRole("button", { name: "Save" });
    const reset = screen.getByRole("button", { name: "Reset" });
    await act(async () => {
      fireEvent.click(reset);
    });
    expect(reset.getAttribute("aria-disabled")).toBe("true");
    expect(save.getAttribute("aria-disabled")).toBe("true");
    await wait(250);
    expect(
      reset.querySelector("[data-testid='button-pending']"),
    ).not.toBeNull();
    expect(save.querySelector("[data-testid='button-pending']")).toBeNull();
    await act(async () => {
      done();
    });
  });

  it("ignores a button that is not a submit button", async () => {
    const { action, done } = holdAction();
    render(
      <form action={action}>
        <Button type="submit">Save</Button>
        <Button>Cancel</Button>
      </form>,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    await wait(250);
    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect(cancel.querySelector("[data-testid='button-pending']")).toBeNull();
    await act(async () => {
      done();
    });
  });

  it("renders a submit button outside any form without a spinner", async () => {
    render(<Button type="submit">Go</Button>);
    const button = screen.getByRole("button", { name: "Go" });
    expect(button.getAttribute("aria-disabled")).toBeNull();
    await wait(250);
    expect(screen.queryByTestId("button-pending")).toBeNull();
  });

  it("keeps the caller's classes on a bare SubmitButton and still spins", async () => {
    const { action, done } = holdAction();
    render(
      <form action={action}>
        <SubmitButton bare className="mine">
          Save
        </SubmitButton>
      </form>,
    );
    const button = screen.getByRole("button", { name: "Save" });
    expect(button.className).toContain("mine");
    await act(async () => {
      fireEvent.click(button);
    });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(screen.queryByTestId("button-pending")).toBeNull();
    await wait(250);
    expect(screen.queryByTestId("button-pending")).not.toBeNull();
    await act(async () => {
      done();
    });
  });
});

describe("A button refused while the server answers", () => {
  it("keeps keyboard focus, and a second press does not send the form again", async () => {
    let sent = 0;
    let finish: () => void = () => {};
    const action = () => {
      sent += 1;
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    };
    render(
      <form action={action}>
        <Button type="submit">Save</Button>
      </form>,
    );
    const button = screen.getByRole("button", { name: "Save" });
    button.focus();
    await act(async () => {
      fireEvent.click(button);
    });
    expect(sent).toBe(1);
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(document.activeElement).toBe(button);

    await act(async () => {
      fireEvent.click(button);
    });
    expect(sent).toBe(1);

    await act(async () => {
      finish();
    });
    expect(button.getAttribute("aria-disabled")).toBeNull();
  });

  it("does not call the caller's onClick while pending", async () => {
    let clicks = 0;
    render(
      <Button pending onClick={() => (clicks += 1)}>
        Create
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Create" });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    await act(async () => {
      fireEvent.click(button);
    });
    expect(clicks).toBe(0);
  });

  it("ignores a caller's disabled while pending so focus is kept, and honours it after", () => {
    const { rerender } = render(
      <Button pending disabled>
        Create
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Create" });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    rerender(<Button disabled>Create</Button>);
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("still calls onClick when idle, and a disabled button is really disabled", async () => {
    let clicks = 0;
    const { rerender } = render(
      <Button onClick={() => (clicks += 1)}>Go</Button>,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Go" }));
    });
    expect(clicks).toBe(1);

    rerender(
      <Button disabled onClick={() => (clicks += 1)}>
        Go
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Go" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      fireEvent.click(button);
    });
    expect(clicks).toBe(1);
  });

  it("does not send the form again on a second press of a bare SubmitButton", async () => {
    let sent = 0;
    let finish: () => void = () => {};
    const action = () => {
      sent += 1;
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    };
    render(
      <form action={action}>
        <SubmitButton bare>Save</SubmitButton>
      </form>,
    );
    const button = screen.getByRole("button", { name: "Save" });
    await act(async () => {
      fireEvent.click(button);
    });
    await act(async () => {
      fireEvent.click(button);
    });
    expect(sent).toBe(1);
    expect(button.getAttribute("aria-disabled")).toBe("true");
    await act(async () => {
      finish();
    });
    expect(button.getAttribute("aria-disabled")).toBeNull();
  });
});

describe("Spinner", () => {
  it("waits 200 ms like the bar, so a fast save shows nothing", async () => {
    const { unmount } = render(<Spinner />);
    expect(screen.queryByTestId("pending-spinner")).toBeNull();
    await wait(250);
    expect(screen.queryByTestId("pending-spinner")).not.toBeNull();
    unmount();
  });

  it("never shows when it is removed within the wait", async () => {
    const { unmount } = render(<Spinner />);
    unmount();
    await wait(250);
    expect(screen.queryByTestId("pending-spinner")).toBeNull();
  });
});
