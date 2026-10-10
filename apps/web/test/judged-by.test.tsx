// @vitest-environment jsdom
import { TranslationsProvider } from "@openokr/ui";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { JudgedBy } from "../app/kpis/judged-by.tsx";

/**
 * How a KPI is judged (METHOD.md §6.2, guided-inputs §4.8): the green and red
 * values are number fields, and their order is checked as they are typed by
 * the method's own `thresholdsProblem`, which is what the server refuses with.
 */

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render(node: React.ReactNode) {
  await act(async () => {
    root.render(
      <TranslationsProvider locale="en">
        <form>{node}</form>
      </TranslationsProvider>,
    );
  });
}

/** The field a `<label>` with this text names. */
function labelled(text: string): HTMLInputElement {
  const label = [...container.querySelectorAll("label")].find(
    (candidate) => candidate.textContent?.startsWith(text) ?? false,
  );
  const input = label?.htmlFor ? document.getElementById(label.htmlFor) : null;
  if (!(input instanceof HTMLInputElement)) {
    throw new Error(`No field labelled ${text}`);
  }
  return input;
}

async function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const posted = (name: string) =>
  new FormData(container.querySelector("form") as HTMLFormElement).get(name);

describe("how a KPI is judged", () => {
  test("says, as it is typed, that red has to sit below green when higher is better", async () => {
    await render(<JudgedBy idPrefix="add" />);
    await type(labelled("Green at or above"), "90");
    await type(labelled("Red below"), "95");
    expect(container.textContent).toContain(
      "The red value has to be below the green one when higher is better.",
    );

    await type(labelled("Red below"), "80");
    expect(container.textContent).not.toContain("has to be below");
    // The raw numbers are what the form posts, under the names the action
    // reads.
    expect(posted("green")).toBe("90");
    expect(posted("red")).toBe("80");
  });

  test("names both ends of a range's band in full, and their units", async () => {
    await render(
      <JudgedBy
        idPrefix="kpi"
        unit="%"
        initial={{
          targetType: "range",
          greenLow: 99.9,
          greenHigh: 100,
          redLow: null,
          redHigh: null,
        }}
      />,
    );
    expect(labelled("Green from").value).toBe("99.9");
    expect(labelled("Green to").value).toBe("100");
    expect(container.querySelector("label")?.textContent).not.toBe("to");
    expect(container.textContent).toContain("%");
  });
});
