#!/usr/bin/env node
/**
 * The air-gap checklist, as a gate (P8-T10).
 *
 * `docs/runbooks/air-gap.md` claims an instance with no route to the internet
 * is whole. Six of those claims are about the source and can be checked here;
 * the two that are about a machine on an isolated network are written out in
 * the guide for whoever commissions it, because this repository is not on that
 * network.
 *
 * **The guide and this script are compared in both directions**, the way
 * `method:check` compares METHOD.md with `packages/method`. A row in the
 * checklist with no check here fails, and a check here with no row there fails
 * too. That is what stops the page from quietly becoming untrue: the first
 * person to add a CDN has to either fix it or delete the sentence that says
 * they did not.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const GUIDE = join(ROOT, "docs/runbooks/air-gap.md");

interface Check {
  readonly id: string;
  run(): Promise<readonly string[]>;
}

/** Every file under `dir` with one of these extensions. */
async function filesUnder(
  dir: string,
  extensions: readonly string[],
  skip: readonly string[] = ["node_modules", ".next", ".turbo", "dist"],
): Promise<string[]> {
  const found: string[] = [];
  let entries: Awaited<ReturnType<typeof readdir>>;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (skip.includes(entry.name)) {
      continue;
    }
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await filesUnder(path, extensions, skip)));
    } else if (extensions.some((extension) => entry.name.endsWith(extension))) {
      found.push(path);
    }
  }
  return found;
}

/** A line of code rather than a line of prose about code. */
const isComment = (line: string): boolean => {
  const trimmed = line.trim();
  return (
    trimmed.startsWith("//") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("/*") ||
    trimmed.startsWith("#")
  );
};

