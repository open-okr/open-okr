/**
 * Refuses an edit to a migration a release already shipped.
 *
 * The runner records a checksum for every migration it applies and refuses an
 * upgrade when an applied file changed ("was edited after it ran"). Continuous
 * integration builds a fresh database each run, so it never sees that: a
 * commit on 7 October 2026 changed the comments of sixteen shipped migrations,
 * every check was green, and every existing instance stopped at its next
 * upgrade. This compares each migration the newest release tag holds with the
 * working copy, through the runner's own checksum, so a comment or a blank
 * line counts exactly as the runner counts it.
 */
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { checksum } from "./migrate.ts";

export interface ShippedCheck {
  /** The tag compared against, or null when there is none to compare. */
  readonly tag: string | null;
  readonly compared: number;
  readonly problems: readonly string[];
}

/** One shipped file against the working copy: a problem, or null. */
export function compareShipped(
  name: string,
  shipped: string,
  current: string | null,
  tag: string,
): string | null {
  if (current === null) {
    return `${name} shipped in ${tag} and is gone. A shipped migration is never deleted.`;
  }
  if (checksum(shipped) !== checksum(current)) {
    return `${name} differs from ${tag}. A shipped migration is never edited, comments included: every instance that ran it refuses to upgrade. Add a new migration instead.`;
  }
  return null;
}

const git = (repo: string, args: readonly string[]): string =>
  execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });

export async function checkShippedMigrations(
  migrationsDir: string,
): Promise<ShippedCheck> {
  let tag: string;
  let repoRoot: string;
  let prefix: string;
  try {
    repoRoot = git(migrationsDir, ["rev-parse", "--show-toplevel"]).trim();
    prefix = git(migrationsDir, ["rev-parse", "--show-prefix"]).trim();
    tag = git(migrationsDir, [
      "describe",
      "--tags",
      "--abbrev=0",
      "--match",
      "v[0-9]*",
    ]).trim();
  } catch {
    return { tag: null, compared: 0, problems: [] };
  }
  const names = git(repoRoot, ["ls-tree", "--name-only", tag, `${prefix}`])
    .split("\n")
    .filter((path) => path.endsWith(".sql"));
  const problems: string[] = [];
  for (const path of names) {
    const name = path.slice(prefix.length);
    const shipped = git(repoRoot, ["show", `${tag}:${path}`]);
    const current = await readFile(join(migrationsDir, name), "utf8").catch(
      () => null,
    );
    const problem = compareShipped(name, shipped, current, tag);
    if (problem) {
      problems.push(problem);
    }
  }
  return { tag, compared: names.length, problems };
}
