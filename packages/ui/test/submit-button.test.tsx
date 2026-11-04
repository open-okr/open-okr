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
