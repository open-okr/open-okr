/**
 * Puts split sentences back together (P6-G22d-b).
 *
 * **The codemod that made the mess could not have avoided it.** P6-G22c moved
 * 1,543 strings into the catalogue and `translate` took a key and nothing
 * else, so a sentence with a value in the middle of it had to become an entry
 * on either side of the value. P6-G22d-a gave a message named holes. This puts
 * the sentences back.
 *
 * **It rewrites only what it can read whole.** A run of JSX children is
 * rewritten when every child in it is a message, a value, or the whitespace
 * between them. Anything else in the run, a nested element, a conditional that
 * renders text, a message that already carries values, and the run is left
 * alone and reported. Emptying the list is the job; guessing is not.
 *
 * Run with `--write` to apply. Without it, it reports what it would do.
 */
import {
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/**
 * The checkout, found rather than assumed.
 *
 * This script needs `typescript`, which resolves from a package that depends
 * on it rather than from the root, so it is run from a copy inside one. Walking
 * up to the workspace file means the copy reads the same catalogue as the
 * original.
 */
function repoRoot(): string {
  let dir = fileURLToPath(new URL(".", import.meta.url));
  for (let up = 0; up < 6; up += 1) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = join(dir, "..");
  }
  throw new Error("This is not inside an OpenOKR checkout.");
}

const ROOT = repoRoot();
const EN = join(ROOT, "packages/ui/src/i18n/messages/en.json");
const MS = join(ROOT, "packages/ui/src/i18n/messages/ms.json");

type Catalogue = Record<string, string>;

const read = (path: string): Catalogue =>
  JSON.parse(readFileSync(path, "utf8")) as Catalogue;

const writeCatalogue = (path: string, value: Catalogue): void => {
  const sorted: Catalogue = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = value[key] as string;
  }
  writeFileSync(path, `${JSON.stringify(sorted, null, 2)}\n`);
};

/** Every .tsx under a directory. */
function everyTsx(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === ".next" || entry.name === "node_modules") continue;
      everyTsx(path, found);
    } else if (entry.name.endsWith(".tsx")) {
      found.push(path);
    }
  }
  return found;
}

/** The catalogue key this child renders, if it renders exactly one and no values. */
function keyOf(child: ts.JsxChild): string | null {
  if (!ts.isJsxExpression(child) || child.expression === undefined) return null;
  const call = child.expression;
  if (
    !ts.isCallExpression(call) ||
    !ts.isIdentifier(call.expression) ||
    call.expression.text !== "t" ||
    // A message that already carries values is one this has done, or one
    // somebody wrote by hand. Either way it is already whole.
    call.arguments.length !== 1
  ) {
    return null;
  }
  const first = call.arguments[0];
  return first !== undefined && ts.isStringLiteral(first) ? first.text : null;
}

/**
 * What JSX text actually puts on the screen.
 *
 * **A line break is not a space, and assuming it was cost six end-to-end
 * failures.** JSX drops whitespace that contains a newline: `{a}\n  {b}` puts
 * `ab` on screen, which is exactly why this codebase writes `{" "}` when it
 * wants a space. Collapsing every whitespace run to one space instead inserted
 * spaces the screen never had, and turned "Tasks (3 of 4 done)" into
 * "Tasks ( 3 of 4 done)".
 *
 * The rule is the one the compiler applies: trim each line except the first at
 * its start and each except the last at its end, drop what is then empty, and
 * join the rest with a single space. Text with no newline in it is left alone.
 */
function renderedText(raw: string): string {
  if (!raw.includes("\n")) {
    return raw;
  }
  const lines = raw.split("\n");
  return lines
    .map((line, index) => {
      const head = index === 0 ? line : line.replace(/^\s+/, "");
      return index === lines.length - 1 ? head : head.replace(/\s+$/, "");
    })
    .filter((line) => line !== "")
    .join(" ");
}

/**
 * The literal text a child contributes to the sentence, or null.
 *
 * **Punctuation between two messages counts.** The catalogue gate refuses
 * prose written outside the catalogue, so a bare text child here is a bracket,
 * a comma or a middle dot, and it is part of the sentence a translator reads.
 * Leaving it outside produced "The workspace's ( {value}" with the closing
 * bracket stranded in the JSX.
 *
 * `{" "}` is included for the same reason: it is how the formatter keeps a
 * space the JSX would otherwise eat.
 */
function literal(child: ts.JsxChild): string | null {
  if (ts.isJsxText(child)) {
    return renderedText(child.text);
  }
  if (
    ts.isJsxExpression(child) &&
    child.expression !== undefined &&
    ts.isStringLiteral(child.expression) &&
    child.expression.text.trim() === ""
  ) {
    return child.expression.text === "" ? "" : " ";
  }
  return null;
}

