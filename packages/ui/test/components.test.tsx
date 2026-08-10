import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { Avatar, avatarToneFor } from "../src/components/avatar.tsx";
import { Bar } from "../src/components/bar.tsx";
import { Button } from "../src/components/button.tsx";
import { Chip } from "../src/components/chip.tsx";
import { VerdictDot } from "../src/components/verdict-dot.tsx";

describe("Button", () => {
  test("renders a native, keyboard-operable button by default", () => {
    render(<Button>Save</Button>);
    const button = screen.getByRole("button", { name: "Save" });
    expect(button.getAttribute("type")).toBe("button");
  });

  test("disabled state is a real disabled attribute, not just a style", () => {
    render(<Button disabled>Save</Button>);
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});

describe("Chip", () => {
  test("colour is never the only signal: the dot is decorative, the label is real text", () => {
    render(
      <Chip tone="ok" dot>
        On track
      </Chip>,
    );
    expect(screen.getByText("On track")).toBeTruthy();
  });
});

describe("Bar", () => {
  test("exposes its value through ARIA, not only a visual width", () => {
    render(<Bar value={72} />);
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("72");
  });

  test("clamps out-of-range values instead of overflowing", () => {
    render(<Bar value={140} />);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(
      "100",
    );
  });
});

describe("VerdictDot", () => {
  test("carries an accessible label, since it is otherwise colour-only", () => {
    render(<VerdictDot state="fail" />);
    expect(screen.getByRole("img", { name: "Fail" })).toBeTruthy();
  });
});

describe("Avatar", () => {
  test("falls back to initials with no image", () => {
    render(<Avatar name="Ada Lovelace" />);
    expect(screen.getByText("AL")).toBeTruthy();
  });

  test("avatarToneFor is deterministic for the same name", () => {
    expect(avatarToneFor("Ada Lovelace")).toBe(avatarToneFor("Ada Lovelace"));
  });
});
