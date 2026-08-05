/**
 * The architecture boundary rules, as data and pure functions so they can be
 * tested rather than trusted.
 *
 * Three rules, each protecting a hard rule in CLAUDE.md:
 *
 *  1. **Vendor SDKs live only in `packages/adapters`.** A queue, mail
 *     service, chat provider, cloud provider or LLM client imported anywhere
 *     else welds that vendor into the domain and makes the port meaningless.
 *  2. **Driver modules are private to `packages/adapters`.** Application
 *     code consumes ports; importing a concrete driver defeats the seam even
 *     when the vendor import itself stays put.
 *  3. **Write paths cause side effects only through the outbox.** Calling a
 *     driver directly from a write means the side effect can fire for a
 *     change that rolled back, and the message can go missing for one that
 *     committed. Insert an outbox row instead; the relay delivers it.
 */

export interface BoundarySourceFile {
  /** Repository-relative path, with forward slashes. */
  readonly path: string;
  readonly text: string;
}

export interface BoundaryViolation {
  readonly path: string;
  /** 1-based line of the offending code. */
  readonly line: number;
  readonly rule: "vendor-sdk" | "driver-import" | "write-path-side-effect";
  readonly message: string;
}

/**
 * Packages that talk to something outside this process and therefore belong
 * behind a port. `pg` and `drizzle-orm` are absent on purpose: Postgres is
 * the one required service and the database layer owns it directly.
 */
const VENDOR_SDKS: readonly string[] = [
  // Queues and jobs
  "pg-boss",
  "bullmq",
  "bull",
  "kafkajs",
  "amqplib",
  // Realtime and sockets
  "ws",
  "socket.io",
  "socket.io-client",
  "pusher",
  "ably",
  // Mail
  "nodemailer",
  "@sendgrid/mail",
  "postmark",
  "resend",
  "mailgun.js",
  // Chat and messaging providers
  "@slack/web-api",
  "@slack/bolt",
  "botbuilder",
  "@microsoft/microsoft-graph-client",
  "telegraf",
  "node-telegram-bot-api",
  "twilio",
  "whatsapp-web.js",
  // LLM clients
  "openai",
  "@anthropic-ai/sdk",
  "@google/generative-ai",
  "@google/genai",
  "@mistralai/mistralai",
  "cohere-ai",
  "ollama",
  "@ai-sdk/openai",
  "ai",
  "@modelcontextprotocol/sdk",
  // Cloud providers and storage
  "@aws-sdk/client-s3",
  "@aws-sdk/s3-request-presigner",
  "@google-cloud/storage",
  "@azure/storage-blob",
  "minio",
  // Search and cache services
  "redis",
  "ioredis",
  "@elastic/elasticsearch",
  "meilisearch",
  "typesense",
  // Payments and analytics
  "stripe",
  "posthog-node",
];

/** Where vendor SDKs and driver modules are allowed to live. */
const ADAPTERS_PREFIX = "packages/adapters/";

/**
 * Packages whose write paths must not touch a driver. `packages/core` owns
 * the Operation pipeline; `packages/agents` proposes changes through it.
 */
const WRITE_PATH_PREFIXES: readonly string[] = [
  "packages/core/",
  "packages/agents/",
];

/**
 * Port methods that reach the outside world. Called from a write path, each
 * one is a side effect that should have gone through the outbox.
 */
const SIDE_EFFECT_METHODS: readonly string[] = [
  "enqueue",
  "schedule",
  "send",
  "sendToChannel",
  "publish",
];

const importSpecifiers = (
  text: string,
): { specifier: string; index: number }[] => {
  const found: { specifier: string; index: number }[] = [];
  // Static imports and re-exports, plus dynamic import() and require().
  const patterns = [
    /(?:^|\n)\s*import\s[^;]*?from\s*["']([^"']+)["']/g,
    /(?:^|\n)\s*import\s*["']([^"']+)["']/g,
    /(?:^|\n)\s*export\s[^;]*?from\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      found.push({ specifier: match[1] as string, index: match.index });
    }
  }
  return found;
};

const lineOf = (text: string, index: number): number =>
  text.slice(0, index).split("\n").length;

