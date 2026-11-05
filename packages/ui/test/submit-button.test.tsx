import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "../src/components/button.tsx";
import { SubmitButton } from "../src/components/submit-button.tsx";

/**
 * A press that the server is still working on says so (UIUX-PLAN §4,
 * "Acting"): a spinner, and a button that cannot be pressed twice.
 */

describe("SubmitButton", () => {
  it("is busy and disabled while its form is being sent, then free again", async () => {
    let finish: () => void = () => {};
    const action = () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      });
    render(
      <form action={action}>
        <SubmitButton>Save</SubmitButton>
      </form>,
    );
    const button = screen.getByRole("button", { name: "Save" });
    expect((button as HTMLButtonElement).disabled).toBe(false);

    await act(async () => {
      fireEvent.click(button);
    });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(screen.queryByTestId("button-pending")).not.toBeNull();

    await act(async () => {
      finish();
    });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByTestId("button-pending")).toBeNull();
  });
});

describe("Button pending", () => {
  it("shows the spinner and refuses a second press", () => {
    render(<Button pending>Create</Button>);
    const button = screen.getByRole("button", { name: "Create" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByTestId("button-pending")).not.toBeNull();
  });
});

describe("Button as a submit button", () => {
  const holdAction = () => {
    let finish: () => void = () => {};
    const action = () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      });
    return { action, done: () => finish() };
  };

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
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(screen.queryByTestId("button-pending")).not.toBeNull();

    await act(async () => {
      done();
    });
    expect((button as HTMLButtonElement).disabled).toBe(false);
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
    expect((reset as HTMLButtonElement).disabled).toBe(true);
    expect((save as HTMLButtonElement).disabled).toBe(true);
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
    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect(cancel.querySelector("[data-testid='button-pending']")).toBeNull();
    await act(async () => {
      done();
    });
  });

  it("renders a submit button outside any form without a spinner", () => {
    render(<Button type="submit">Go</Button>);
    const button = screen.getByRole("button", { name: "Go" });
    expect((button as HTMLButtonElement).disabled).toBe(false);
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
    expect(screen.queryByTestId("button-pending")).not.toBeNull();
    await act(async () => {
      done();
    });
  });
});
