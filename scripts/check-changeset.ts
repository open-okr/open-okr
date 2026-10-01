/**
 * Refuses a branch that changes the product and names no version bump
 * (P7-T09b, PLAN.md §5.1 and §9).
 *
 * **The failure this prevents is a release nobody can read.** The version,
 * the changelog and the release notes used to be three things somebody wrote
 * at tag time from the commits they remembered. Written that way they drift
 * from each other and from the change: a bump chosen by whoever cut the tag,
 * a note composed from a log, and no way to check any of the three against
 * the others. A changeset moves the decision to the change that caused it,
 * while the person who made it still knows whether it breaks anything.
 *
 * **Silence is not a claim.** A change with no changeset might be invisible
 * from outside, or might be a breaking migration somebody forgot to mark.
 * The two look identical in a diff, so this refuses both and asks for the
 * distinction to be written down. `pnpm changeset --empty` is the way to say
 * "a customer cannot observe this", and it is a sentence a reviewer can
 * disagree with.
 *
 * Usage: check-changeset [base] [head]
 *
 * Defaults to `origin/main..HEAD`, which is what a pull request compares.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const base = process.argv[2] ?? "origin/main";
const head = process.argv[3] ?? "HEAD";

/**
 * Paths a change can touch without needing a version bump.
 *
 * **Every entry is something a running instance cannot observe.** Tests,
 * plans, runbooks, the editor's own configuration. A path is on this list
 * because changing it cannot alter what a customer sees, not because
 * changing it is unimportant: `docs/development-plan` is where this product
 * is decided and it still ships nothing.
 *
 * Deliberately short. A long exemption list is a gate that has been argued
 * down one path at a time.
 */
const INVISIBLE = [
  "docs/",
  ".changeset/",
  ".github/",
  ".vscode/",
  "README.md",
  "CLAUDE.md",
  "CONTRIBUTING.md",
  "LICENCE",
  "LICENSE",
];

/** Test and fixture files, wherever they live. */
const isTestPath = (path: string): boolean =>
  path.includes("/test/") ||
  path.includes("/__tests__/") ||
  path.startsWith("e2e/") ||
  /\.(test|spec)\.[cm]?[jt]sx?$/.test(path);

const changedFiles = (): string[] => {
  const out = execFileSync(
    "git",
    ["diff", "--name-only", `${base}...${head}`],
    { cwd: root, encoding: "utf8" },
  );
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
};

const changesetFiles = (): string[] => {
  try {
    return readdirSync(join(root, ".changeset")).filter(
      (name) => name.endsWith(".md") && name !== "README.md",
    );
  } catch {
    return [];
  }
};

/**
 * The packages a changeset may name: the workspace's own, by the globs in
 * `pnpm-workspace.yaml`.
 *
 * **Checked because the first release could not be cut.** Every changeset
 * named `openokr`, the repository's root package, and Changesets never
 * versions a monorepo's root, so `pnpm changeset version` stopped on the
 * first file with "not in the workspace", after 129 of them had passed this
 * gate. The product's version is carried by `@openokr/web` and the fixed
 * group in `.changeset/config.json` moves every package with it.
 */
const workspacePackages = (): Set<string> => {
  const names = new Set<string>();
  for (const dir of ["apps", "packages"]) {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      try {
        const manifest = JSON.parse(
          readFileSync(join(root, dir, entry.name, "package.json"), "utf8"),
        ) as { name?: string };
        if (manifest.name) {
          names.add(manifest.name);
        }
      } catch {
        // A folder with no package.json is not a package.
      }
    }
  }
  return names;
};

const misnamed = (): { file: string; name: string }[] => {
  const known = workspacePackages();
  const wrong: { file: string; name: string }[] = [];
  for (const file of changesetFiles()) {
    const text = readFileSync(join(root, ".changeset", file), "utf8");
    const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? "";
    for (const line of front.split(/\r?\n/)) {
      const name = /^["']([^"']+)["']\s*:/.exec(line.trim())?.[1];
      if (name && !known.has(name)) {
        wrong.push({ file, name });
      }
    }
  }
  return wrong;
};

const wrong = misnamed();
if (wrong.length > 0) {
  console.error(
    `Changeset gate failed. ${wrong.length} changeset(s) name a package that is not in the workspace:\n`,
  );
  for (const { file, name } of wrong.slice(0, 10)) {
    console.error(`  .changeset/${file}: "${name}"`);
  }
  console.error(
    `\nName "@openokr/web". Every package moves with it, and \`pnpm changeset version\` refuses any other name.`,
  );
  process.exit(1);
}

let changed: string[];
try {
  changed = changedFiles();
} catch (error) {
  // A shallow clone, or a base ref this checkout does not have. Refusing
  // here would fail a build for a reason that has nothing to do with the
  // change, so it says what it could not do and passes.
  process.stderr.write(
    `Changeset gate: could not diff ${base}...${head}, so nothing was checked. ` +
      `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(0);
}

const visible = changed.filter(
  (path) =>
    !isTestPath(path) && !INVISIBLE.some((prefix) => path.startsWith(prefix)),
);

if (visible.length === 0) {
  console.log(
    `Changeset gate passed. ${changed.length} file(s) changed, none of them ` +
      `observable from outside a running instance.`,
  );
  process.exit(0);
}

const changesets = changesetFiles();

/**
 * The changesets this branch used up, which is what a release does.
 *
 * `changeset version` deletes every pending changeset and writes what they
 * said into the changelog, so the branch that cuts a release changes the
 * version in every package and leaves no changeset behind. Counted as
 * described, because it is: by exactly the files it consumed.
 */
const consumed = (): number => {
  try {
    return execFileSync(
      "git",
      [
        "diff",
        "--name-only",
        "--diff-filter=D",
        `${base}...${head}`,
        "--",
        ".changeset/",
      ],
      { cwd: root, encoding: "utf8" },
    )
      .split("\n")
      .filter((line) => line.endsWith(".md") && !line.endsWith("README.md"))
      .length;
  } catch {
    return 0;
  }
};

if (changesets.length === 0 && consumed() > 0) {
  console.log(
    `Changeset gate passed. A release: ${consumed()} changeset(s) were ` +
      `consumed into the changelog by \`changeset version\`.`,
  );
  process.exit(0);
}
if (changesets.length === 0) {
  console.error(
    `Changeset gate failed. ${visible.length} file(s) change what a running ` +
      `instance does and no changeset says how the version moves:\n`,
  );
  for (const path of visible.slice(0, 10)) {
    console.error(`  ${path}`);
  }
  if (visible.length > 10) {
    console.error(`  ... and ${visible.length - 10} more`);
  }
  console.error(
    `\nRun \`pnpm changeset\` and describe the change for the person reading ` +
      `the release notes. If a customer genuinely cannot observe this, run ` +
      `\`pnpm changeset --empty\` and say so: that is a claim a reviewer can ` +
      `disagree with, and silence is not.`,
  );
  process.exit(1);
}

console.log(
  `Changeset gate passed. ${visible.length} observable file(s) changed and ` +
    `${changesets.length} changeset(s) describe the release.`,
);