/** Whether a child is only the whitespace between two others. */
const isGap = (child: ts.JsxChild): boolean => {
  const text = literal(child);
  return text !== null && text.trim() === "";
};

/** A value: any other expression, as long as it renders one thing. */
function valueOf(child: ts.JsxChild, source: ts.SourceFile): string | null {
  if (!ts.isJsxExpression(child) || child.expression === undefined) return null;
  if (keyOf(child) !== null) return null;
  // **Rendered markup is not a value.** A conditional that picks between two
  // words is, and the first version of this rejected those too by looking for
  // a bare angle bracket, which is also what a comparison is written with: it
  // left four sentences split for no reason. The tree is asked instead.
  let hasMarkup = false;
  const look = (node: ts.Node): void => {
    if (
      ts.isJsxElement(node) ||
      ts.isJsxSelfClosingElement(node) ||
      ts.isJsxFragment(node)
    ) {
      hasMarkup = true;
    }
    ts.forEachChild(node, look);
  };
  look(child.expression);
  if (hasMarkup) return null;
  return child.expression.getText(source);
}

/** Identifiers that say how a value was turned into a string, not what it is. */
const PLUMBING = new Set([
  "join",
  "toFixed",
  "toString",
  "toLocaleString",
  "toUpperCase",
  "toLowerCase",
  "padStart",
  "padEnd",
  "trim",
  "map",
  "filter",
  "slice",
  "keys",
  "values",
]);

/** A hole name from the expression that fills it. */
function holeName(
  expression: string,
  taken: Map<string, string>,
): string {
  // **The same expression is the same hole.** Naming it twice handed a
  // translator `{low}` and `{low2}` for one number, and a rule they have to
  // keep: fill both with the same thing or the sentence lies.
  const already = taken.get(expression);
  if (already !== undefined) {
    return already;
  }
  const parts = (expression.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) ?? []).filter(
    (one) => one.length > 1,
  );
  // The last identifier names the thing, unless it names how the thing was
  // turned into a string: `token.scopes.join(", ")` is about scopes.
  while (parts.length > 1 && PLUMBING.has(parts[parts.length - 1] as string)) {
    parts.pop();
  }
  const last = parts.pop() ?? "value";
  let name = last.replace(/[^A-Za-z0-9]/g, "");
  if (name === "" || /^[0-9]/.test(name)) name = "value";
  let candidate = name;
  let n = 2;
  const used = new Set(taken.values());
  while (used.has(candidate)) {
    candidate = `${name}${n}`;
    n += 1;
  }
  taken.set(expression, candidate);
  return candidate;
}

