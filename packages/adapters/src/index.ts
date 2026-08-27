/**
 * `packages/adapters`: the ports every runtime-sensitive capability goes
 * through, and the drivers behind them. The only place a vendor SDK may be
 * imported (CLAUDE.md), which is what keeps the rest of the codebase
 * portable and testable.
 *
 * Consume the ports, never a driver class: `pnpm check:boundaries` fails the
 * build when application code reaches past this boundary.
 */
import { PACKAGE_NAME as CONFIG } from "@openokr/config";

export const PACKAGE_NAME = "@openokr/adapters";
export const DEPENDS_ON = [CONFIG] as const;

export {
  type AdapterOptions,
  type Adapters,
  createAdapters,
} from "./create-adapters.ts";
export {
  type AIProviderConfig,
  createAIProvider,
  defaultTierModelsFor,
} from "./create-ai-provider.ts";
export { createMailer, type MailerConfig } from "./create-mailer.ts";
// The mock driver is exported by name, the same way the socket server is:
// infrastructure another package's own test suite constructs directly,
// not something resolved through createAIProvider.
export {
  MockAIProvider,
  type MockAIProviderOptions,
  type RecordedCall,
} from "./drivers/ai/mock.ts";
export type {
  ModelTier,
  TierModelMap,
} from "./drivers/ai/tier-map.ts";
export { PostgresCache } from "./drivers/cache/postgres.ts";
export {
  type AddressLookup,
  EmailChannel,
  type EmailChannelOptions,
  renderEmailBody,
} from "./drivers/channel/email.ts";
export {
  SlackChannel,
  type SlackChannelOptions,
  SlackPermanentError,
  slackDeliveryId,
  toBlocks,
} from "./drivers/channel/slack.ts";
// The socket server is process infrastructure the host application mounts,
// not a port, so it is exported by name.
export {
  PostgresRealtime,
  type PostgresRealtimeOptions,
} from "./drivers/realtime/postgres.ts";
export {
  RealtimeSocketServer,
  type RealtimeSocketServerOptions,
  type SocketPrincipal,
} from "./drivers/realtime/socket-server.ts";
export type {
  AIProvider,
  ChatMessage,
  ChatRequest,
  ChatResponse,
  ChatRole,
  EmbedRequest,
  EmbedResponse,
  ExtractRequest,
  ModelCapabilities,
  TokenUsage,
  ToolCall,
  ToolDefinition,
} from "./ports/ai.ts";
export { AIUnavailableError } from "./ports/ai.ts";
export type { Cache, RateLimitResult } from "./ports/cache.ts";
export type {
  Channel,
  ChannelCapabilities,
  ChannelMessage,
  ChannelProvider,
  ChannelRecipient,
  DeliveryResult,
  InboundMessage,
  InboundRequest,
} from "./ports/channel.ts";
export type { JobHandler, JobOptions, JobQueue } from "./ports/jobs.ts";
export type {
  Mailer,
  MailMessage,
  MailVerifyResult,
  SentMail,
} from "./ports/mail.ts";
export type {
  Realtime,
  RealtimeEvent,
  SubscribeOptions,
  Subscription,
} from "./ports/realtime.ts";
export { EventTooLargeError, MAX_EVENT_BYTES } from "./ports/realtime.ts";
export type {
  Search,
  SearchDocument,
  SearchHit,
  SearchQuery,
} from "./ports/search.ts";
export type { FileStorage, PutOptions, StoredObject } from "./ports/storage.ts";
export { ObjectNotFoundError } from "./ports/storage.ts";
export {
  type OutboxRecord,
  OutboxRelay,
  type OutboxRelayOptions,
  PermanentDispatchError,
  type RelayClient,
  type RelayPool,
} from "./relay.ts";
