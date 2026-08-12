/**
 * Makes the standalone build startable on Windows (P3-T03).
 *
 * Next traces a pnpm workspace into `.next/standalone` by recreating the store's
 * symlinks. On Windows it writes them as file-type links, and a file-type link
 * that points at a directory cannot be stat'd: `require("react")` inside the
 * standalone tree throws `EPERM` and the server exits before it binds a port.
 * The whole end-to-end suite was unrunnable on Windows because of it, which is
 * why it had never been run there.
 *
 * Recreating each broken link as a junction fixes it. A no-op everywhere else:
 * on Linux and macOS every link already resolves, so nothing is touched.
 *
 * Not a workaround for our own bug, and deliberately not part of `pnpm build`.
 * It repairs build output in place, immediately before the server that reads it
 * starts, and it leaves the source tree alone.
 */
import {
  lstatSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  statSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { join, resolve } from "node:path";

const root = process.argv[2] ?? "apps/web/.next/standalone/node_modules";

let repaired = 0;

function walk(directory: string): void {
  let entries: ReturnType<typeof readdirSync>;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    // A directory the trace did not produce is not an error here.
    return;
  }

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      const target = resolve(directory, readlinkSync(path));
      let targetIsDirectory = false;
      try {
        targetIsDirectory = statSync(target).isDirectory();
      } catch {
        continue;
      }
      if (!targetIsDirectory) {
        continue;
      }
      try {
        realpathSync(path);
        continue;
      } catch {
        // Unresolvable: the link is the wrong type for its target.
      }
      unlinkSync(path);
      symlinkSync(target, path, "junction");
      repaired += 1;
    } else if (entry.isDirectory()) {
      walk(path);
    }
  }
}

try {
  lstatSync(root);
} catch {
  console.error(`e2e: ${root} does not exist. Run 'pnpm build' first.`);
  process.exit(1);
}

walk(root);

if (repaired > 0) {
  console.log(`e2e: repaired ${repaired} standalone symlink(s) as junctions.`);
}
