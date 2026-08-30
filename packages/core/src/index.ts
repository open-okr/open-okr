import { PACKAGE_NAME as DB } from "@openokr/db";
import { PACKAGE_NAME as METHOD } from "@openokr/method";

export const PACKAGE_NAME = "@openokr/core";
export const DEPENDS_ON = [DB, METHOD] as const;

export {
  type BindGroupInput,
  bindGroup,
  type EnsureContextInput,
  type EnsureMemberGroupInput,
  type EnsureWorkspaceStandardGroupInput,
  ensureContext,
  ensureMemberGroup,
  ensureWorkspaceStandardGroup,
} from "./access/contexts.ts";
export { ACCESS_LEVELS, type AccessLevel } from "./access/levels.ts";
export { PERMISSIONS, type Permission } from "./access/permissions.ts";
export { derivePrivacy, type PrivacyLabel } from "./access/privacy.ts";
export {
  type AccessScopedResource,
  type AccessScopeFilterInput,
  type AnonymousContextInput,
  accessScopeFilter,
  can,
  type GetAccessScopedInput,
  getAccessScoped,
  type MemberContextInput,
  resolveAnonymousAccessLevel,
  resolveMemberAccessLevel,
  resolveOwnWorkspaceAccessLevel,
  resolveSubjectContext,
  type SubjectContext,
} from "./access/reads.ts";
export { CHANNEL_MESSAGE_TOPIC } from "./actions/channels.ts";
export {
  type ActionCallContext,
  type ActionDefinition,
  defineReadAction,
  defineWriteAction,
  type PageContract,
  type SafetyClass,
} from "./actions/define.ts";
export {
  ACTION_MAP,
  ACTIONS,
  type ActionName,
  actionNames,
  callAction,
  getAction,
} from "./actions/registry.ts";
export {
  readWorkspaceSettings,
  resetWorkspaceSettings,
  updateWorkspaceBranding,
  updateWorkspaceGeneralSettings,
} from "./actions/settings.ts";
export {
  ACTIVITY_PAYLOAD_SCHEMAS,
  type ActivityKind,
  AGGREGATABLE_KINDS,
  InvalidActivityPayloadError,
  isTestScaffoldKind,
  PRIVATE_ACTIVITY_KINDS,
  UnregisteredActivityKindError,
  validateActivityPayload,
} from "./activities/catalogue.ts";
export { resolveActivityContext } from "./activities/context.ts";
export {
  type FanOutActivityInput,
  fanOutActivity,
} from "./activities/fanout.ts";
export {
  type AggregatedFeedItem,
  aggregateFeed,
  type FeedItem,
  type QueryFeedInput,
  queryFeed,
} from "./activities/feed.ts";
export {
  type LiveActivityEvent,
  toLiveActivityEvent,
  workspaceFeedChannel,
} from "./activities/live.ts";
export {
  ACTIVITY_RENDERERS,
  type ActivityRenderer,
  renderActivity,
} from "./activities/renderers.ts";
export type {
  AgentDrafter,
  AmbitionContext,
  CheckInDraftContext,
  ClusterableNote,
  DiagnosticContext,
  DraftedCheckIn,
  DraftedKeyResult,
  DraftedObjective,
  FilterContext,
  GroundedAnswer,
  GroundedChunk,
  GroundedQuestionContext,
  GroundingSource,
  KpiRequestContext,
  MeasureContext,
  NarratedTrend,
  NoteThemes,
  ParentContext,
  ParsedFilter,
  ProposalOption,
  ProposalRequestContext,
  ProposedAction,
  ProposedObjective,
  RecoveryTitleContext,
  RetrospectiveCheckIn,
  ReviewableGoal,
  RewriteContext,
  SemanticFinding,
  SuggestedKpi,
  SuggestedParent,
  SummarisableBlocker,
  TrendContext,
  TrendPoint,
} from "./agents/drafter.ts";
export {
  ASSIST_FEATURE_KEYS,
  REVIEW_ASSIST_KEYS,
  RHYTHM_ASSIST_KEYS,
} from "./ai/assist-keys.ts";
export {
  type BudgetCheckResult,
  checkBudget,
  checkFeatureAvailability,
  type FeatureAvailability,
  isOverHardCap,
} from "./ai/budgets.ts";
export {
  type ContextWindowGuardInput,
  type ContextWindowGuardResult,
  guardContextWindow,
} from "./ai/context-guard.ts";
export { maskKeyHint, sealCredentialKey } from "./ai/credentials.ts";
export {
  findSeededModel,
  SEEDED_MODELS,
  type SeededModel,
  seededModelsForProvider,
} from "./ai/model-catalog.ts";
export {
  DEFAULT_PROMPTS,
  defaultPromptFor,
  knownPromptKeys,
} from "./ai/prompts.ts";
export {
  type AICredentialSource,
  type ResolveAICredentialInput,
  type ResolvedAICredential,
  type ResolvedDeploymentAI,
  resolveAICredential,
  resolveDeploymentAISettings,
} from "./ai/resolve.ts";
export {
  type ResolvedFeatureTier,
  type ResolvedTierRoute,
  resolveFeatureTier,
  resolveTierRoute,
} from "./ai/tier-routing.ts";
export {
  type RecordUsageEventInput,
  recordUsageEvent,
  summariseUsage,
  type UsageSummaryRow,
} from "./ai/usage.ts";
export {
  buildCliContract,
  type CliCommand,
  type CliContract,
  type CliDifference,
  type CliFlag,
  diffCliContract,
  type FlagType,
  flagName,
} from "./api/cli-contract.ts";
export {
  DEVICE_CODE_TTL_SECONDS,
  DEVICE_POLL_INTERVAL_SECONDS,
  type DeviceGrant,
  generateDeviceCode,
  generateUserCode,
  hashDeviceCode,
  type PendingDevice,
  pendingDevice,
  pollDeviceAuthorisation,
  type StartedDevice,
  startDeviceAuthorisation,
} from "./api/device.ts";
export {
  API_ERROR_CODES,
  type ApiError,
  type ApiErrorCode,
  apiError,
  errorFor,
  statusFor,
} from "./api/errors.ts";
export {
  buildCatalogue,
  CATALOGUE_VERSION,
  type CatalogueDifference,
  diffCatalogue,
  MCP_PROMPTS,
  MCP_RESOURCES,
  MCP_TOOLS,
  type McpCatalogue,
  type McpPrompt,
  type McpResource,
  type McpTool,
  toolNamed,
} from "./api/mcp/catalogue.ts";
export {
  type DispatchPrincipal,
  type DispatchResult,
  dispatchResource,
  dispatchTool,
  matchTemplate,
} from "./api/mcp/dispatch.ts";
export {
  closeSession,
  closeSessionFor,
  negotiateVersion,
  newSessionId,
  originAllowed,
  recordSession,
  recordSessionFor,
  type SessionRecord,
  SUPPORTED_PROTOCOL_VERSIONS,
  sessionFor,
  stampSessionUse,
} from "./api/mcp/sessions.ts";
export {
  ALLOW_LISTED_CLIENTS,
  type ClientRejection,
  type ClientResolution,
  redirectAllowed,
  resolveClient,
} from "./api/oauth/clients.ts";
export {
  type ApprovalOutcome,
  type AuthoriseCheck,
  type AuthoriseRefusal,
  type AuthoriseRequest,
  approveAuthorisation,
  approveAuthorisationForMember,
  checkAuthoriseRequest,
  checkAuthoriseRequestFor,
  redirectWith,
  SCOPE_DESCRIPTIONS,
  scopesFrom,
} from "./api/oauth/consent.ts";
export {
  authorisationServerMetadata,
  challengeHeader,
  DISCOVERY_ROUTES,
  discoveryDocumentAt,
  OAUTH_PATHS,
  openIdConfiguration,
  protectedResourceMetadata,
  resourceIdentifier,
  SUPPORTED_SCOPES,
} from "./api/oauth/discovery.ts";
export {
  digest,
  type GrantRefusal,
  type IssuedTokens,
  issueAuthorisationCode,
  redeemAuthorisationCode,
  rotateRefreshToken,
  type TokenOutcome,
} from "./api/oauth/flow.ts";
export {
  createGrant,
  type GrantInput,
  type GrantRejection,
  type LiveGrant,
  liveGrant,
  REVOCATION_REASONS,
  type RevocationReason,
  revokeGrant,
  stampGrantUse,
} from "./api/oauth/grants.ts";
export {
  CHALLENGE_METHOD,
  challengeFor,
  isValidVerifier,
  verifierMatches,
} from "./api/oauth/pkce.ts";
export {
  type FetchedMetadata,
  parseClientMetadata,
  type RegistrationInput,
  type RegistrationOutcome,
  type RegistrationRefusal,
  redirectRegistrable,
  registerClient,
  registerClientForInstance,
  registrationResponse,
} from "./api/oauth/registration.ts";
export {
  type AccessRejection,
  type AccessResolution,
  redeemCodeForTokens,
  refreshForTokens,
  resolveAccessToken,
  workspaceForCode,
  workspaceForRefreshToken,
} from "./api/oauth/resolve.ts";
export {
  ACCESS_TOKEN_TTL_SECONDS,
  CODE_TTL_SECONDS,
  hashSecret,
  kindFromText,
  type MintedSecret,
  mintSecret,
  type OAuthSecretKind,
  REFRESH_TOKEN_TTL_SECONDS,
} from "./api/oauth/secrets.ts";
export {
  buildOpenApiDocument,
  type ContractDifference,
  diffContract,
  type JsonObject,
  serialiseContract,
} from "./api/openapi.ts";
export {
  API_BASE,
  API_VERSION,
  type ApiMethod,
  decodeCursor,
  decodeParam,
  encodeCursor,
  inputFrom,
  nextCursorFor,
  REST_ROUTES,
  type RestRoute,
  routeAt,
} from "./api/surface.ts";
export {
  API_RATE_LIMIT,
  API_RATE_WINDOW_SECONDS,
  audienceFromText,
  bearerFrom,
  hashApiToken,
  type MintedToken,
  mintApiToken,
  resolveApiToken,
  scopeFor,
  stampTokenUse,
  type TokenRejection,
  type TokenResolution,
} from "./api/tokens.ts";
export {
  type AuditRow,
  auditRowHash,
  type ChainVerdict,
  canonicalJson,
  GENESIS_HASH,
  verifyChain,
} from "./audit/chain.ts";
export {
  type InstanceAuditRow,
  instanceAuditRowHash,
  type RecordInstanceAuditEventInput,
  recordInstanceAuditEvent,
  verifyInstanceChain,
} from "./audit/instance-chain.ts";
export { verifyAllChains, verifyWorkspaceChain } from "./audit/verify.ts";
export { type Auth, type AuthOptions, createAuth } from "./auth/auth.ts";
export {
  type CurrentSession,
  getCurrentSession,
  listUserSessions,
  type UserSession,
} from "./auth/session.ts";
export {
  hashSessionToken,
  withHashedSessionTokens,
} from "./auth/session-hashing.ts";
export {
  type ClaimBlobInput,
  type ClaimedBlob,
  claimBlob,
  discardOrphanedBlob,
  findOrphanedBlobs,
  generateStorageKey,
  type OrphanedBlob,
  type PrepareBlobInput,
  type PreparedBlob,
  prepareBlob,
  QuotaExceededError,
  ValidationFailedError,
} from "./blobs/provisioning.ts";
export {
  checkQuota,
  type QuotaCheckInput,
  type QuotaCheckResult,
  usedBytes,
} from "./blobs/quota.ts";
export {
  ALLOWED_CONTENT_TYPES,
  MAX_BLOB_BYTES,
  type ValidationResult,
  validateUpload,
} from "./blobs/validation.ts";
export {
  type BuildOptions,
  type BuiltMessage,
  buildMessage,
  type MessageButton,
  type MessageDraft,
  withLinkedButtons,
} from "./channels/builder.ts";
export {
  CHANNEL_CAPABILITIES,
  type ChannelCapabilityRow,
  type ChannelConnectionKey,
  type ChannelProviderKey,
  capabilitiesFor,
} from "./channels/capabilities.ts";
export {
  beginCheckIn,
  CHECK_IN_COMMAND,
  continueCheckIn,
  type FlowOutcome,
  type FlowRequest,
  submitCheckIn,
} from "./channels/check-in-flow.ts";
export {
  CHAT_COMMANDS,
  type ChatCommand,
  helpText,
  incompleteText,
  type ParsedCommand,
  parseCommand,
} from "./channels/commands.ts";
export {
  memberExternalId,
  type OpenedConnection,
  openConnection,
  parseSlackSecret,
  parseTeamsSecret,
  parseTelegramSecret,
  parseWhatsAppSecret,
  rememberConnectionConfig,
  type SlackSecret,
  type TeamsSecret,
  type TelegramSecret,
  type WhatsAppSecret,
} from "./channels/connections.ts";
export {
  type Conversation,
  type ConversationField,
  findConversation,
} from "./channels/conversation.ts";
export {
  type DueCheckIn,
  dueCheckInFor,
} from "./channels/due-check-in.ts";
export {
  generateLinkCode,
  handleInbound,
  hashLinkCode,
  INBOUND_RATE_LIMIT,
  INBOUND_RATE_WINDOW_SECONDS,
  type InboundOutcome,
  type InboundRequestFacts,
  LINK_CODE_TTL_SECONDS,
  resolveInbound,
  workspaceForProviderTeam,
} from "./channels/inbound.ts";
export {
  connectedProviders,
  loadRoutingMembers,
} from "./channels/members.ts";
export {
  type RouterReply,
  type RouterRequest,
  routeCommand,
} from "./channels/router.ts";
export {
  type Delivery,
  type DeliveryChannel,
  fallbackAfterFailure,
  type PrimaryChannel,
  type RoutingInput,
  type RoutingMember,
  resolveDelivery,
} from "./channels/routing.ts";
export {
  parseBlockerType,
  runningSessionFor,
  type SessionLookup,
} from "./channels/sessions.ts";
export {
  BINDING_LABELS,
  BINDING_SOURCES,
  type BindingFacts,
  type BindingSource,
  isBindingSource,
  loadBindingFacts,
  replyCommandFor,
  resolveBinding,
  resolveBindings,
} from "./channels/template-bindings.ts";
export {
  listMappings,
  mappingFor,
  type ResolvedMapping,
  removeMapping,
  type SaveOutcome,
  saveMapping,
  type TemplateMapping,
} from "./channels/template-mappings.ts";
export {
  listTemplates,
  recordTemplates,
  type StoredTemplate,
  type SyncedTemplate,
  type SyncOutcome,
  usableTemplates,
} from "./channels/templates.ts";
export {
  CONVERSATION_WINDOW_MS,
  insideConversationWindow,
  type WhatsAppEnvelope,
  whatsAppEnvelope,
} from "./channels/whatsapp-window.ts";
export {
  type AnswerQuestionInput,
  type AnswerQuestionResult,
  type AnswerSource,
  answerQuestion,
  type CopilotEvent,
  GROUNDING_LIMIT,
  streamAnswer,
} from "./copilot/answer.ts";
export {
  citationLabel,
  type ResolvedCitation,
  readableCitations,
} from "./copilot/citations.ts";
export {
  type AuthoredProposal,
  type BuiltProposal,
  buildProposal,
  type NumberedChoice,
  PROPOSABLE_ACTIONS,
  type ProposalOffer,
  proposalOffers,
  proposeFromRequest,
  type Reversal,
  reversalFor,
} from "./copilot/proposals.ts";
export {
  type ProvisionedMember,
  type ProvisionMemberInput,
  provisionMemberForInvite,
} from "./invitations/provisioning.ts";
export {
  emailDomain,
  generateInviteToken,
  hashInviteToken,
} from "./invitations/tokens.ts";
export {
  findNavigationItem,
  isRouteAllowed,
  MODULE_REGISTRY,
  type ModuleDefinition,
  type NavigationItem,
  type NavigationSection,
  navigationFor,
} from "./modules/registry.ts";
export {
  type EnsurePendingBatchInput,
  ensurePendingBatch,
} from "./notifications/batching.ts";
export {
  type NotifyRecipientsInput,
  type NotifyRecipientsResult,
  notifyRecipients,
} from "./notifications/create.ts";
export {
  type Recipient,
  type ResolveRecipientsInput,
  resolveRecipients,
} from "./notifications/recipients.ts";
export {
  DEFAULT_BATCH_WINDOW_MINUTES,
  DEFAULT_DAILY_SUMMARY_TIME,
  getOrCreateNotificationSettings,
  type NotificationSettingsView,
  type UpdateNotificationSettingsInput,
  updateNotificationSettings,
} from "./notifications/settings.ts";
export {
  type CancelSubscriptionInput,
  cancelSubscription,
  type EnsureSubscriptionListInput,
  ensureSubscriptionList,
  listSubscribers,
  type ReconcileMentionsInput,
  reconcileMentions,
  type SubscribeMemberInput,
  type Subscriber,
  type SubscriptionReason,
  subscribeMember,
} from "./notifications/subscriptions.ts";
export {
  type DigestInput,
  type DigestItem,
  type MailContent,
  type MentionNotificationInput,
  renderDigest,
  renderMentionNotification,
} from "./notifications/templates.ts";
export {
  ageInWords,
  blockerDraft,
  isBlockerRule,
} from "./nudges/blocker-card.ts";
export { deliverDueNudges, unreachableRecipients } from "./nudges/deliver.ts";
export { isRecoveryAction } from "./operations/freeze.ts";
export {
  type ActivityInput,
  type ActorInput,
  type AuditInput,
  type OperationContext,
  OperationError,
  type OperationOutcome,
  type OperationSpec,
  type OperationTx,
  type ResolvedActor,
  runOperation,
} from "./operations/operation.ts";
export {
  dispatchOutbox,
  memberEmail,
  OUTBOX_HANDLERS,
  type OutboxDelivery,
  type OutboxHandler,
  type OutboxHandlerDeps,
} from "./outbox/handlers.ts";
export { PermanentDispatchError } from "./outbox/permanent.ts";
export {
  type ErasureExport,
  isLastFullAccessHolder,
  refuseIfLastOwner,
  stripBindings,
} from "./people/lifecycle.ts";
export {
  buildOrgChart,
  type ManagerCycleCheckInput,
  type OrgChartNode,
  type PossibleManager,
  possibleManagers,
  wouldCreateManagerCycle,
} from "./people/manager-chain.ts";
export type { ExcerptResolvers } from "./rich-text/excerpt.ts";
export { excerptRichText } from "./rich-text/excerpt.ts";
export {
  type ExtractedAttachment,
  extractAttachments,
  extractMentionIds,
} from "./rich-text/extract.ts";
export {
  isBlankText,
  richTextFromPlainText,
} from "./rich-text/from-text.ts";
export type { RichTextResolvers } from "./rich-text/render.ts";
export { renderRichTextToHtml } from "./rich-text/render.ts";
export {
  isAllowedLinkHref,
  LEAF_NODE_TYPES,
  type Mark,
  NESTING_RULES,
  NODE_ATTRS_SCHEMAS,
  NODE_TYPES,
  type NodeType,
  RICH_TEXT_SCHEMA_VERSION,
  type RichTextDocument,
  type RichTextNode,
} from "./rich-text/schema.ts";
export {
  isValidRichText,
  parseRichText,
  RichTextValidationError,
} from "./rich-text/validate.ts";
export {
  environmentValue,
  getInstanceSetting,
  INSTANCE_SETTINGS,
  type InstanceSettingDefinition,
  SETUP_COMPLETED_AT,
} from "./secrets/instance-registry.ts";
export {
  clearSetting,
  type ResolvedSetting,
  readSecret,
  readSetting,
  readSettingRows,
  resolveSetting,
  type SettingSource,
  type SettingWrite,
  writeSettings,
} from "./secrets/instance-settings.ts";
export {
  decryptSecret,
  encryptSecret,
  type KeyRing,
  KeyRingError,
  type KeyRingSource,
  newRootKey,
  parseKeyRing,
  rewrapSecret,
  rootKeyFingerprint,
  type SealedSecret,
} from "./secrets/key-ring.ts";
export {
  type ResolvedMailSettings,
  resolveMailSettings,
} from "./secrets/mail-settings.ts";
export {
  type SessionScoresRevealedEvent,
  type SessionStageChangedEvent,
  sessionChannel,
} from "./sessions/live.ts";
export {
  brandingSchema,
  DEFAULT_QUIET_HOURS,
  findSetting,
  INSTANCE_DEFAULT_LANGUAGE,
  isKnownTimezone,
  languageSchema,
  type ProvisioningContext,
  resolveMemberSettings,
  resolveWorkspaceSettings,
  SETTINGS_REGISTRY,
  type SettingDefinition,
  type SettingScope,
  settingsByCard,
  timezoneSchema,
  trustedEmailDomainsSchema,
} from "./settings/registry.ts";
export { resolveInstanceDefaultLanguage } from "./settings/workspace-defaults.ts";
export {
  type CompleteSetupInput,
  type CompleteSetupResult,
  completeSetup,
} from "./setup/complete.ts";
export {
  blockingFailures,
  type ConnectionOutcome,
  type ConnectionProbe,
  type ConnectionTest,
  runConnectionTests,
} from "./setup/connection-tests.ts";
export {
  databaseProbe,
  type MailProbeOptions,
  mailProbe,
  notInThisBuild,
} from "./setup/probes.ts";
export {
  readSetupState,
  type SetupState,
  setupRefusal,
} from "./setup/state.ts";
export {
  listMembershipsForUser,
  type Membership,
  resolveActiveWorkspace,
} from "./workspaces/memberships.ts";
export {
  type CreateWorkspaceInput,
  createWorkspace,
  defaultWorkspaceName,
  type ProvisionedWorkspace,
  provisionWorkspaceForUser,
  slugify,
  type WorkspaceUser,
} from "./workspaces/provisioning.ts";
export {
  isRegistrationOpen,
  REGISTRATION_CLOSED_MESSAGE,
} from "./workspaces/registration.ts";
