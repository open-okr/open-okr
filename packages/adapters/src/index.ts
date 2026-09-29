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
  type AIEgressOptions,
  type AIProviderConfig,
  aiEgressTargetOf,
  createAIProvider,
  defaultTierModelsFor,
  type GuardedAIProvider,
} from "./create-ai-provider.ts";
export { createMailer, type MailerConfig } from "./create-mailer.ts";
export {
  createTelemetry,
  type TelemetryConfig,
} from "./create-telemetry.ts";
export { McpAgentServer } from "./drivers/agent/mcp.ts";
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
  checkInView,
  parseViewSubmission,
  SlackChannel,
  type SlackChannelOptions,
  SlackPermanentError,
  slackDeliveryId,
  toBlocks,
} from "./drivers/channel/slack.ts";
export {
  decodeToken,
  stripMentions,
  TeamsChannel,
  type TeamsChannelOptions,
  TeamsPermanentError,
  teamsDeliveryId,
  teamsServiceUrl,
  teamsTenantId,
  toActivity,
  toAdaptiveCard,
} from "./drivers/channel/teams.ts";
export {
  TelegramChannel,
  type TelegramChannelOptions,
  TelegramPermanentError,
  telegramDeliveryId,
  toInlineKeyboard,
} from "./drivers/channel/telegram.ts";
export {
  countVariables,
  type MetaTemplate,
  templateBody,
  verifySubscription,
  WhatsAppChannel,
  type WhatsAppChannelOptions,
  WhatsAppPermanentError,
  whatsAppBusinessAccountId,
  whatsAppDeliveryId,
  whatsAppPhoneNumberId,
} from "./drivers/channel/whatsapp.ts";
// The two file drivers the upload path and the relay construct (completeness
// review M-24). Exported by name, like the storage drivers below: the host
// builds one, and everything else sees the port.
export { SharpImageProcessor } from "./drivers/image/sharp.ts";
// Exported for the scheduler host (P6-G01a), which needs a queue on its own
// rather than the whole adapter set `createAdapters` builds. Same shape as the
// channel drivers above: the host constructs the driver, the port is what
// everything else sees.
export {
  PgBossJobQueue,
  type PgBossJobQueueOptions,
} from "./drivers/jobs/pg-boss.ts";
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
export {
  ClamdScanner,
  type ClamdScannerOptions,
} from "./drivers/scan/clamd.ts";
export {
  LocalDiskStorage,
  type LocalDiskStorageOptions,
} from "./drivers/storage/local-disk.ts";
export {
  refuseUnsafeKey,
  S3Storage,
  type S3StorageOptions,
} from "./drivers/storage/s3.ts";
// The egress guard itself stays private: `createAIProvider` is the only way
// to be handed one, which is the whole point of it (M-10). What leaves is the
// vocabulary a host needs to pass a policy in and read an event out.
export {
  AI_CONTEXT_EGRESS_LEVELS,
  type AIContextEgress,
  type AIEgressEvent,
  type AIEgressPolicy,
  type AIEgressRefusal,
  AIEgressRefusedError,
  type AIEgressTarget,
} from "./outbound/ai-egress.ts";
export {
  type CheckedUrl,
  checkUrl,
  createGuardedFetch,
  isBlockedAddress,
  type OutboundOptions,
  type OutboundRefusal,
  OutboundRefusedError,
  type OutboundResult,
  outboundFetch,
} from "./outbound/guard.ts";
export type {
  AgentDispatch,
  AgentPrompt,
  AgentResource,
  AgentResourceReader,
  AgentServerConfig,
  AgentServerPort,
  AgentTool,
  AgentToolResult,
} from "./ports/agent.ts";
export type {
  AIProvider,
  AIPurpose,
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
  InboundSubmission,
} from "./ports/channel.ts";
export type {
  EncodedImage,
  ImageFormat,
  ImageProcessOptions,
  ImageProcessor,
  ImageProcessResult,
  UnreadableReason,
} from "./ports/image.ts";
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
export type { FileScanner, ScanVerdict } from "./ports/scan.ts";
export { ScannerUnavailableError } from "./ports/scan.ts";
export type {
  Search,
  SearchDocument,
  SearchHit,
  SearchQuery,
} from "./ports/search.ts";
export type { FileStorage, PutOptions, StoredObject } from "./ports/storage.ts";
export { ObjectNotFoundError } from "./ports/storage.ts";
export type {
  MetricLabels,
  MetricRecorder,
  Telemetry,
} from "./ports/telemetry.ts";
export {
  type OutboxRecord,
  OutboxRelay,
  type OutboxRelayOptions,
  PermanentDispatchError,
  purgeSettledOutbox,
  type RelayClient,
  type RelayPool,
} from "./relay.ts";