const relative = (path: string): string =>
  path.replace(ROOT, "").replace(/\\/g, "/").replace(/^\//, "");

/**
 * Hosts a page must never reach for, because an isolated instance cannot.
 *
 * Not an exhaustive list of the internet: these are the ones a web application
 * picks up by habit, and the habit is what this catches.
 */
const FORBIDDEN_HOSTS = [
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "cdn.jsdelivr.net",
  "unpkg.com",
  "cdnjs.cloudflare.com",
  "code.jquery.com",
  "ajax.googleapis.com",
];

const CHECKS: readonly Check[] = [
  {
    id: "fonts-self-hosted",
    async run() {
      const failures: string[] = [];
      const files = await filesUnder(join(ROOT, "apps/web/app"), [".tsx"]);
      const usesLocalFont = await Promise.all(
        files.map(async (file) => (await readFile(file, "utf8")).includes("next/font/local")),
      );
      if (!usesLocalFont.some(Boolean)) {
        failures.push(
          "no screen loads a font through next/font/local, so the typeface may not be self-hosted",
        );
      }
      for (const file of files) {
        const lines = (await readFile(file, "utf8")).split("\n");
        lines.forEach((line, index) => {
          // Line by line and comments skipped, because `layout.tsx` explains
          // in prose why it does not use the Google loader, and a whole-file
          // search reads that explanation as the thing it warns against.
          if (isComment(line) || !line.includes("next/font/google")) {
            return;
          }
          failures.push(
            `${relative(file)}:${index + 1} loads a font through next/font/google, which fetches while it builds`,
          );
        });
      }
      return failures;
    },
  },
  {
    id: "no-external-hosts",
    async run() {
      const failures: string[] = [];
      const files = [
        ...(await filesUnder(join(ROOT, "apps/web"), [".ts", ".tsx", ".css"])),
        ...(await filesUnder(join(ROOT, "packages/ui/src"), [
          ".ts",
          ".tsx",
          ".css",
        ])),
      ];
      for (const file of files) {
        // Tests name hosts on purpose: the outbound guard's own suite is a
        // list of addresses it must refuse.
        if (/[\\/](test|tests|__tests__)[\\/]/.test(file)) {
          continue;
        }
        const lines = (await readFile(file, "utf8")).split("\n");
        lines.forEach((line, index) => {
          if (isComment(line)) {
            return;
          }
          for (const host of FORBIDDEN_HOSTS) {
            if (line.includes(host)) {
              failures.push(`${relative(file)}:${index + 1} names ${host}`);
            }
          }
        });
      }
      return failures;
    },
  },
  {
    id: "no-runtime-network-install",
    async run() {
      const dockerfile = join(ROOT, "deploy/docker/Dockerfile");
      let text: string;
      try {
        text = await readFile(dockerfile, "utf8");
      } catch {
        return ["deploy/docker/Dockerfile is missing"];
      }

      const runtime = text.split(/^FROM .* AS runtime$/m)[1];
      if (runtime === undefined) {
        return ["deploy/docker/Dockerfile has no runtime stage to check"];
      }

      const failures: string[] = [];
      const fetchers = [
        /\bcurl\b/,
        /\bwget\b/,
        /apk\s+add/,
        /apt-get\s+install/,
        /npm\s+(install|ci)\b/,
        /pnpm\s+(install|add)\b/,
        /yarn\s+add\b/,
      ];
      for (const [index, line] of runtime.split("\n").entries()) {
        if (isComment(line)) {
          continue;
        }
        for (const fetcher of fetchers) {
          if (fetcher.test(line)) {
            failures.push(
              `deploy/docker/Dockerfile runtime stage, line ${index + 1}: ${line.trim()}`,
            );
          }
        }
      }
      return failures;
    },
  },
  {
    id: "ai-off-by-default",
    async run() {
      const schema = await readFile(
        join(ROOT, "packages/db/src/schema/ai.ts"),
        "utf8",
      );
      const enabled = /enabled:\s*boolean\("enabled"\)[\s\S]{0,80}?default\((true|false)\)/.exec(
        schema,
      );
      if (!enabled) {
        return [
          "packages/db/src/schema/ai.ts no longer declares a default for ai_providers.enabled",
        ];
      }
      return enabled[1] === "false"
        ? []
        : ["ai_providers.enabled defaults to true, so a fresh instance would call out"];
    },
  },
  {
    id: "outbound-goes-through-the-port",
    async run() {
      const failures: string[] = [];
      const files = [
        ...(await filesUnder(join(ROOT, "packages/core/src"), [".ts"])),
        ...(await filesUnder(join(ROOT, "packages/agents/src"), [".ts"])),
        ...(await filesUnder(join(ROOT, "apps/web/app"), [".ts", ".tsx"])),
        ...(await filesUnder(join(ROOT, "apps/web/lib"), [".ts", ".tsx"])),
      ];
      // A literal http(s) address handed to `fetch` is the shape that walks
      // past the port. `outboundFetch` itself lives in packages/adapters and
      // is not in this list.
      const direct = /\bfetch\(\s*["'`]https?:\/\//;
      for (const file of files) {
        const lines = (await readFile(file, "utf8")).split("\n");
        lines.forEach((line, index) => {
          if (isComment(line)) {
            return;
          }
          if (direct.test(line)) {
            failures.push(
              `${relative(file)}:${index + 1} calls fetch on an absolute address`,
            );
          }
        });
      }
      return failures;
    },
  },
  {
    id: "registries-are-build-time",
    async run() {
      const failures: string[] = [];
      const files = await filesUnder(join(ROOT, "packages/ui/src"), [
        ".ts",
        ".tsx",
      ]);
      for (const file of files) {
        const lines = (await readFile(file, "utf8")).split("\n");
        lines.forEach((line, index) => {
          if (isComment(line)) {
            return;
          }
          if (/\bfetch\(/.test(line) || /import\(\s*["'`]https?:/.test(line)) {
            failures.push(
              `${relative(file)}:${index + 1} fetches at render time`,
            );
          }
        });
      }
      return failures;
    },
  },
];

/** The check identifiers the guide's checklist names. */
async function checklistIds(): Promise<string[]> {
  const guide = await readFile(GUIDE, "utf8");
  const table = guide.split("## The checklist")[1]?.split("##")[0] ?? "";
  return [...table.matchAll(/^\|\s*`([a-z-]+)`\s*\|/gm)].map(
    (match) => match[1] as string,
  );
}

const named = await checklistIds();
const implemented = CHECKS.map((check) => check.id);

const problems: string[] = [];

for (const id of named) {
  if (!implemented.includes(id)) {
    problems.push(
      `docs/runbooks/air-gap.md names \`${id}\` and this script does not check it`,
    );
  }
}
for (const id of implemented) {
  if (!named.includes(id)) {
    problems.push(
      `this script checks \`${id}\` and docs/runbooks/air-gap.md does not name it`,
    );
  }
}

for (const check of CHECKS) {
  for (const failure of await check.run()) {
    problems.push(`${check.id}: ${failure}`);
  }
}

if (problems.length > 0) {
  process.stderr.write(
    `Air-gap check failed. ${problems.length} problem(s):\n${problems
      .map((problem) => `  ${problem}`)
      .join("\n")}\n\n` +
      "An instance on an isolated network has to work with nothing configured.\n" +
      "See docs/runbooks/air-gap.md.\n",
  );
  process.exit(1);
}

process.stdout.write(
  `Air-gap check passed. ${CHECKS.length} check(s), and the checklist in docs/runbooks/air-gap.md names the same ${named.length}.\n`,
);
