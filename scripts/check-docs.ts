#!/usr/bin/env node
/**
 * The documentation gate (P8-T11a).
 *
 * Documentation rots in three specific ways, and each one is worse than being
 * out of date because each one is invisible to the person who caused it:
 *
 *  - a link points at a page nobody wrote, or at one somebody renamed;
 *  - a page exists and the index never names it, so nobody finds it;
 *  - an instruction names a command that does not exist.
 *
 * All three are checkable, so none of them is left to review. This does for
 * `docs/` what `check:air-gap` does for the air-gap guide and `method:check`
 * does for METHOD.md: the document is compared against the thing it describes,
 * in both directions.
 *
 * Two more things are checked, because both are claims about the product
 * rather than prose: every threshold the handbook quotes has to match the
 * method registry it came from, and the generated API reference has to match
 * the contract. A handbook quoting a number nobody uses is worse than one that
 * quotes none.
 *
 * **The plan set is out of scope on purpose.** `docs/development-plan/`,
 * `docs/design/` and `docs/stakeholder/` are working papers between the people
 * building this, not pages a reader is sent to, and they cross-reference each
 * other in ways an index would fight rather than help.
 */
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  "$1",
);

/** The trees this gate owns. Everything else under `docs/` is working papers. */
const OWNED = [
  "docs/install",
  "docs/admin",
  "docs/runbooks",
  "docs/api",
  "docs/handbook",
  "docs/use",
  "docs/import",
];
const INDEX = "docs/README.md";

/** Working papers, linked from the index but not indexed page by page. */
const NOT_INDEXED_PAGE_BY_PAGE = [
  "docs/development-plan",
  "docs/design",
  "docs/stakeholder",
];

const posix = (path: string): string => path.replace(/\\/g, "/");

async function markdownUnder(dir: string): Promise<string[]> {
  const found: string[] = [];
  let entries: Awaited<ReturnType<typeof readdir>>;
  try {
    entries = await readdir(join(ROOT, dir), { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      found.push(...(await markdownUnder(path)));
    } else if (entry.name.endsWith(".md")) {
      found.push(path);
    }
  }
  return found;
}

/** Every `[text](target)` in a file, ignoring code fences. */
function linksIn(source: string): { target: string; line: number }[] {
  const links: { target: string; line: number }[] = [];
  let inFence = false;
  source.split("\n").forEach((line, index) => {
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      return;
    }
    if (inFence) {
      return;
    }
    for (const match of line.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      links.push({ target: match[1] as string, line: index + 1 });
    }
  });
  return links;
}

/** Every `pnpm <script>` a page tells somebody to run. */
function pnpmCommandsIn(source: string): { script: string; line: number }[] {
  const commands: { script: string; line: number }[] = [];
  source.split("\n").forEach((line, index) => {
    for (const match of line.matchAll(/\bpnpm ([a-z][a-z0-9:-]*)/g)) {
      const script = match[1] as string;
      // Package-manager verbs of its own, not this repository's scripts.
      if (["install", "add", "remove", "exec", "dlx", "why"].includes(script)) {
        continue;
      }
      commands.push({ script, line: index + 1 });
    }
  });
  return commands;
}

const problems: string[] = [];

const pages: string[] = [INDEX];
for (const tree of OWNED) {
  pages.push(...(await markdownUnder(tree)));
}

const scripts = new Set(
  Object.keys(
    JSON.parse(await readFile(join(ROOT, "package.json"), "utf8")).scripts ?? {},
  ),
);

