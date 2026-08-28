/**
 * The device login, from the terminal's side (P5-T07c-b).
 *
 * `okr login --url <instance>` with no token asks the instance to start a
 * request, prints the link, opens a browser if it can, and polls until somebody
 * answers. Nothing here holds a password and nothing types one: the browser
 * already has a session, and this waits for it.
 *
 * **The protocol's own words come back and are read as they are.**
 * `authorization_pending` means keep waiting, `slow_down` means wait longer,
 * `expired_token` and `access_denied` are the two ways it ends without a token.
 * A client that guessed from status codes would have to treat all four as the
 * same failure.
 */
import { spawn } from "node:child_process";
import { hostname, platform, userInfo } from "node:os";

export interface DeviceStart {
  readonly deviceCode: string;
  readonly userCode: string;
  readonly verificationUri: string;
  readonly expiresIn: number;
  readonly interval: number;
}

export type DevicePoll =
  | { readonly kind: "granted"; readonly token: string }
  | { readonly kind: "pending"; readonly slowDown: boolean }
  | { readonly kind: "ended"; readonly message: string };

/** What this terminal calls itself, so the approval screen can name it. */
export function clientName(): string {
  try {
    return `okr on ${hostname()} (${userInfo().username})`;
  } catch {
    // A container with no passwd entry still has a hostname, and if it has
    // neither then a plain name is better than a crash during a login.
    return "okr in a terminal";
  }
}

/** Trims trailing slashes without a regular expression. 47 is `/`. */
function root(base: string): string {
  let end = base.length;
  while (end > 0 && base.charCodeAt(end - 1) === 47) {
    end -= 1;
  }
  return base.slice(0, end);
}

export async function startDevice(
  base: string,
  scopes: readonly string[],
  call: typeof globalThis.fetch = globalThis.fetch,
): Promise<{ started: DeviceStart } | { error: string }> {
  const response = await call(`${root(base)}/api/v1/cli/device`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scopes, clientName: clientName() }),
  });
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try {
    body = text === "" ? {} : (JSON.parse(text) as Record<string, unknown>);
  } catch {
    return {
      error: `${base} answered ${response.status} with something that is not JSON. Is that an OpenOKR instance?`,
    };
  }
  if (!response.ok) {
    const error = (body.error ?? {}) as { message?: string };
    return {
      error: error.message ?? `The instance answered ${response.status}.`,
    };
  }
  return { started: body.data as DeviceStart };
}

export async function pollDevice(
  base: string,
  deviceCode: string,
  call: typeof globalThis.fetch = globalThis.fetch,
): Promise<DevicePoll> {
  const response = await call(`${root(base)}/api/v1/cli/device/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ deviceCode }),
  });
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try {
    body = text === "" ? {} : (JSON.parse(text) as Record<string, unknown>);
  } catch {
    return { kind: "ended", message: "The instance answered with no JSON." };
  }

  if (response.ok) {
    const data = (body.data ?? {}) as { token?: string };
    return data.token
      ? { kind: "granted", token: data.token }
      : { kind: "ended", message: "The instance granted nothing." };
  }

  const error = (body.error ?? {}) as { code?: string; message?: string };
  switch (error.code) {
    case "authorization_pending":
      return { kind: "pending", slowDown: false };
    case "slow_down":
      return { kind: "pending", slowDown: true };
    default:
      return {
        kind: "ended",
        message: error.message ?? "That login did not complete.",
      };
  }
}

/**
 * Opens the browser, if this machine has one to open.
 *
 * Best effort and deliberately silent about failing: the link is printed either
 * way, and a login over SSH where nothing opens is the normal case rather than
 * an error. Detached and with its streams ignored, so a browser that keeps
 * running does not hold the terminal open.
 */
export function openBrowser(url: string): void {
  try {
    const [command, args] =
      platform() === "win32"
        ? // `start` is a shell builtin, and the empty string is the window
          // title `start` would otherwise take the URL for.
          (["cmd", ["/c", "start", "", url]] as const)
        : platform() === "darwin"
          ? (["open", [url]] as const)
          : (["xdg-open", [url]] as const);
    const child = spawn(command, [...args], {
      detached: true,
      stdio: "ignore",
    });
    child.on("error", () => {
      // No browser, no display, no such command. The printed link is the answer.
    });
    child.unref();
  } catch {
    // As above.
  }
}
