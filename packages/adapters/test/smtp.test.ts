import { createServer, type Server } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { SmtpMailer } from "../src/drivers/mail/smtp.ts";

/**
 * The SMTP driver, and the connection test the wizard runs.
 *
 * These talk to a real socket rather than a mocked transport, because the
 * failures that matter to an operator are connection failures: a wrong port, a
 * host that is not listening, a server that accepts the socket and then never
 * speaks. A mock proves none of those.
 */

let server: Server | undefined;

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;
  }
});

/** A socket that accepts a connection and says nothing, ever. */
const silentServer = async (): Promise<number> => {
  server = createServer(() => {
    // Deliberately no greeting. This is the hang an operator hits when they
    // point port 587 at something that is not an SMTP server.
  });
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  return (server?.address() as { port: number }).port;
};

/** A socket that greets and then accepts anything, enough for a handshake. */
const politeServer = async (): Promise<number> => {
  server = createServer((socket) => {
    socket.write("220 localhost ESMTP test\r\n");
    socket.on("data", (chunk) => {
      const line = chunk.toString();
      if (line.startsWith("EHLO") || line.startsWith("HELO")) {
        socket.write("250-localhost\r\n250 HELP\r\n");
      } else if (line.startsWith("QUIT")) {
        socket.write("221 Bye\r\n");
        socket.end();
      } else {
        socket.write("250 OK\r\n");
      }
    });
  });
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  return (server?.address() as { port: number }).port;
};

describe("the connection test", () => {
  it("succeeds against a server that greets", async () => {
    const port = await politeServer();
    const mailer = new SmtpMailer({
      host: "127.0.0.1",
      port,
      secure: false,
      from: "openokr@localhost",
      requireTls: false,
    });

    await expect(mailer.verify()).resolves.toMatchObject({ ok: true });
  });

  it("fails against a port with nothing on it, and says so plainly", async () => {
    // Port 1 is reserved and never listening in a test environment.
    const mailer = new SmtpMailer({
      host: "127.0.0.1",
      port: 1,
      secure: false,
      from: "openokr@localhost",
      requireTls: false,
      timeoutMs: 2_000,
    });

    const result = await mailer.verify();
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toBeTruthy();
  });

  it("gives up on a server that accepts and never speaks", async () => {
    // Without a timeout this hangs forever, and a wizard step that hangs is
    // worse than one that fails: the operator has nothing to act on.
    const port = await silentServer();
    const mailer = new SmtpMailer({
      host: "127.0.0.1",
      port,
      secure: false,
      from: "openokr@localhost",
      requireTls: false,
      timeoutMs: 1_000,
    });

    const result = await mailer.verify();
    expect(result.ok).toBe(false);
  }, 10_000);

  it("never puts the password in the failure message", async () => {
    const mailer = new SmtpMailer({
      host: "127.0.0.1",
      port: 1,
      secure: false,
      from: "openokr@localhost",
      user: "postmaster",
      password: "hunter2",
      requireTls: false,
      timeoutMs: 2_000,
    });

    const result = await mailer.verify();
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("hunter2");
  });
});

describe("sending", () => {
  it("reports a send failure rather than resolving quietly", async () => {
    const mailer = new SmtpMailer({
      host: "127.0.0.1",
      port: 1,
      secure: false,
      from: "openokr@localhost",
      requireTls: false,
      timeoutMs: 2_000,
    });

    await expect(
      mailer.send({ to: "a@example.com", subject: "s", text: "t" }),
    ).rejects.toThrow();
  });

  it("never puts the password in a send error either", async () => {
    const mailer = new SmtpMailer({
      host: "127.0.0.1",
      port: 1,
      secure: false,
      from: "openokr@localhost",
      user: "postmaster",
      password: "hunter2",
      requireTls: false,
      timeoutMs: 2_000,
    });

    const failure = await mailer
      .send({ to: "a@example.com", subject: "s", text: "t" })
      .then(
        () => "",
        (error: unknown) => String(error),
      );

    expect(failure).not.toContain("hunter2");
  });
});
