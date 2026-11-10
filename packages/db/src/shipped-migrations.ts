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
import {
  checksum,
  isSanctionedRewrite,
  SANCTIONED_REWRITES,
  type SanctionedRewrite,
} from "./migrate.ts";

export interface ShippedCheck {
  /** The tag compared against, or null when there is none to compare. */
  readonly tag: string | null;
  readonly compared: number;
  readonly problems: readonly string[];
  /** Files that differ from the tag by a rewrite the runner sanctions. */
  readonly sanctioned: readonly string[];
}

/**
 * One shipped file against the working copy: a problem, or null.
 *
 * A rewrite the runner sanctions (`SANCTIONED_REWRITES`, plan 0.8.0 H5)
 * passes, for that file, over that shipped copy, to that rewrite only, so the
 * gate refuses exactly what the runner would.
 */
export function compareShipped(
  name: string,
  shipped: string,
  current: string | null,
  tag: string,
  sanctions: Readonly<Record<string, SanctionedRewrite>> = SANCTIONED_REWRITES,
): string | null {
  if (current === null) {
    return `${name} shipped in ${tag} and is gone. A shipped migration is never deleted.`;
  }
  const was = checksum(shipped);
  const now = checksum(current);
  if (was !== now && !isSanctionedRewrite(name, was, now, sanctions)) {
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
    return { tag: null, compared: 0, problems: [], sanctioned: [] };
  }
  const names = git(repoRoot, ["ls-tree", "--name-only", tag, `${prefix}`])
    .split("\n")
    .filter((path) => path.endsWith(".sql"));
  const problems: string[] = [];
  const sanctioned: string[] = [];
  for (const path of names) {
    const name = path.slice(prefix.length);
    const shipped = git(repoRoot, ["show", `${tag}:${path}`]);
    const current = await readFile(join(migrationsDir, name), "utf8").catch(
      () => null,
    );
    const problem = compareShipped(name, shipped, current, tag);
    if (problem) {
      problems.push(problem);
    } else if (current !== null && checksum(shipped) !== checksum(current)) {
      sanctioned.push(name);
    }
  }
  return { tag, compared: names.length, problems, sanctioned };
}
