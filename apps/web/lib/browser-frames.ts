/**
 * Browser frames, resolved to source on the server (docs/design/
 * error-reporting.md D18, plan 0.7.0 E3).
 *
 * A browser's stack names compiled chunks, `_next/static/chunks/0a1b.js:1:2345`.
 * The build writes a source map beside each chunk, and Node's own `SourceMap`
 * reads it, so every tracker gets readable frames with no upload step per
 * release and no dependency. What a map reveals is the public repository.
 *
 * **The file name in a frame is the browser's to say, so it is untrusted.**
 * Only a path under `_next/static/` ending in `.js` is looked up, a `..`
 * anywhere refuses it, and the resolved path must still be inside the static
 * directory. Anything else keeps its frame as it came.
 *
 * Maps are parsed when a report needs one and at most sixteen are kept,
 * because a parsed map costs several times its size in memory (E1 measured
 * the server's at a gigabyte for all of them).
 */
import { readFile } from "node:fs/promises";
import { SourceMap, type SourceMapping } from "node:module";
import { join, resolve, sep } from "node:path";
import { type ErrorFrame, scrubFile } from "@openokr/core";

/** Where the build's static output is: standalone, then a checkout. */
function staticRoots(): readonly string[] {
  return [
    resolve(process.cwd(), ".next/static"),
    resolve(process.cwd(), "apps/web/.next/static"),
  ];
}

const CACHE_LIMIT = 16;

const globals = globalThis as typeof globalThis & {
  openokrBrowserMaps?: Map<string, SourceMap | null>;
};

function cache(): Map<string, SourceMap | null> {
  globals.openokrBrowserMaps ??= new Map();
  return globals.openokrBrowserMaps;
}

/** The chunk a frame names, relative to the static root, or null. */
function chunkOf(file: string): string | null {
  if (!file.startsWith("_next/static/")) {
    return null;
  }
  let relative: string;
  try {
    relative = decodeURIComponent(file.slice("_next/static/".length));
  } catch {
    return null;
  }
  if (
    !relative.endsWith(".js") ||
    relative.includes("\0") ||
    relative
      .split(/[\\/]/)
      .some((segment) => segment === ".." || segment === "")
  ) {
    return null;
  }
  return relative;
}

async function mapFor(
  relative: string,
  roots: readonly string[],
): Promise<SourceMap | null> {
  const maps = cache();
  if (maps.has(relative)) {
    const found = maps.get(relative) ?? null;
    // Most recently used last, so the oldest is the first to go.
    maps.delete(relative);
    maps.set(relative, found);
    return found;
  }
  let found: SourceMap | null = null;
  for (const root of roots) {
    const path = resolve(join(root, `${relative}.map`));
    if (!path.startsWith(root + sep)) {
      continue;
    }
    try {
      found = new SourceMap(JSON.parse(await readFile(path, "utf8")));
      break;
    } catch {
      // Not here, not readable, or not a map: the frame stays compiled.
    }
  }
  maps.set(relative, found);
  if (maps.size > CACHE_LIMIT) {
    const oldest = maps.keys().next().value;
    if (oldest !== undefined) {
      maps.delete(oldest);
    }
  }
  return found;
}

const isOurs = (file: string): boolean =>
  !(file.includes("node_modules") || file.startsWith("<"));

/**
 * The frames with every chunk position replaced by its source position, where
 * a map says one. Never throws: a frame that cannot be resolved is kept.
 */
export async function resolveBrowserFrames(
  frames: readonly ErrorFrame[],
  roots: readonly string[] = staticRoots(),
): Promise<ErrorFrame[]> {
  const resolved: ErrorFrame[] = [];
  for (const frame of frames) {
    try {
      const relative = chunkOf(frame.file);
      const map =
        relative !== null && frame.line !== null
          ? await mapFor(relative, roots)
          : null;
      const found =
        map && frame.line !== null
          ? map.findEntry(frame.line - 1, (frame.column ?? 1) - 1)
          : null;
      // An empty object when the map has nothing at that position.
      const entry =
        found && "originalSource" in found ? (found as SourceMapping) : null;
      if (!entry || typeof entry.originalSource !== "string") {
        resolved.push(frame);
        continue;
      }
      let source = entry.originalSource;
      try {
        source = decodeURIComponent(source);
      } catch {
        // Kept as written.
      }
      const file = scrubFile(
        source.replace(/^[a-z]+:\/\/\/?(\[project\]\/)?/i, ""),
      );
      resolved.push({
        file,
        // The stack's own name, not the map's: a map names the identifier at
        // the position, which in a call frame is the function being called,
        // and a report naming the callee as the caller misleads.
        function: frame.function,
        line: entry.originalLine + 1,
        column: entry.originalColumn + 1,
        inApp: isOurs(file),
      });
    } catch {
      resolved.push(frame);
    }
  }
  return resolved;
}
