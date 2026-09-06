/**
 * One command as one request (P5-T07c-a).
 *
 * **The method comes from the artifact, which got it from the safety class.** A
 * read is a GET with query parameters and a write is a POST with a JSON body,
 * decided once in the registry and carried here. The tool never chooses.
 *
 * **The server's own words are what a person reads.** Every refusal on the REST
 * surface is a typed code and a sentence written for a person; reprinting it is
 * strictly better than this file inventing "authentication failed" over the top
 * of "That token has been revoked."
 */
import type { CliCommand } from "./contract.ts";
import type { Profile } from "./profiles.ts";

export interface Answer {
  readonly ok: boolean;
  readonly status: number;
  /** The action's own output, on success. */
  readonly data?: unknown;
  readonly nextCursor?: string | null;
  /** The typed code, on a refusal. */
  readonly code?: string;
  readonly message?: string;
  readonly fields?: Readonly<Record<string, string>>;
}

/** Query string for a read: one parameter per field, JSON for the rest. */
export function queryFor(
  input: Readonly<Record<string, unknown>>,
  cursor?: string,
): string {
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    parameters.set(
      key,
      // The surface reads a value as JSON only when it looks like JSON that is
      // not a string, so a string is sent bare and everything else is encoded.
      typeof value === "string" ? value : JSON.stringify(value),
    );
  }
  if (cursor) {
    parameters.set("cursor", cursor);
  }
  const text = parameters.toString();
  return text === "" ? "" : `?${text}`;
}

export function urlFor(
  base: string,
  command: CliCommand,
  input: Readonly<Record<string, unknown>>,
  cursor?: string,
): string {
  let end = base.length;
  while (end > 0 && base.charCodeAt(end - 1) === 47) {
    end -= 1;
  }
  const root = `${base.slice(0, end)}/api/v1${command.path}`;
  return command.method === "GET" ? `${root}${queryFor(input, cursor)}` : root;
}

/**
 * Sends one command.
 *
 * `fetch` is passed in rather than reached for, so the tests drive a real HTTP
 * server without a stub and without a network.
 */
export async function send(
  command: CliCommand,
  input: Readonly<Record<string, unknown>>,
  profile: Profile,
  options: {
    readonly cursor?: string;
    readonly fetch?: typeof globalThis.fetch;
  } = {},
): Promise<Answer> {
  const call = options.fetch ?? globalThis.fetch;
  const url = urlFor(profile.url, command, input, options.cursor);

  const response = await call(url, {
    method: command.method,
    headers: {
      authorization: `Bearer ${profile.token}`,
      ...(command.method === "POST"
        ? { "content-type": "application/json" }
        : {}),
    },
    ...(command.method === "POST" ? { body: JSON.stringify(input) } : {}),
  });

  const text = await response.text();
  let body: Record<string, unknown> = {};
  try {
    body = text === "" ? {} : (JSON.parse(text) as Record<string, unknown>);
  } catch {
    // A body that is not JSON is a proxy or a sign-in page, not the surface.
    return {
      ok: false,
      status: response.status,
      code: "unreadable",
      message: `${profile.url} answered ${response.status} with something that is not JSON. Is that an OpenOKR instance?`,
    };
  }

  if (response.ok) {
    return {
      ok: true,
      status: response.status,
      data: body.data,
      nextCursor: (body.nextCursor as string | null | undefined) ?? null,
    };
  }

  const error = (body.error ?? {}) as {
    code?: string;
    message?: string;
    fields?: Record<string, string>;
  };
  return {
    ok: false,
    status: response.status,
    code: error.code ?? "unknown",
    message: error.message ?? `The instance answered ${response.status}.`,
    ...(error.fields ? { fields: error.fields } : {}),
  };
}

/** What a refusal looks like in a terminal. */
export function describe(answer: Answer): string {
  const lines = [answer.message ?? "That did not work."];
  if (answer.fields) {
    for (const [field, message] of Object.entries(answer.fields)) {
      lines.push(`  ${field}: ${message}`);
    }
  }
  return lines.join("\n");
}
