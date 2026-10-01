import { createServer, type Server, type Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { ClamdScanner, parseReply } from "../src/drivers/scan/clamd.ts";
import { ScannerUnavailableError } from "../src/ports/scan.ts";

/**
 * The clamd driver, against a fake clamd on a real socket (completeness review
 * M-24).
 *
 * A real socket rather than a mocked one, for the reason `smtp.test.ts` gives:
 * the failures an operator meets are connection failures. The fake parses
 * `INSTREAM` the way clamd does, so a framing mistake in the driver shows up
 * here as the wrong bytes arriving rather than as a test that passes anyway.
 */

let server: Server | undefined;
const connections = new Set<Socket>();

afterEach(async () => {
  // `close` waits for every open connection, and a server that never reads
  // never notices the other side has gone, so each is ended here.
  for (const socket of connections) {
    socket.destroy();
  }
  connections.clear();
  if (server) {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;
  }
});

/** Listens on a free local port, remembering each connection it accepts. */
async function listen(onConnection: (socket: Socket) => void): Promise<number> {
  server = createServer((socket) => {
    connections.add(socket);
    onConnection(socket);
  });
  const listening = server;
  await new Promise<void>((resolve) =>
    listening.listen(0, "127.0.0.1", resolve),
  );
  return (listening.address() as { port: number }).port;
}

/**
 * A clamd that reads one `zINSTREAM` stream, hands what it received to
 * `answer`, and writes the reply NUL-terminated. `received` holds every stream
 * it was sent, reassembled from its chunks.
 */
async function fakeClamd(answer: (file: Buffer) => string): Promise<{
  port: number;
  received: Buffer[];
}> {
  const received: Buffer[] = [];
  const port = await listen((socket) => {
    let buffered = Buffer.alloc(0);
    let commandRead = false;
    const chunks: Buffer[] = [];
    socket.on("data", (data: Buffer) => {
      buffered = Buffer.concat([buffered, data]);
      if (!commandRead) {
        const end = buffered.indexOf(0);
        if (end === -1) {
          return;
        }
        const command = buffered.subarray(0, end).toString();
        if (command !== "zINSTREAM") {
          socket.end("UNKNOWN COMMAND\0");
          return;
        }
        commandRead = true;
        buffered = buffered.subarray(end + 1);
      }
      while (buffered.byteLength >= 4) {
        const length = buffered.readUInt32BE(0);
        if (length === 0) {
          const file = Buffer.concat(chunks);
          received.push(file);
          socket.end(`${answer(file)}\0`);
          return;
        }
        if (buffered.byteLength < 4 + length) {
          return;
        }
        chunks.push(buffered.subarray(4, 4 + length));
        buffered = buffered.subarray(4 + length);
      }
    });
  });
  return { port, received };
}

/**
 * What the fake treats as infected. Not the EICAR test string: a checkout on a
 * machine with a real scanner would have this file quarantined for carrying it.
 */
const FLAGGED = Buffer.from("m24-pretend-malware");

describe("scanning over INSTREAM", () => {
  it("reports a clean file, and clamd received exactly the bytes sent", async () => {
    const clamd = await fakeClamd(() => "stream: OK");
    // Several chunks, so the framing is exercised rather than one write.
    const file = Buffer.alloc(10_000, 7);
    const scanner = new ClamdScanner({
      host: "127.0.0.1",
      port: clamd.port,
      chunkBytes: 4096,
    });

    await expect(scanner.scan(file)).resolves.toEqual({ verdict: "clean" });
    expect(clamd.received).toHaveLength(1);
    expect(clamd.received[0]?.equals(file)).toBe(true);
  });

  it("reports the signature clamd found", async () => {
    const clamd = await fakeClamd((file) =>
      file.equals(FLAGGED)
        ? "stream: Pretend.Test-Signature FOUND"
        : "stream: OK",
    );
    const scanner = new ClamdScanner({ host: "127.0.0.1", port: clamd.port });

    await expect(scanner.scan(FLAGGED)).resolves.toEqual({
      verdict: "found",
      signature: "Pretend.Test-Signature",
    });
  });

  it("reports a file clamd would not scan as refused, not as clean", async () => {
    const clamd = await fakeClamd(() => "INSTREAM size limit exceeded. ERROR");
    const scanner = new ClamdScanner({ host: "127.0.0.1", port: clamd.port });

    await expect(scanner.scan(Buffer.from("big"))).resolves.toEqual({
      verdict: "refused",
      reason: "INSTREAM size limit exceeded.",
    });
  });

  it("throws, rather than guessing, when nothing is listening", async () => {
    // Bind a port, then free it, so the address is one nothing answers on.
    const clamd = await fakeClamd(() => "stream: OK");
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;

    const scanner = new ClamdScanner({ host: "127.0.0.1", port: clamd.port });
    await expect(scanner.scan(Buffer.from("anything"))).rejects.toBeInstanceOf(
      ScannerUnavailableError,
    );
  });

  it("throws when clamd accepts the connection and never answers", async () => {
    const port = await listen(() => {
      // Silent. The hang an operator meets when the port is right and the
      // daemon is stuck.
    });

    const scanner = new ClamdScanner({
      host: "127.0.0.1",
      port,
      timeoutMs: 200,
    });
    await expect(scanner.scan(Buffer.from("anything"))).rejects.toThrow(
      /did not answer within 200 ms/,
    );
  });
});

describe("reading clamd's reply", () => {
  it("reads each of the three answers", () => {
    expect(parseReply("stream: OK\0")).toEqual({ verdict: "clean" });
    expect(parseReply("stream: Win.Test.EICAR_HDB-1 FOUND\0")).toEqual({
      verdict: "found",
      signature: "Win.Test.EICAR_HDB-1",
    });
    expect(parseReply("INSTREAM size limit exceeded. ERROR\0")).toEqual({
      verdict: "refused",
      reason: "INSTREAM size limit exceeded.",
    });
  });

  it("treats a reply clamd never gives as an outage", () => {
    expect(() => parseReply("HTTP/1.1 400 Bad Request\r\n")).toThrow(
      ScannerUnavailableError,
    );
  });
});
