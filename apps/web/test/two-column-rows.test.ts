import { readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, test } from "vitest";

/**
 * A two-column row keeps two columns (P6-G27b).
 *
 * **This defect shipped three times in one afternoon and the third one broke
 * twenty-two end-to-end cases.** The shape is always the same: a flex row
 * holding a `min-w-0 flex-1` content column and a fixed-width rail, and
 * something appended after the rail. A third child takes its intrinsic width,
 * `min-w-0` lets the content column give up every pixel of it, and the page's
 * own heading collapses towards zero. Playwright reports an element with an
 * empty box as hidden, so it reads as a mystery rather than as a layout bug.
 *
 * P6-G11b did it with the goal page's feed panel; P6-G27b did it with the
 * cycle screen's admin card and again with the document page's files. Each
 * time it cost a full end-to-end run to find.
 *
 * **The rule is narrow on purpose.** A row with three children is often
 * correct: a toolbar, a set of chips, a stat strip, and the cycle screen's own
 * three columns. What is never correct is a *column* row, one holding both a
 * growing column and a fixed-width one, that also holds a child which is
 * neither. Those two are a layout and the third element is in it by accident,
 * which is exactly what a card appended after the closing tag looks like.
 */

const APP = fileURLToPath(new URL("../app", import.meta.url));

const classOf = (node: ts.JsxOpeningLikeElement): string => {
  for (const attribute of node.attributes.properties) {
    if (
      ts.isJsxAttribute(attribute) &&
      ts.isIdentifier(attribute.name) &&
      attribute.name.text === "className" &&
      attribute.initializer !== undefined &&
      ts.isStringLiteral(attribute.initializer)
    ) {
      return attribute.initializer.text;
    }
  }
  return "";
};

const isRow = (classes: string): boolean =>
  /(^|[\s:])flex-row/.test(classes) && /(^|\s)flex(\s|$)/.test(classes);

const grows = (classes: string): boolean => /(^|\s)flex-1(\s|$)/.test(classes);

const fixed = (classes: string): boolean =>
  /(^|\s)(xl:|lg:|md:)?w-\d/.test(classes) && /flex-none/.test(classes);

export interface Overfilled {
  readonly line: number;
  readonly children: number;
}

/** Rows that hold a growing column, a fixed one, and something else. */
function overfilledRows(source: string, fileName: string): Overfilled[] {
  const tree = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const found: Overfilled[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node)) {
      const classes = classOf(node.openingElement);
      if (isRow(classes)) {
        // Direct element children, and the expressions that hold them: a
        // `{flag ? <Card/> : null}` is a child of this row whichever way it
        // resolves, which is exactly how two of the three got in.
        const children = node.children.filter(
          (child) =>
            ts.isJsxElement(child) ||
            ts.isJsxSelfClosingElement(child) ||
            // A `{/* comment */}` is a JsxExpression with no expression at
            // all, which the undefined check already drops.
            (ts.isJsxExpression(child) &&
              child.expression !== undefined &&
              /<[A-Za-z]/.test(child.getText(tree))),
        );
        const columns = children.map((child) =>
          ts.isJsxElement(child)
            ? classOf(child.openingElement)
            : ts.isJsxSelfClosingElement(child)
              ? classOf(child)
              : child.getText(tree),
        );
        const hasGrowing = columns.some(grows);
        const hasFixed = columns.some(fixed);
        // Neither a growing column nor a fixed one: a card that landed in a
        // layout rather than a column of it.
        const strays = columns.filter(
          (one) => !grows(one) && !fixed(one),
        ).length;
        if (hasGrowing && hasFixed && strays > 0) {
          found.push({
            line:
              tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1,
            children: strays,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(tree);
  return found;
}

function everyTsx(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === ".next") {
        continue;
      }
      found.push(...everyTsx(path));
    } else if (entry.name.endsWith(".tsx")) {
      found.push(path);
    }
  }
  return found;
}

describe("the detector", () => {
  test("sees a third child in a two-column row", () => {
    const source = `
      export const A = () => (
        <div className="flex w-full flex-col gap-4.5 xl:flex-row">
          <div className="flex min-w-0 flex-1 flex-col">a</div>
          <div className="flex w-full flex-none flex-col xl:w-80">b</div>
          <Card />
        </div>
      );
    `;
    expect(overfilledRows(source, "a.tsx")).toHaveLength(1);
  });

  test("passes the same row with two", () => {
    const source = `
      export const A = () => (
        <div className="flex w-full flex-col gap-4.5 xl:flex-row">
          <div className="flex min-w-0 flex-1 flex-col">a</div>
          <div className="flex w-full flex-none flex-col xl:w-80">b</div>
        </div>
      );
    `;
    expect(overfilledRows(source, "a.tsx")).toEqual([]);
  });

  test("leaves a real three-column layout alone", () => {
    // The cycle screen: a phase rail, the content, and a guidance rail. Three
    // children and every one of them is a column.
    const source = `
      export const A = () => (
        <div className="flex flex-col gap-4.5 xl:flex-row">
          <div className="w-full flex-none xl:w-72">a</div>
          <div className="flex min-w-0 flex-1 flex-col">b</div>
          <div className="flex w-full flex-none flex-col xl:w-80">c</div>
        </div>
      );
    `;
    expect(overfilledRows(source, "a.tsx")).toEqual([]);
  });

  test("leaves an ordinary row of three alone", () => {
    // A toolbar is not a two-column layout, and this rule is not about it.
    const source = `
      export const A = () => (
        <div className="flex flex-row items-center gap-2">
          <Button />
          <Button />
          <Button />
        </div>
      );
    `;
    expect(overfilledRows(source, "a.tsx")).toEqual([]);
  });

  test("sees a conditional child, which is how two of the three got in", () => {
    const source = `
      export const A = () => (
        <div className="flex w-full flex-col gap-4.5 xl:flex-row">
          <div className="flex min-w-0 flex-1 flex-col">a</div>
          <div className="flex w-full flex-none flex-col xl:w-80">b</div>
          {canPublish ? <Card /> : null}
        </div>
      );
    `;
    expect(overfilledRows(source, "a.tsx")).toHaveLength(1);
  });
});

describe("every page", () => {
  test("keeps its two-column rows at two columns", () => {
    const offenders = everyTsx(APP).flatMap((path) =>
      overfilledRows(readFileSync(path, "utf8"), path).map(
        (row) =>
          `${path
            .slice(APP.length + 1)
            .split(sep)
            .join("/")}:${row.line} has ${row.children} children`,
      ),
    );
    expect(offenders).toEqual([]);
  });
});
