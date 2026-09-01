import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { Avatar, avatarToneFor } from "../src/components/avatar.tsx";
import { Bar } from "../src/components/bar.tsx";
import { Button } from "../src/components/button.tsx";
import { Chip } from "../src/components/chip.tsx";
import { Kbd } from "../src/components/kbd.tsx";
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

  /**
   * This is the assertion the status palette leans on.
   *
   * The dots are deliberately saturated rather than contrast-maximised, and
   * the justification is that WCAG 1.4.11 exempts a graphic whose meaning is
   * carried elsewhere (UIUX-PLAN.md §7). That exemption is only true while
   * the dot really is decorative: hidden from assistive technology, and
   * never the whole content of the chip. If either stops holding, the
   * palette owes 3:1 and the tokens have to change.
   */
  test("the dot is hidden from assistive technology", () => {
    const { container } = render(
      <Chip tone="warn" dot>
        At risk
      </Chip>,
    );
    const dot = container.querySelector("[aria-hidden='true']");
    expect(dot).toBeTruthy();
    // The chip's accessible name comes from the label alone.
    expect(container.textContent).toBe("At risk");
  });

  test("a dot without a label carries no state at all", () => {
    // Not a supported usage, asserted so the failure is loud rather than a
    // silently unlabelled colour. A chip with a dot and no children has no
    // text for anyone to read, which is exactly what rule 4 forbids.
    const { container } = render(<Chip tone="bad" dot />);
    expect(container.textContent).toBe("");
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

describe("Kbd", () => {
  /**
   * The topbar's "⌘K" hint rendered in Consolas while every label beside it
   * rendered in Geist, because `<kbd>` carries a monospace font-family from
   * the UA and Preflight leaves it there. Nothing in the component said
   * otherwise, so the badge was in a typeface the design system never
   * chose. The mockups' own `.kbd` inherits the page's sans.
   */
  test("renders in the interface font, not the browser's monospace default", () => {
    render(<Kbd>K</Kbd>);
    const kbd = screen.getByText("K");
    expect(kbd.className).toContain("font-sans");
  });

  /**
   * U+2318 is absent from the self-hosted Geist subset, so the browser drew
   * it from a system symbol font. Measured in Chrome 151: the fallback glyph
   * took 11.4px of advance against the letter's 6.9px at the same 10.5px
   * size, which is what made "⌘K" read as a large symbol with a small letter
   * stuck to it. `font-size-adjust: ex-height` does not help, and was tried:
   * it applies (computed 0.52) and changes nothing, because a symbol has no
   * x-height to normalise. The glyph has to come from somewhere the design
   * system controls, and §2 says that is Lucide.
   */
  test("draws the command modifier as an icon rather than a font glyph", () => {
    const { container } = render(<Kbd>⌘K</Kbd>);
    const kbd = container.querySelector("kbd");
    expect(kbd).not.toBeNull();
    expect(kbd?.querySelector("svg")).not.toBeNull();
    // The character itself must be gone: leaving it in means the system font
    // still draws it somewhere.
    expect(kbd?.textContent).not.toContain("⌘");
    expect(kbd?.textContent).toContain("K");
  });

  test("the modifier is still announced, so the shortcut is not icon-only", () => {
    render(<Kbd>⌘K</Kbd>);
    expect(screen.getByText("Command")).toBeTruthy();
  });

  test("a key with no modifier gets no icon", () => {
    const { container } = render(<Kbd>Esc</Kbd>);
    expect(container.querySelector("svg")).toBeNull();
  });
});

/**
 * Controls are not cards (mockup `01-work-map`, `.btn { border-radius: 8px }`).
 * `rounded-lg` resolves to --card-radius-lg, 14px, and a 30px-tall control at
 * 14px is a pill: the sign-in screen shipped with pill-shaped inputs and
 * buttons for that reason alone.
 */
describe("control radius", () => {
  test("a button uses the control radius, not the card radius", () => {
    render(<Button>Save</Button>);
    const button = screen.getByRole("button", { name: "Save" });
    expect(button.className).toContain("rounded-control");
    expect(button.className).not.toContain("rounded-lg");
  });
});
