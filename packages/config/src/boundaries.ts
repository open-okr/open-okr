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
 *  4. **Mutations go through the Operation pipeline.** A domain write outside
 *     an operation has no audit row, no activity row and no outbox row, which
 *     is exactly the drift the pipeline exists to make impossible. This is the
 *     lint TECHNICAL-PLAN §8.1 layer 4 calls for: an unregistered write path
 *     fails the build.
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
  readonly rule:
    | "vendor-sdk"
    | "driver-import"
    | "write-path-side-effect"
    | "mutation-outside-operation"
    | "protected-read-outside-getter";
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
 * Where write paths live. `packages/core` owns the Operation pipeline,
 * `packages/agents` proposes changes through it, and `apps` holds the server
 * actions and route handlers that call both.
 *
 * `apps` was missing, and a direct mail send in a server action was already
 * sitting outside the rule as a result. Phase 2 adds invitation and
 * notification sends in exactly that layer.
 */
const WRITE_PATH_PREFIXES: readonly string[] = [
  "packages/core/",
  "packages/agents/",
  "apps/",
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

/**
 * Is there an `// openokr:<marker>: <reason>` comment above this line?
 *
 * The whole contiguous `//` block is searched rather than only the line
 * directly above, so a reason can be written properly instead of squeezed onto
 * one line. The migration linter reads its markers the same way. A marker with
 * no reason after the colon does not count: an escape without a stated reason
 * is the thing these gates exist to prevent.
 */
const hasMarkerAbove = (
  lines: readonly string[],
  startLine: number,
  marker: string,
): boolean => {
  const pattern = new RegExp(`^//\\s*openokr:${marker}:\\s*(.+)$`);

  for (let i = startLine - 2; i >= 0; i--) {
    const text = (lines[i] ?? "").trim();
    if (text === "") {
      continue;
    }
    if (!text.startsWith("//")) {
      return false;
    }
    const match = text.match(pattern);
    if (match && (match[1] ?? "").trim().length > 0) {
      return true;
    }
  }
  return false;
};

/** Checks the vendor SDK and driver-import rules for one file. */
const checkImports = (file: BoundarySourceFile): BoundaryViolation[] => {
  const violations: BoundaryViolation[] = [];
  const inAdapters = file.path.startsWith(ADAPTERS_PREFIX);
  const lines = file.text.split("\n");

  for (const { specifier, index: matchIndex } of importSpecifiers(file.text)) {
    const index = statementStart(file.text, matchIndex);
    if (!inAdapters) {
      const vendor = VENDOR_SDKS.find((name) => isPackage(specifier, name));
      if (
        vendor &&
        !hasMarkerAbove(lines, lineOf(file.text, index), "allow-vendor-sdk")
      ) {
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
  //
  // The receiver may also be a call expression, as in
  // `mailerFrom(settings).send(...)`. Anchoring on an identifier alone read
  // straight past that shape, which is how the one direct mail send in the
  // application went unseen.
  const pattern = new RegExp(
    `(\\w+|\\))\\s*\\.\\s*(${SIDE_EFFECT_METHODS.join("|")})\\s*\\(`,
    "g",
  );
  const lines = file.text.split("\n");

  for (const match of file.text.matchAll(pattern)) {
    const receiver = match[1] as string;
    const method = match[2] as string;
    const index = match.index;
    const line = lineOf(file.text, index);
    const lineText = lines[line - 1] ?? "";

    // `outbox.send(...)` style calls on the outbox itself are the correct
    // path, as are enqueueOutbox helpers. A call-expression receiver has no
    // name to read, so the statement it sits on is what gets checked.
    if (/outbox/i.test(receiver === ")" ? lineText : receiver)) {
      continue;
    }

    if (/openokr:allow-side-effect:\s*\S/.test(lineText)) {
      continue;
    }
    if (hasMarkerAbove(lines, line, "allow-side-effect")) {
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

/**
 * Where a domain write may legitimately appear.
 *
 * `packages/db` implements the primitives every write is built from, and the
 * pipeline itself writes the activity, audit and outbox rows.
 */
const MUTATION_ALLOWED_PREFIXES: readonly string[] = [
  "packages/db/",
  "packages/core/src/operations/",
];

/** Packages whose domain writes must run through the pipeline. */
const MUTATION_CHECKED_PREFIXES: readonly string[] = [
  "packages/core/",
  "packages/agents/",
  "packages/importer/",
  "apps/",
];

/**
 * Drizzle's mutating builders.
 *
 * The hard part is telling a domain write from `seen.delete(key)` on a Set or
 * `editor.update(state)` on something else entirely. Two shapes are matched,
 * and both require the single-identifier argument a table always is:
 *
 *  1. The builder chain: `.insert(t).values(`, `.update(t).set(`,
 *     `.delete(t).where(`. Nothing but Drizzle reads like that.
 *  2. The same call on a receiver that is plainly a database handle, which
 *     catches an unchained `await tx.delete(table)`.
 *
 * A write that matches neither is possible to construct, so this is a strong
 * net rather than a proof. The pipeline's own return type is the proof: an
 * operation cannot commit without handing back its audit row.
 */
const MUTATION_CHAIN =
  /\.(insert|update|delete)\s*\(\s*[A-Za-z_$][\w$]*\s*\)\s*\.\s*(?:values|set|where|returning|onConflictDoNothing|onConflictDoUpdate)\s*\(/g;

const MUTATION_ON_DB_HANDLE =
  /\b(?:tx|trx|db|database|savepoint|executor)\s*\.\s*(insert|update|delete)\s*\(\s*[A-Za-z_$][\w$]*\s*\)/g;

/**
 * A write sent as SQL text rather than built with Drizzle.
 *
 * `tx.execute(sql`update ...`)` and `client.query("insert into ...")` are the
 * obvious way around a lint that only knows the builders, and neither was
 * visible to it. Reads are left alone: only the three mutating verbs match.
 */
const RAW_SQL_MUTATION =
  /\b(?:query|execute)\s*\(\s*(?:sql\s*)?["'`]\s*(insert\s+into|update|delete\s+from)\b/gi;

/**
 * The line a statement begins on.
 *
 * Walks back to the last statement boundary, so a chain spread over five
 * lines resolves to the one line a reader would call its start. Both mutation
 * patterns then agree on where a write is, which is what lets the escape
 * marker have a single home.
 */
const statementStartLine = (text: string, index: number): number => {
  let cursor = index;
  while (cursor > 0) {
    const char = text[cursor - 1];
    if (char === ";" || char === "{" || char === "}") {
      break;
    }
    cursor--;
  }
  // Skip whitespace between the boundary and the statement itself.
  while (cursor < index && /\s/.test(text[cursor] ?? "")) {
    cursor++;
  }

  // A comment block sits between the boundary and the code, so the walk above
  // lands on the comment rather than the statement. Step forward over it:
  // otherwise the marker would have to look for itself.
  const lines = text.split("\n");
  const matchLine = lineOf(text, index);
  let line = lineOf(text, cursor);
  while (line < matchLine) {
    const current = (lines[line - 1] ?? "").trim();
    if (
      current !== "" &&
      !current.startsWith("//") &&
      !current.startsWith("*")
    ) {
      break;
    }
    line++;
  }
  return line;
};

/**
 * The character span of every `runOperation(...)` and `defineWriteAction(...)`
 * call in a file.
 *
 * A write inside one of these spans is the change the pipeline commits
 * alongside its audit row. A write outside them is not, even in the same file.
 *
 * The rule used to exempt the whole file as soon as either name appeared
 * anywhere in it, so a handler that declared one operation could carry any
 * number of unrelated raw writes past the gate. Both spellings still count:
 * `runOperation` runs a spec directly, and `defineWriteAction` is the registry
 * builder that takes a spec and runs it, so a write action cannot be declared
 * without one.
 *
 * Parentheses inside string literals can skew the balance. That makes this a
 * strong net rather than a proof, which is the same standing the mutation
 * patterns themselves have.
 */
const pipelineSpans = (text: string): [number, number][] => {
  const spans: [number, number][] = [];
  const opener = /\b(?:runOperation|defineWriteAction)\s*\(/g;

  for (const match of text.matchAll(opener)) {
    const open = match.index + match[0].length - 1;
    let depth = 0;
    for (let i = open; i < text.length; i++) {
      const char = text[i];
      if (char === "(") {
        depth++;
      } else if (char === ")") {
        depth--;
        if (depth === 0) {
          spans.push([match.index, i]);
          break;
        }
      }
    }
  }
  return spans;
};

/** Checks the mutation rule for one file. */
const checkMutations = (file: BoundarySourceFile): BoundaryViolation[] => {
  if (!MUTATION_CHECKED_PREFIXES.some((p) => file.path.startsWith(p))) {
    return [];
  }
  if (MUTATION_ALLOWED_PREFIXES.some((p) => file.path.startsWith(p))) {
    return [];
  }

  const spans = pipelineSpans(file.text);
  const insidePipeline = (index: number): boolean =>
    spans.some(([start, end]) => index >= start && index <= end);

  const violations: BoundaryViolation[] = [];
  const lines = file.text.split("\n");
  const seenStatements = new Set<number>();
  const matches = [
    ...file.text.matchAll(MUTATION_CHAIN),
    ...file.text.matchAll(MUTATION_ON_DB_HANDLE),
    ...file.text.matchAll(RAW_SQL_MUTATION),
  ];

  for (const match of matches) {
    if (insidePipeline(match.index)) {
      continue;
    }
    const method = match[1] as string;
    const line = lineOf(file.text, match.index);
    // Both patterns match the same statement at different lines: one lands on
    // `await tx`, the other on the `.insert(...)` that follows it. Resolving
    // each to the line its statement begins on collapses them to one finding,
    // and gives the marker a single place to sit.
    const start = statementStartLine(file.text, match.index);
    if (seenStatements.has(start)) {
      continue;
    }
    seenStatements.add(start);

    if (hasMarkerAbove(lines, start, "allow-mutation")) {
      continue;
    }

    violations.push({
      path: file.path,
      line,
      rule: "mutation-outside-operation",
      message:
        `writes with .${method}() outside the Operation pipeline. ` +
        `A write here commits with no audit row, no activity row and no ` +
        `outbox row. Run it through runOperation, which writes all four in ` +
        `one transaction.`,
    });
  }

  return violations;
};

/**
 * Tables read through the access-aware getter (TECHNICAL-PLAN §4.1, §8.1
 * layer 2, P2-T02), keyed by nothing but their own name: this list grows one
 * entry per resource type as later phases add protected aggregates. Read the
 * getter's own row, not the table, so a caller cannot see more than the
 * getter would tell them.
 */
const PROTECTED_TABLES: readonly string[] = ["workspaces", "spaces"];

/**
 * Where a protected table's own row may legitimately be selected directly:
 * the database layer, the getter itself, and the Operation pipeline, which
 * enforces access before a single write and may need the row's own columns
 * for its audit payload.
 */
const PROTECTED_READ_ALLOWED_PREFIXES: readonly string[] = [
  "packages/db/",
  "packages/core/src/access/",
  "packages/core/src/operations/",
];

/** Packages whose reads of a protected table must go through the getter. */
const PROTECTED_READ_CHECKED_PREFIXES: readonly string[] = [
  "packages/core/",
  "packages/agents/",
  "packages/importer/",
  "apps/",
];

const PROTECTED_READ = new RegExp(
  `\\.from\\s*\\(\\s*(${PROTECTED_TABLES.join("|")})\\s*\\)`,
  "g",
);

/**
 * Checks the protected-read rule for one file.
 *
 * A read inside a `runOperation`/`defineWriteAction` span is exempt: the
 * pipeline already authorises before any write, using the same getter this
 * rule protects. Everywhere else, reading a protected table's row directly
 * bypasses the one thing the getter guarantees: not-found on forbidden, with
 * suspended members excluded (§8.1 layer 2).
 */
const checkProtectedReads = (file: BoundarySourceFile): BoundaryViolation[] => {
  if (!PROTECTED_READ_CHECKED_PREFIXES.some((p) => file.path.startsWith(p))) {
    return [];
  }
  if (PROTECTED_READ_ALLOWED_PREFIXES.some((p) => file.path.startsWith(p))) {
    return [];
  }

  const spans = pipelineSpans(file.text);
  const insidePipeline = (index: number): boolean =>
    spans.some(([start, end]) => index >= start && index <= end);

  const violations: BoundaryViolation[] = [];
  const lines = file.text.split("\n");
  for (const match of file.text.matchAll(PROTECTED_READ)) {
    if (insidePipeline(match.index)) {
      continue;
    }
    // Anchored on the `.from(...)` line itself, not `statementStartLine`:
    // that walk stops at the first `{` or `}` it meets going backward, which
    // is the closing brace of a `.select({ ... })` argument long before the
    // statement's own start when one precedes the match, as it almost always
    // does here. The marker sits directly above the line naming the table.
    const line = lineOf(file.text, match.index);
    if (hasMarkerAbove(lines, line, "allow-raw-read")) {
      continue;
    }
    violations.push({
      path: file.path,
      line,
      rule: "protected-read-outside-getter",
      message:
        `reads ${match[1]} directly. Protected tables are read through the ` +
        `access-aware getter in packages/core/src/access, which excludes ` +
        `suspended members and returns not-found on forbidden.`,
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
    ...checkMutations(file),
    ...checkProtectedReads(file),
  ]);
}
