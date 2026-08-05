/**
 * The WebSocket server that carries realtime events to browsers.
 *
 * It is a bridge, not a source of truth: it forwards the compact events the
 * Realtime port publishes, and clients refetch through the normal read path,
 * which keeps row-level security and `can()` in the loop.
 *
 * Both authorisation hooks are required rather than optional. A socket
 * server that defaults to accepting every connection and every channel is
 * exactly the mistake worth making impossible to fall into by accident.
 */
import { randomUUID } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import type {
  Realtime,
  RealtimeEvent,
  Subscription,
} from "../../ports/realtime.ts";

export interface SocketPrincipal {
  /** Whatever the host application needs to authorise channels. */
  readonly [key: string]: unknown;
}

export interface RealtimeSocketServerOptions {
  readonly realtime: Realtime;
  /** Resolves the connecting principal. Return null to refuse the socket. */
  readonly authorize: (
    request: IncomingMessage,
  ) => Promise<SocketPrincipal | null>;
  /** Decides whether this principal may listen to this channel. */
  readonly authorizeChannel: (
    principal: SocketPrincipal,
    channel: string,
  ) => Promise<boolean>;
  /** An existing HTTP server to attach to, or a port to listen on. */
  readonly server?: Server;
  readonly port?: number;
  readonly path?: string;
  readonly onError?: (error: unknown) => void;
}

interface ClientMessage {
  readonly type: string;
  readonly channel?: string;
}

interface SocketState {
  readonly principal: SocketPrincipal;
  /** This socket's identity for self-echo suppression. */
  readonly origin: string;
  readonly subscriptions: Map<string, Subscription>;
}

export class RealtimeSocketServer {
  readonly #options: RealtimeSocketServerOptions;
  readonly #states = new WeakMap<WebSocket, SocketState>();
  #wss: WebSocketServer | undefined;

  constructor(options: RealtimeSocketServerOptions) {
    this.#options = options;
  }

  listen(): void {
    if (this.#wss) {
      return;
    }
    this.#wss = new WebSocketServer(
      this.#options.server
        ? { server: this.#options.server, path: this.#options.path }
        : { port: this.#options.port ?? 0, path: this.#options.path },
    );

    this.#wss.on("connection", (socket, request) => {
      void this.#onConnection(socket, request);
    });
    this.#wss.on("error", (error) => this.#options.onError?.(error));
  }

  /** The bound port. Useful when the server was started on port 0. */
  get port(): number | undefined {
    const address = this.#wss?.address();
    return typeof address === "object" && address !== null
      ? address.port
      : undefined;
  }

  async #onConnection(
    socket: WebSocket,
    request: IncomingMessage,
  ): Promise<void> {
    let principal: SocketPrincipal | null = null;
    try {
      principal = await this.#options.authorize(request);
    } catch (error) {
      this.#options.onError?.(error);
    }

    if (!principal) {
      // 1008 is "policy violation": the socket was refused, not broken.
      socket.close(1008, "unauthorized");
      return;
    }

    const state: SocketState = {
      principal,
      origin: randomUUID(),
      subscriptions: new Map(),
    };
    this.#states.set(socket, state);

    // The client echoes this origin back when it writes, so its own changes
    // do not come back to it as events.
    this.#send(socket, { type: "ready", origin: state.origin });

    socket.on("message", (raw) => {
      void this.#onMessage(socket, state, raw.toString());
    });
    socket.on("close", () => {
      void this.#cleanup(state);
    });
    socket.on("error", (error) => this.#options.onError?.(error));
  }

  async #onMessage(
    socket: WebSocket,
    state: SocketState,
    raw: string,
  ): Promise<void> {
    let message: ClientMessage;
    try {
      message = JSON.parse(raw) as ClientMessage;
    } catch {
      this.#send(socket, { type: "error", message: "malformed message" });
      return;
    }

    const channel = message.channel;
    if (typeof channel !== "string" || channel === "") {
      this.#send(socket, { type: "error", message: "a channel is required" });
      return;
    }

    if (message.type === "subscribe") {
      if (state.subscriptions.has(channel)) {
        return;
      }
      const allowed = await this.#options
        .authorizeChannel(state.principal, channel)
        .catch((error) => {
          this.#options.onError?.(error);
          return false;
        });
      if (!allowed) {
        this.#send(socket, {
          type: "error",
          message: "forbidden channel",
          channel,
        });
        return;
      }

      const subscription = await this.#options.realtime.subscribe(
        channel,
        (event: RealtimeEvent) =>
          this.#send(socket, { type: "event", channel, event }),
        { origin: state.origin },
      );
      state.subscriptions.set(channel, subscription);
      this.#send(socket, { type: "subscribed", channel });
      return;
    }

    if (message.type === "unsubscribe") {
      const subscription = state.subscriptions.get(channel);
      if (subscription) {
        state.subscriptions.delete(channel);
        await subscription.unsubscribe();
      }
      this.#send(socket, { type: "unsubscribed", channel });
      return;
    }

    this.#send(socket, { type: "error", message: `unknown message type` });
  }

  async #cleanup(state: SocketState): Promise<void> {
    const subscriptions = [...state.subscriptions.values()];
    state.subscriptions.clear();
    await Promise.all(
      subscriptions.map((subscription) =>
        subscription
          .unsubscribe()
          .catch((error) => this.#options.onError?.(error)),
      ),
    );
  }

  #send(socket: WebSocket, message: Record<string, unknown>): void {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }

  async close(): Promise<void> {
    const wss = this.#wss;
    this.#wss = undefined;
    if (!wss) {
      return;
    }
    for (const client of wss.clients) {
      client.terminate();
    }
    await new Promise<void>((resolve, reject) => {
      wss.close((error) => (error ? reject(error) : resolve()));
    });
  }
}
