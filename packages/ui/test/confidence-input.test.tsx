import { canonThresholds } from "@openokr/method";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, test } from "vitest";
import { formatConfidence } from "../src/fields/confidence-format.ts";
import { ConfidenceInput } from "../src/fields/confidence-input.tsx";
import { TranslationsProvider } from "../src/i18n/use-translations.tsx";

/**
 * Confidence (docs/design/guided-inputs.md §4.8): stored 0.0 to 1.0 as it
 * always was, and shown the way the workspace's "Confidence shown as"
 * practice setting says (METHOD.md §12), with the §3.2 band beside it.
 */

function inEnglish(children: ReactNode) {
  return render(
    <TranslationsProvider locale="en">{children}</TranslationsProvider>,
  );
}

const posted = (container: HTMLElement, name: string) =>
  new FormData(container.querySelector("form") as HTMLFormElement).get(name);

const thresholds = canonThresholds();

describe("a confidence field", () => {
  test("shows 0.7 as 7 in 10 by default, and posts 0.7", () => {
    const { container } = inEnglish(
      <form>
        <ConfidenceInput
          label="Confidence"
          name="confidence"
          defaultValue={0.7}
        />
      </form>,
    );
    const field = screen.getByLabelText(/Confidence/) as HTMLInputElement;
    expect(field.value).toBe("7");
    expect(screen.getByText("in 10")).not.toBeNull();
    expect(posted(container, "confidence")).toBe("0.7");
  });

  test("in a percent workspace reads 0 to 100%, and stores 70% as 0.7", async () => {
    const user = userEvent.setup();
    const { container } = inEnglish(
      <form>
        <ConfidenceInput
          label="Confidence"
          name="confidence"
          display="percent"
          defaultValue={0.5}
        />
      </form>,
    );
    const field = screen.getByLabelText(/Confidence/) as HTMLInputElement;
    expect(field.value).toBe("50");
    await user.click(field);
    await user.keyboard("{Control>}a{/Control}70");
    await user.tab();
    await waitFor(() => expect(posted(container, "confidence")).toBe("0.7"));
  });

  test("as a decimal is the stored number itself", () => {
    inEnglish(
      <ConfidenceInput
        label="Confidence"
        display="decimal"
        defaultValue={0.4}
      />,
    );
    expect(
      (screen.getByLabelText(/Confidence/) as HTMLInputElement).value,
    ).toBe("0.4");
  });

  test("names its band beside the number, from the workspace's thresholds", () => {
    inEnglish(
      <ConfidenceInput
        label="Confidence"
        defaultValue={0.8}
        thresholds={thresholds}
      />,
    );
    expect(screen.getByText("High")).not.toBeNull();
  });

  test("sends nothing when it is empty", () => {
    const { container } = inEnglish(
      <form>
        <ConfidenceInput label="Confidence" name="confidence" />
      </form>,
    );
    expect(posted(container, "confidence")).toBe("");
  });
});

describe("confidence as text", () => {
  const t = (key: string, values?: Record<string, unknown>) =>
    key === "fields.confidence.outOfTen" ? `${values?.value} in 10` : key;

  test("follows the same setting", () => {
    expect(formatConfidence(0.7, "xIn10", t)).toBe("7 in 10");
    expect(formatConfidence(0.7, "decimal", t)).toBe("0.7");
    expect(formatConfidence(0.7, "percent", t)).toBe("70%");
  });
});