/** The key a combined sentence gets: the screen's prefix, the sentence's words. */
function keyFor(
  firstKey: string,
  sentence: string,
  catalogue: Catalogue,
): string {
  const prefix = firstKey.slice(0, firstKey.lastIndexOf("."));
  const words = sentence
    .replace(/\{[A-Za-z][A-Za-z0-9]*\}/g, " ")
    .replace(/[^A-Za-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5);
  const camel = words
    .map((word, index) =>
      index === 0
        ? word.toLowerCase()
        : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
    )
    .join("");
  const base = `${prefix}.${camel || "message"}`;
  let candidate = base;
  let n = 2;
  while (catalogue[candidate] !== undefined) {
    candidate = `${base}${n}`;
    n += 1;
  }
  return candidate;
}

interface Rewrite {
  readonly start: number;
  readonly end: number;
  readonly replacement: string;
  readonly newKey: string;
  readonly english: string;
  readonly malay: string;
  readonly retired: readonly string[];
}

/** Finds every run this can read whole, in one file. */
function rewritesFor(
  path: string,
  source: string,
  en: Catalogue,
  ms: Catalogue,
  claimed: Catalogue,
): { rewrites: Rewrite[]; skipped: string[] } {
  const tree = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const rewrites: Rewrite[] = [];
  const skipped: string[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
      const children = [...node.children];
      let index = 0;
      while (index < children.length) {
        const run: ts.JsxChild[] = [];
        let messages = 0;
        let values = 0;
        let readable = true;
        let cursor = index;
        while (cursor < children.length) {
          const child = children[cursor];
          if (child === undefined) break;
          if (literal(child) !== null) {
            // Leading whitespace belongs to the JSX, not to the sentence.
            if (run.length === 0) {
              index = cursor + 1;
              cursor += 1;
              continue;
            }
            run.push(child);
            cursor += 1;
            continue;
          }
          if (keyOf(child) !== null) {
            run.push(child);
            messages += 1;
            cursor += 1;
            continue;
          }
          if (valueOf(child, tree) !== null) {
            // **A run may start with a value**, and the first pass was wrong
            // to refuse it. "· expires" is a fragment precisely because the
            // thing it hangs off sits in front of it, so leaving that outside
            // produces a message that still begins mid-sentence.
            run.push(child);
            values += 1;
            cursor += 1;
            continue;
          }
          // Anything else ends the run, and makes it unreadable if it sat
          // between a message and a value.
          if (messages > 0 && values > 0) break;
          readable = messages === 0 || values === 0;
          break;
        }

        // Trim the whitespace at either end: it belongs to the JSX, not to
        // the sentence.
        while (
          run.length > 0 &&
          isGap(run[run.length - 1] as ts.JsxChild)
        ) {
          run.pop();
        }
        while (run.length > 0 && isGap(run[0] as ts.JsxChild)) {
          run.shift();
        }

        if (messages >= 1 && values >= 1 && run.length >= 2) {
          if (!readable) {
            skipped.push(`${path}: a run this cannot read whole`);
          } else {
            const taken = new Map<string, string>();
            let english = "";
            let malay = "";
            const holes: string[] = [];
            const retired: string[] = [];
            let ok = true;
            for (const child of run) {
              const gap = literal(child);
              if (gap !== null) {
                english += gap;
                malay += gap;
                continue;
              }
              const key = keyOf(child);
              if (key !== null) {
                const value = en[key];
                if (value === undefined) {
                  ok = false;
                  break;
                }
                english += value;
                malay += ms[key] ?? value;
                retired.push(key);
                continue;
              }
              const expression = valueOf(child, tree) as string;
              const seen = taken.has(expression);
              const name = holeName(expression, taken);
              english += `{${name}}`;
              malay += `{${name}}`;
              if (!seen) {
                holes.push(
                  expression === name ? name : `${name}: ${expression}`,
                );
              }
            }

            if (ok && retired[0] !== undefined) {
              const first = run.find((child) => keyOf(child) !== null);
              const firstKey = keyOf(first as ts.JsxChild) as string;
              // Collapse the whitespace a JSX line break left in the middle of
              // a sentence.
              english = english.replace(/\s+/g, " ").trim();
              malay = malay.replace(/\s+/g, " ").trim();
              const newKey = keyFor(firstKey, english, { ...en, ...claimed });
              claimed[newKey] = english;
              rewrites.push({
                start: (run[0] as ts.JsxChild).getStart(tree),
                end: (run[run.length - 1] as ts.JsxChild).getEnd(),
                replacement: `{t("${newKey}", { ${holes.join(", ")} })}`,
                newKey,
                english,
                malay,
                retired,
              });
            }
          }
        }
        index = cursor > index ? cursor : index + 1;
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(tree);
  return { rewrites, skipped };
}

function main(): void {
  const write = process.argv.includes("--write");
  const en = read(EN);
  const ms = read(MS);
  const claimed: Catalogue = {};
  const files = [
    ...everyTsx(join(ROOT, "apps/web/app")),
    ...everyTsx(join(ROOT, "packages/ui/src")),
  ];

  let changedFiles = 0;
  let runs = 0;
  const retiredAll = new Set<string>();
  const skippedAll: string[] = [];

  for (const path of files) {
    const source = readFileSync(path, "utf8");
    const { rewrites, skipped } = rewritesFor(path, source, en, ms, claimed);
    skippedAll.push(...skipped);
    if (rewrites.length === 0) continue;
    changedFiles += 1;
    runs += rewrites.length;

    let next = source;
    for (const rewrite of [...rewrites].sort((a, b) => b.start - a.start)) {
      next =
        next.slice(0, rewrite.start) +
        rewrite.replacement +
        next.slice(rewrite.end);
      en[rewrite.newKey] = rewrite.english;
      ms[rewrite.newKey] = rewrite.malay;
      for (const key of rewrite.retired) retiredAll.add(key);
    }
    if (write) writeFileSync(path, next);
  }

  // A retired key that something else still renders stays.
  const allSource = files.map((path) => readFileSync(path, "utf8")).join("\n");
  let removed = 0;
  for (const key of retiredAll) {
    if (allSource.includes(`"${key}"`)) continue;
    delete en[key];
    delete ms[key];
    removed += 1;
  }

  if (write) {
    writeCatalogue(EN, en);
    writeCatalogue(MS, ms);
  }

  process.stdout.write(
    `${runs} run(s) in ${changedFiles} file(s), ${removed} key(s) retired, ` +
      `${skippedAll.length} left for a person.\n`,
  );
  for (const one of skippedAll.slice(0, 20)) {
    process.stdout.write(`  ${one}\n`);
  }
}

main();