/** The import patterns may match from the newline that precedes a statement.
 * This moves to the statement itself, so line numbers and the marker lookup
 * both refer to the import the reader sees. */
const statementStart = (text: string, index: number): number => {
  let cursor = index;
  while (cursor < text.length && /\s/.test(text[cursor] as string)) {
    cursor++;
  }
  return cursor;
};

/** True when `specifier` is the package `name` or a subpath of it. */
const isPackage = (specifier: string, name: string): boolean =>
  specifier === name || specifier.startsWith(`${name}/`);

/** An `// openokr:allow-vendor-sdk: <reason>` comment on the line above. */
const hasAllowMarker = (text: string, statementIndex: number): boolean => {
  const line = lineOf(text, statementIndex);
  const previous = (text.split("\n")[line - 2] ?? "").trim();
  const match = previous.match(/^\/\/\s*openokr:allow-vendor-sdk:\s*(.+)$/);
  return match !== null && (match[1] ?? "").trim().length > 0;
};

/** Checks the vendor SDK and driver-import rules for one file. */
const checkImports = (file: BoundarySourceFile): BoundaryViolation[] => {
  const violations: BoundaryViolation[] = [];
  const inAdapters = file.path.startsWith(ADAPTERS_PREFIX);

  for (const { specifier, index: matchIndex } of importSpecifiers(file.text)) {
    const index = statementStart(file.text, matchIndex);
    if (!inAdapters) {
      const vendor = VENDOR_SDKS.find((name) => isPackage(specifier, name));
      if (vendor && !hasAllowMarker(file.text, index)) {
        violations.push({
          path: file.path,
          line: lineOf(file.text, index),
          rule: "vendor-sdk",
          message:
            `imports the vendor SDK "${vendor}" outside packages/adapters. ` +
            `Put it behind a port in packages/adapters and consume the port.`,
        });
      }

      // Reaching a concrete driver defeats the port even without a vendor
      // import of its own.
      if (
        /@openokr\/adapters\/.*drivers?\//.test(specifier) ||
        /drivers\//.test(specifier)
      ) {
        if (specifier.includes("adapters")) {
          violations.push({
            path: file.path,
            line: lineOf(file.text, index),
            rule: "driver-import",
            message:
              `imports a driver directly ("${specifier}"). ` +
              `Consume the port from @openokr/adapters instead.`,
          });
        }
      }
    }
  }

  return violations;
};

/** Checks the write-path rule for one file. */
const checkWritePathSideEffects = (
  file: BoundarySourceFile,
): BoundaryViolation[] => {
  if (!WRITE_PATH_PREFIXES.some((prefix) => file.path.startsWith(prefix))) {
    return [];
  }

  const violations: BoundaryViolation[] = [];
  // A call on something that reads as a port: `jobs.enqueue(`,
  // `this.mailer.send(`, `adapters.channel.sendToChannel(`.
  const pattern = new RegExp(
    `\\b(\\w+)\\.(${SIDE_EFFECT_METHODS.join("|")})\\s*\\(`,
    "g",
  );

  for (const match of file.text.matchAll(pattern)) {
    const receiver = match[1] as string;
    const method = match[2] as string;
    const index = match.index;

    // `outbox.send(...)` style calls on the outbox itself are the correct
    // path, as are enqueueOutbox helpers.
    if (/outbox/i.test(receiver)) {
      continue;
    }

    const line = lineOf(file.text, index);
    const lineText = file.text.split("\n")[line - 1] ?? "";
    if (/openokr:allow-side-effect:\s*\S/.test(lineText)) {
      continue;
    }

    violations.push({
      path: file.path,
      line,
      rule: "write-path-side-effect",
      message:
        `calls ${receiver}.${method}() on a write path. ` +
        `Side effects are enqueued by inserting an outbox row in the same ` +
        `transaction; the relay delivers them after it commits.`,
    });
  }

  return violations;
};

export function checkBoundaries(
  files: readonly BoundarySourceFile[],
): BoundaryViolation[] {
  return files.flatMap((file) => [
    ...checkImports(file),
    ...checkWritePathSideEffects(file),
  ]);
}
