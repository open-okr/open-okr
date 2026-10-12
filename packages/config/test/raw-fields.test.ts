import { describe, expect, it } from "vitest";
import { countRawFields, rawFieldFindings } from "../src/raw-fields.ts";

/**
 * The raw-field gate (docs/design/guided-inputs.md §6): what counts as a
 * field the kit should draw, and that a screen drawing one is refused.
 */

describe("counting raw fields", () => {
  it("counts a text input, a textarea and a select", () => {
    const source = `
      <input name="title" />
      <textarea name="note"></textarea>
      <select name="owner"><option /></select>
    `;
    expect(countRawFields(source)).toBe(3);
  });

  it("leaves out the inputs that are not a typed or picked value", () => {
    const source = `
      <input type="hidden" name="id" value={id} />
      <input type="checkbox" name="done" />
      <input type="radio" name="kind" />
      <input type="file" accept="image/*" />
      <input type="submit" value="Go" />
    `;
    expect(countRawFields(source)).toBe(0);
  });

  it("counts the typed kinds: email, number, date, time, range", () => {
    const source = `
      <input type="email" />
      <input type="number" step="any" />
      <input type="date" />
      <input type="time" />
      <input type="range" min="0" max="1" />
    `;
    expect(countRawFields(source)).toBe(5);
  });

  it("reads a tag split over lines, with an arrow function inside it", () => {
    // The `>` of the arrow is not the end of the tag, and the type after it
    // is still this tag's.
    const source = `
      <input
        onChange={(event) => setValue(event.target.value > 0 ? 1 : 0)}
        type="hidden"
        name="id"
      />
    `;
    expect(countRawFields(source)).toBe(0);
  });

  it("counts an input whose type is computed, because it is a field either way", () => {
    expect(countRawFields(`<input type={shown ? "text" : "password"} />`)).toBe(
      1,
    );
    expect(countRawFields(`<input type={"hidden"} />`)).toBe(0);
  });

  it("does not count a field written in a comment or a string", () => {
    const source = `
      /** Draws its own \`<input>\` because the kit had none (see <input />). */
      const note = "<textarea> is a raw field";
      // <select name="x"></select>
      export const Screen = () => <p>{note}</p>;
    `;
    expect(countRawFields(source)).toBe(0);
  });

  it("does not mistake a component for the element", () => {
    const source = `<Input /> <InputGroup /> <inputs /> <TextInput label="x" />`;
    expect(countRawFields(source)).toBe(0);
  });
});

describe("holding every screen to the kit", () => {
  it("passes a screen that draws none", () => {
    expect(rawFieldFindings(new Map([["a.tsx", 0]]))).toEqual([]);
    expect(rawFieldFindings(new Map())).toEqual([]);
  });

  it("refuses any screen that draws one, and says where the kit is", () => {
    const findings = rawFieldFindings(
      new Map([
        ["b.tsx", 2],
        ["a.tsx", 1],
      ]),
    );
    expect(findings.map((finding) => finding.path)).toEqual(["a.tsx", "b.tsx"]);
    expect(findings[1]?.message).toContain("draws 2 raw field(s)");
    expect(findings[1]?.message).toContain("packages/ui");
  });
});
