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
  const listening = server;
  await new Promise<void>((resolve) =>
    listening.listen(0, "127.0.0.1", resolve),
  );
  return (listening.address() as { port: number }).port;
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
  const listening = server;
  await new Promise<void>((resolve) =>
    listening.listen(0, "127.0.0.1", resolve),
  );
  return (listening.address() as { port: number }).port;
};

/**
 * A server that advertises AUTH, refuses it, and quotes the credentials back.
 *
 * Real servers do this. The refusal text is the SMTP conversation, and the
 * conversation contains the base64 AUTH line, so this is the one path where a
 * password can reach an operator's screen. Every other test here fails at the
 * socket, long before AUTH, which is why the redaction went unproven.
 */
const rejectingAuthServer = async (): Promise<number> => {
  server = createServer((socket) => {
    socket.write("220 localhost ESMTP test\r\n");
    socket.on("data", (chunk) => {
      const line = chunk.toString();
      if (line.startsWith("EHLO") || line.startsWith("HELO")) {
        socket.write("250-localhost\r\n250 AUTH PLAIN LOGIN\r\n");
      } else if (line.startsWith("AUTH")) {
        // Echo the client's own line back inside the error, transcript and all.
        socket.write(`535 5.7.8 rejected: ${line.trim()}\r\n`);
      } else if (line.startsWith("QUIT")) {
        socket.write("221 Bye\r\n");
        socket.end();
      } else {
        socket.write("250 OK\r\n");
      }
    });
  });
  const listening = server;
  await new Promise<void>((resolve) =>
    listening.listen(0, "127.0.0.1", resolve),
  );
  return (listening.address() as { port: number }).port;
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

  it("keeps the password out of a rejected AUTH transcript", async () => {
    // Redacting base64(password) is not enough. AUTH PLAIN sends
    // base64(NUL user NUL pass), and whether base64(pass) survives as a
    // substring of that depends on byte alignment: base64 encodes in groups of
    // three, so the password re-encodes identically only when the prefix
    // length is a multiple of three.
    //
    // "postmaster" gives a seven-plus-two... twelve-byte prefix and happens to
    // align, which is why the older redaction looked adequate. "admin" gives a
    // seven-byte prefix and does not, so the password went out unredacted for
    // roughly two usernames in three.
    const port = await rejectingAuthServer();
    const mailer = new SmtpMailer({
      host: "127.0.0.1",
      port,
      secure: false,
      from: "openokr@localhost",
      user: "admin",
      password: "hunter2",
      requireTls: false,
      timeoutMs: 2_000,
    });

    const result = await mailer.verify();
    expect(result.ok).toBe(false);

    const message = result.ok === false ? result.message : "";
    expect(message).not.toContain("hunter2");
    // And not in any encoding of it that appeared on the wire. AUTH PLAIN
    // separates its fields with NUL, written here as an escape rather than
    // a control character sitting invisibly in the source.
    const NUL = "\u0000";
    for (const encoded of [
      Buffer.from("hunter2", "utf8").toString("base64"),
      Buffer.from(`${NUL}admin${NUL}hunter2`, "utf8").toString("base64"),
      Buffer.from(`admin${NUL}admin${NUL}hunter2`, "utf8").toString("base64"),
    ]) {
      expect(message).not.toContain(encoded);
    }
    // Anything base64 that survives must not decode to the password.
    for (const token of message.match(/[A-Za-z0-9+/]{8,}={0,2}/g) ?? []) {
      expect(Buffer.from(token, "base64").toString("utf8")).not.toContain(
        "hunter2",
      );
    }
  }, 10_000);
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

describe("stop", () => {
  it("releases the transport without throwing (P1-hardening: Adapters.close() used to skip this port)", async () => {
    const port = await politeServer();
    const mailer = new SmtpMailer({
      host: "127.0.0.1",
      port,
      secure: false,
      from: "openokr@localhost",
      requireTls: false,
    });

    await expect(mailer.stop()).resolves.toBeUndefined();
  });
});
