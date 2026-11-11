import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { OtelTelemetry } from "../src/drivers/telemetry/otel.ts";

// Plan 0.8.0 H14: a hosted collector wants an auth header. The OpenTelemetry
// exporter reads OTEL_EXPORTER_OTLP_HEADERS from the environment, as the
// convention names it; this holds that true for the version installed, so an
// upgrade that drops it fails here rather than in somebody's collector.

const saved = process.env.OTEL_EXPORTER_OTLP_HEADERS;

afterEach(() => {
  if (saved === undefined) {
    delete process.env.OTEL_EXPORTER_OTLP_HEADERS;
  } else {
    process.env.OTEL_EXPORTER_OTLP_HEADERS = saved;
  }
});

describe("the OTLP exporter", () => {
  it("sends the headers OTEL_EXPORTER_OTLP_HEADERS names", async () => {
    const received: IncomingHttpHeaders[] = [];
    const server = createServer((request, response) => {
      received.push(request.headers);
      request.resume();
      request.on("end", () => {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end("{}");
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const { port } = server.address() as AddressInfo;

    process.env.OTEL_EXPORTER_OTLP_HEADERS =
      "authorization=Bearer test-token,x-team=okr";
    const telemetry = new OtelTelemetry({
      otlpEndpoint: `http://127.0.0.1:${port}/v1/traces`,
    });
    await telemetry.span("action goals.create", {}, async () => "done");
    // Stopping flushes the batch, which is when the request is sent.
    await telemetry.stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));

    expect(received.length).toBeGreaterThan(0);
    expect(received[0]?.authorization).toBe("Bearer test-token");
    expect(received[0]?.["x-team"]).toBe("okr");
  });
});
