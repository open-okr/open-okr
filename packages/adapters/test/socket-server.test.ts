import {
  connectionOptions,
  testDbEnv,
  workerDb,
} from "@openokr/test-support/db";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { PostgresRealtime } from "../src/drivers/realtime/postgres.ts";
import { RealtimeSocketServer } from "../src/drivers/realtime/socket-server.ts";

/**
 * The WebSocket bridge. What matters here is that it refuses what it should:
 * an unauthorised connection, and a channel the principal may not read.
 */

let bus: PostgresRealtime;
let server: RealtimeSocketServer;
const sockets: WebSocket[] = [];

interface Harness {
  readonly authorized?: boolean;
  readonly allowedChannels?: readonly string[];
}

const start = async ({ authorized = true, allowedChannels }: Harness = {}) => {
  const wb = await workerDb();
  bus = new PostgresRealtime({
    connectionOptions: connectionOptions(wb.databaseName, testDbEnv.superuser),
  });
  server = new RealtimeSocketServer({
    realtime: bus,
    authorize: async () => (authorized ? { memberId: "m1" } : null),
    authorizeChannel: async (_principal, channel) =>
      allowedChannels === undefined || allowedChannels.includes(channel),
  });
  server.listen();
  return server;
};

/** Opens a client socket and collects every message it receives. */
const connect = async (): Promise<{
  socket: WebSocket;
  messages: Record<string, unknown>[];
}> => {
  const socket = new WebSocket(`ws://127.0.0.1:${server.port}`);
  sockets.push(socket);
  const messages: Record<string, unknown>[] = [];
  socket.on("message", (raw) => {
    messages.push(JSON.parse(raw.toString()) as Record<string, unknown>);
  });
  return { socket, messages };
};

const waitFor = async <T>(
  get: () => T | undefined,
  timeoutMs = 5000,
): Promise<T> => {
  const started = Date.now();
  for (;;) {
    const value = get();
    if (value !== undefined) {
      return value;
    }
    if (Date.now() - started > timeoutMs) {
      throw new Error("Timed out waiting for a socket message.");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

const messageOfType = (messages: Record<string, unknown>[], type: string) =>
  messages.find((message) => message.type === type);

beforeEach(async () => {
  sockets.length = 0;
});

afterEach(async () => {
  for (const socket of sockets) {
    socket.terminate();
  }
  await server?.close();
  await bus?.stop();
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("RealtimeSocketServer", () => {
  it("greets an authorised client with its origin", async () => {
    await start();
    const { messages } = await connect();
    const ready = await waitFor(() => messageOfType(messages, "ready"));
    expect(ready.origin).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("closes an unauthorised connection", async () => {
    await start({ authorized: false });
    const { socket } = await connect();
    const code = await new Promise<number>((resolve) => {
      socket.on("close", (closeCode) => resolve(closeCode));
    });
    expect(code).toBe(1008);
  });

  it("forwards events on a subscribed channel", async () => {
    await start();
    const { socket, messages } = await connect();
    await waitFor(() => messageOfType(messages, "ready"));

    socket.send(
      JSON.stringify({ type: "subscribe", channel: "workspace:w1:goals" }),
    );
    await waitFor(() => messageOfType(messages, "subscribed"));

    await bus.publish("workspace:w1:goals", {
      name: "goal.updated",
      data: { goalId: "g1" },
    });

    const event = await waitFor(() => messageOfType(messages, "event"));
    expect(event).toMatchObject({
      channel: "workspace:w1:goals",
      event: { name: "goal.updated", data: { goalId: "g1" } },
    });
  });

  it("refuses a channel the principal may not read", async () => {
    await start({ allowedChannels: ["workspace:w1:goals"] });
    const { socket, messages } = await connect();
    await waitFor(() => messageOfType(messages, "ready"));

    socket.send(
      JSON.stringify({ type: "subscribe", channel: "workspace:w2:goals" }),
    );

    const error = await waitFor(() => messageOfType(messages, "error"));
    expect(error.message).toMatch(/forbidden/i);

    await bus.publish("workspace:w2:goals", { name: "goal.updated", data: {} });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(messageOfType(messages, "event")).toBeUndefined();
  });

  it("does not echo a change back to the socket that made it", async () => {
    await start();
    const { socket, messages } = await connect();
    const ready = await waitFor(() => messageOfType(messages, "ready"));
    const origin = ready.origin as string;

    socket.send(
      JSON.stringify({ type: "subscribe", channel: "workspace:w1:goals" }),
    );
    await waitFor(() => messageOfType(messages, "subscribed"));

    // The client passes its origin when it writes; the event comes back
    // stamped with it and is suppressed for that socket.
    await bus.publish("workspace:w1:goals", {
      name: "goal.updated",
      data: {},
      origin,
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(messageOfType(messages, "event")).toBeUndefined();

    // An event from anyone else still arrives.
    await bus.publish("workspace:w1:goals", {
      name: "goal.updated",
      data: {},
      origin: "someone-else",
    });
    expect(await waitFor(() => messageOfType(messages, "event"))).toBeDefined();
  });

  it("stops forwarding after unsubscribe", async () => {
    await start();
    const { socket, messages } = await connect();
    await waitFor(() => messageOfType(messages, "ready"));
    socket.send(
      JSON.stringify({ type: "subscribe", channel: "workspace:w1:goals" }),
    );
    await waitFor(() => messageOfType(messages, "subscribed"));

    socket.send(
      JSON.stringify({ type: "unsubscribe", channel: "workspace:w1:goals" }),
    );
    await waitFor(() => messageOfType(messages, "unsubscribed"));

    await bus.publish("workspace:w1:goals", { name: "goal.updated", data: {} });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(messageOfType(messages, "event")).toBeUndefined();
  });

  it("answers a malformed message with an error rather than dropping the socket", async () => {
    await start();
    const { socket, messages } = await connect();
    await waitFor(() => messageOfType(messages, "ready"));

    socket.send("not json at all");
    const error = await waitFor(() => messageOfType(messages, "error"));
    expect(error.message).toMatch(/malformed/i);
    expect(socket.readyState).toBe(WebSocket.OPEN);
  });
});
