/**
 * The ClamAV driver, speaking clamd's own protocol (completeness review M-24).
 *
 * **Node's `net` module and nothing else.** clamd's `INSTREAM` command is a
 * few bytes of framing over TCP, so a client library would be a dependency for
 * forty lines. The human chose this on 28 September 2026.
 *
 * **The protocol, as clamd documents it.** Send `zINSTREAM` and a NUL, then
 * the file as chunks, each a four-byte big-endian length followed by that many
 * bytes, then a zero length to say the stream has ended. clamd answers one
 * NUL-terminated line and closes:
 *
 * | Reply | Verdict |
 * |---|---|
 * | `stream: OK` | clean |
 * | `stream: Eicar-Signature FOUND` | found, with the signature's name |
 * | `INSTREAM size limit exceeded. ERROR` | refused: clamd will not scan it |
 *
 * **Anything that is not a reply is an outage, never a verdict.** A refused
 * connection, a timeout, or a socket closed with nothing said all throw
 * `ScannerUnavailableError`, so the file stays held and the caller tries
 * again. Guessing "clean" when the scanner said nothing would make the scan
 * hook a formality.
 */
import { connect } from "node:net";
import {
  type FileScanner,
  ScannerUnavailableError,
  type ScanVerdict,
} from "../../ports/scan.ts";

export interface ClamdScannerOptions {
  readonly host: string;
  readonly port: number;
  /** How long one scan may take, connecting included. Defaults to a minute. */
  readonly timeoutMs?: number;
  /** The size of each `INSTREAM` chunk. Defaults to 64 KiB. */
  readonly chunkBytes?: number;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_CHUNK_BYTES = 64 * 1024;

export class ClamdScanner implements FileScanner {
  readonly #host: string;
  readonly #port: number;
  readonly #timeoutMs: number;
  readonly #chunkBytes: number;

  constructor(options: ClamdScannerOptions) {
    this.#host = options.host;
    this.#port = options.port;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#chunkBytes = options.chunkBytes ?? DEFAULT_CHUNK_BYTES;
  }

  scan(body: Buffer): Promise<ScanVerdict> {
    const where = `clamd at ${this.#host}:${this.#port}`;

    return new Promise((resolve, reject) => {
      const socket = connect({ host: this.#host, port: this.#port });
      const received: Buffer[] = [];
      let settled = false;

      const settle = (outcome: () => void) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        outcome();
      };

      /** Reads whatever clamd has said so far as a verdict, or as an outage. */
      const conclude = (why: string) => {
        const reply = Buffer.concat(received).toString("utf8");
        settle(() => {
          if (reply.trim() === "") {
            reject(new ScannerUnavailableError(`${where} ${why}`));
            return;
          }
          try {
            resolve(parseReply(reply));
          } catch (error) {
            reject(error);
          }
        });
      };

      const timer = setTimeout(() => {
        settle(() =>
          reject(
            new ScannerUnavailableError(
              `${where} did not answer within ${this.#timeoutMs} ms`,
            ),
          ),
        );
      }, this.#timeoutMs);

      socket.on("connect", () => {
        socket.write("zINSTREAM\0");
        for (
          let offset = 0;
          offset < body.byteLength;
          offset += this.#chunkBytes
        ) {
          const chunk = body.subarray(offset, offset + this.#chunkBytes);
          const length = Buffer.alloc(4);
          length.writeUInt32BE(chunk.byteLength);
          socket.write(length);
          socket.write(chunk);
        }
        // A zero-length chunk is how the stream says it has ended.
        socket.write(Buffer.alloc(4));
      });

      socket.on("data", (data: Buffer) => {
        received.push(data);
        // The `z` prefix asks for a NUL-terminated reply, so the NUL is the
        // end of the answer even if clamd keeps the socket open.
        if (data.includes(0)) {
          conclude("answered");
        }
      });

      // clamd may answer and close while this side is still writing, which is
      // what an over-size stream looks like: the reply arrives, then the write
      // fails. So an error or a close reads what was said before deciding.
      socket.on("error", (error: Error) => {
        conclude(`could not be reached: ${error.message}`);
      });
      socket.on("close", () => {
        conclude("closed the connection without an answer");
      });
    });
  }
}

/** Turns clamd's one-line reply into a verdict. Exported for its tests. */
export function parseReply(raw: string): ScanVerdict {
  // Everything up to the NUL, without the stream's own label.
  const line = (raw.split("\0")[0] ?? "").trim();
  const text = line.replace(/^stream:\s*/, "");

  if (text === "OK") {
    return { verdict: "clean" };
  }
  if (text.endsWith(" FOUND")) {
    return {
      verdict: "found",
      signature: text.slice(0, -" FOUND".length).trim(),
    };
  }
  if (text.endsWith("ERROR")) {
    return {
      verdict: "refused",
      reason: text.slice(0, -"ERROR".length).trim() || "clamd refused",
    };
  }
  // Not a reply clamd gives to INSTREAM, which usually means something else
  // is listening on that port. That is a configuration to fix, not a verdict.
  throw new ScannerUnavailableError(
    `The scanner answered something that is not a clamd reply: ${JSON.stringify(line.slice(0, 120))}`,
  );
}