// 1. Every link resolves.
const linkedFromIndex = new Set<string>();
for (const page of pages) {
  const source = await readFile(join(ROOT, page), "utf8");
  for (const { target, line } of linksIn(source)) {
    if (/^(https?:|mailto:|#)/.test(target)) {
      continue;
    }
    const [path] = target.split("#") as [string];
    if (path === "") {
      continue;
    }
    const resolved = posix(
      relative(ROOT, resolve(join(ROOT, dirname(page)), path)),
    );
    if (page === INDEX) {
      linkedFromIndex.add(resolved.replace(/\/$/, ""));
    }
    try {
      await readdir(join(ROOT, resolved));
      continue; // a directory, which is a fine link target
    } catch {
      // not a directory, so it must be a file
    }
    try {
      await readFile(join(ROOT, resolved));
    } catch {
      problems.push(`${page}:${line} links to ${target}, which does not exist`);
    }
  }

  // 2. Every command it tells somebody to run exists.
  for (const { script, line } of pnpmCommandsIn(source)) {
    if (!scripts.has(script)) {
      problems.push(
        `${page}:${line} says to run \`pnpm ${script}\`, which package.json does not define`,
      );
    }
  }
}

// 3. Every page is reachable from the index, directly or from a page it names.
const reachable = new Set<string>([INDEX]);
const queue = [INDEX];
while (queue.length > 0) {
  const page = queue.shift() as string;
  const source = await readFile(join(ROOT, page), "utf8");
  for (const { target } of linksIn(source)) {
    if (/^(https?:|mailto:|#)/.test(target)) {
      continue;
    }
    const [path] = target.split("#") as [string];
    const resolved = posix(
      relative(ROOT, resolve(join(ROOT, dirname(page)), path)),
    );
    if (
      resolved.endsWith(".md") &&
      pages.includes(resolved) &&
      !reachable.has(resolved)
    ) {
      reachable.add(resolved);
      queue.push(resolved);
    }
  }
}

for (const page of pages) {
  if (
    !reachable.has(page) &&
    !NOT_INDEXED_PAGE_BY_PAGE.some((tree) => page.startsWith(tree))
  ) {
    problems.push(
      `${page} exists and nothing in docs/README.md leads to it, so nobody will find it`,
    );
  }
}

// 4. Every threshold the handbook quotes matches the method registry.
//
// The handbook's numbers page is a table of `key | value | section` rows. A
// row naming a key the registry does not hold, or holding a value the registry
// disagrees with, is a page telling a practitioner something the product does
// not do.
const NUMBERS = "docs/handbook/numbers.md";
try {
  const page = await readFile(join(ROOT, NUMBERS), "utf8");
  const { THRESHOLDS } = await import(
    `file://${join(ROOT, "packages/method/src/thresholds.ts")}`
  );
  const registry = THRESHOLDS as Record<string, { default: unknown }>;

  let quoted = 0;
  page.split("\n").forEach((line, index) => {
    const row = /^\|\s*`([a-z]+\.[A-Za-z]+)`\s*\|\s*([^|]+?)\s*\|/.exec(line);
    if (!row) {
      return;
    }
    const [, key, value] = row as unknown as [string, string, string];
    const entry = registry[key];
    if (!entry) {
      problems.push(
        `${NUMBERS}:${index + 1} quotes \`${key}\`, which the method registry does not hold`,
      );
      return;
    }
    quoted += 1;
    const actual = String(entry.default);
    if (actual !== value) {
      problems.push(
        `${NUMBERS}:${index + 1} says \`${key}\` is ${value}; the registry says ${actual}`,
      );
    }
  });

  if (quoted === 0) {
    problems.push(
      `${NUMBERS} quotes no threshold at all, so this check is agreeing with nothing`,
    );
  }
} catch (error) {
  problems.push(
    `could not check the handbook's numbers: ${error instanceof Error ? error.message : String(error)}`,
  );
}

// 5. The generated API reference matches the contract.
//
// Run as a child process rather than imported, because the generator is a
// script with a mode flag and running it is exactly what proves the committed
// page could be regenerated. One program in two modes, so a generator and a
// checker cannot disagree about what the file should hold.
const { execFile } = await import("node:child_process");
const { promisify } = await import("node:util");
const run = promisify(execFile);
try {
  await run(
    process.execPath,
    [
      "--experimental-strip-types",
      "--no-warnings",
      join(ROOT, "scripts/gen-api-reference.ts"),
      "--check",
    ],
    { cwd: ROOT },
  );
} catch (error) {
  const failure = error as { stderr?: string };
  problems.push(
    (failure.stderr ?? "the API reference check failed").trim().split("\n").join(" "),
  );
}

if (problems.length > 0) {
  process.stderr.write(
    `Documentation check failed. ${problems.length} problem(s):\n${problems
      .map((problem) => `  ${problem}`)
      .join("\n")}\n\n` +
      "A link nobody can follow and a command nobody can run are worse than a\n" +
      "missing page: the reader believes them. See docs/README.md.\n",
  );
  process.exit(1);
}

process.stdout.write(
  `Documentation check passed. ${pages.length} page(s), every link resolves, every page is reachable from the index, and every command it names exists.\n`,
);
