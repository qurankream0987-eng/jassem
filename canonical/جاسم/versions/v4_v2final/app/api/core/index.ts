/**
 * JASIM Core Engine V2 — Barrel Exports (2026)
 * Central hub for all core brain components
 */

// ============================================
// ERROR HANDLER — Structured errors & circuit breaker
// ============================================
export {
  JASIMError,
  ErrorCodeSchema,
  ErrorContextSchema,
  retryWithBackoff,
  withRetry,
  CircuitBreaker,
  getCircuitBreaker,
  resetCircuitBreaker,
  getAllCircuitStats,
  executeWithDegradation,
  classifyError,
  withCircuitBreaker,
  executeBatchWithErrorHandling,
} from "./error-handler";

export type {
  ErrorCode,
  ErrorContext,
  RetryConfig,
  CircuitBreakerConfig,
  CircuitState,
  DegradationTier,
  BatchResult,
} from "./error-handler";

// ============================================
// NOTIFICATION SYSTEM - All channels
// ============================================
export {
  getPushService,
  getWhatsAppService,
  getSMSService,
  getEmailService,
  getInAppService,
  getNotificationRouter,
  onOrderStatusChange,
  onKYCExpiry,
  onKYCExpired,
  onKYCApproved,
  onPaymentReceived,
  onPaymentFailed,
  onEscrowEvent,
  onChurnRisk,
  onPredictiveSuggestion,
  onDailyDigest,
  onDriverAssigned,
  onDriverSOS,
  onUserWelcome,
  sendMarketingBroadcast,
} from "./notifications";

export type {
  NotificationPayload,
  NotificationChannel,
  DeliveryResult,
} from "./notifications";

// ============================================
// TYPES - Zod schemas & type definitions
// ============================================
export {
  AgentTypeSchema,
  IntentTypeSchema,
  BubbleSchema,
  ParsedIntentSchema,
  MemorySchema,
  MessageSchema,
  UserStateSchema,
  ConversationContextSchema,
  SwarmTaskSchema,
  AgentConfigSchema,
  MarketConfigSchema,
  ArabicDialectSchema,
  ExtractedEntitySchema,
  CoreEngineErrorSchema,
  LanguageAnalysisSchema,
  RoutingResultSchema,
} from "./types";

export type {
  AgentType,
  IntentType,
  BubbleType,
  BubbleTheme,
  ParsedIntent,
  MemoryEntry,
  MemoryCategory,
  MessageEntry,
  UserState,
  ConversationContext,
  SwarmTask,
  TaskStatus,
  AgentConfig,
  AgentTier,
  MarketConfig,
  ArabicDialect,
  ExtractedEntity,
  CoreEngineError,
  LanguageAnalysis,
  RoutingResult,
} from "./types";

// ============================================
// LANGUAGE PROCESSOR - Arabic NLP utilities
// ============================================
export {
  detectDialect,
  normalizeArabic,
  transliterate,
  analyzeLanguage,
  translateKeyTerms,
  getSupportedDialects,
  getDialectGreeting,
} from "./language-processor";

// ============================================
// INTENT PARSER - NLP intent classification
// ============================================
export {
  parseIntent,
  getSupportedIntents,
  batchParseIntents,
  resolveMultiTurnIntent,
} from "./intent-parser";

// ============================================
// MEMORY ENGINE V2 — Harness pattern
// ============================================
export {
  storeMemory,
  recallMemory,
  getPreferences,
  getRecentInteractions,
  updatePreference,
  clearExpiredMemories,
  storeInteraction,
  storeFeedback,
  getMemoryStats,
  deleteAllMemories,
  MemoryHarness,
  memoryHarness,
} from "./memory-engine";

export type {
  MemoryEntry,
  MemoryCategory,
  MemoryEntry as MemoryEntryType,
  StoreMemoryInput,
  MemoryQuery,
  HarnessNote,
  SessionState,
  SkillPackage,
  HarnessHook,
  HarnessHookType,
} from "./memory-engine";

// ============================================
// MARKET DETECTOR - Market context & validation
// ============================================
export {
  detectMarket,
  validateMarketAccess,
  getMarketConfig,
  getActiveMarkets,
  getMarketByCurrency,
  convertToMarketCurrency,
  formatMarketPrice,
  getMarketGreeting,
  getMarketDefaultAgent,
  marketSupportsFeature,
  syncMarketsWithDb,
} from "./market-detector";

// ============================================
// CONTEXT BUILDER - Conversation context management
// ============================================
export {
  buildContext,
  updateContext,
  detectUserState,
  getRelevantHistory,
  resolveMarket,
  getCachedContext,
  invalidateContext,
  getSessionStats,
} from "./context-builder";

// ============================================
// AGENT ROUTER V2 — Supervisor-Worker pattern
// ============================================
export {
  routeToAgent,
  getAgentConfig,
  canHandleParallel,
  getFallbackAgent,
  getAllAgents,
  getAgentsByTier,
  findAgentsByCapability,
  getAgentRouter,
  canAgentHandleIntent,
  getSuggestedAgents,
  executeWithSupervisor,
  SupervisorAgent,
} from "./agent-router";

export type {
  AgentType,
  IntentType,
  ParsedIntent,
  RoutingResult,
  AgentConfig,
  Subtask,
  WorkerAssignment,
  WorkerResult,
  SupervisorPlan,
  SupervisorSynthesis,
} from "./agent-router";

// ============================================
// PIPELINE PROCESSOR — Pipeline pattern (NEW)
// ============================================
export {
  PipelineProcessor,
  StageBuilder,
  PipelineBuilder,
  pipelineProcessor,
} from "./pipeline-processor";

export type {
  Pipeline,
  PipelineStage,
  StageResult,
  PipelineResult,
  PipelineCheckpoint,
  StageContext,
} from "./pipeline-processor";

// ============================================
// PREDICTIVE ENGINE - User behavior prediction
// ============================================
export {
  PredictiveEngine,
  analyzeUserPatterns,
  predictUserNextAction,
  getPredictiveBubbles,
} from "./predictive-engine";

export type {
  BehaviorPattern,
  Prediction,
  PredictiveBubble,
} from "./predictive-engine";

// ============================================
// CHURN PREVENTION
// ============================================
export {
  ChurnPrevention,
  getChurnScore,
  triggerChurnAction,
  runDailyChurnCheck,
} from "./churn-prevention";

export type {
  ChurnScore,
  ChurnFactor,
  WinBackOffer,
  MerchantStats,
} from "./churn-prevention";

// ============================================
// AGENT EVOLUTION
// ============================================
export {
  AgentEvolution,
  analyzeMarketTrends,
  getEvolutionSuggestions,
  evolveAgent,
  getPlatformHealth,
} from "./agent-evolution";

export type {
  Trend,
  EvolutionSuggestion,
  AgentMetrics,
  EvolutionBubble,
} from "./agent-evolution";

// ============================================
// AGENT DNA
// ============================================
export {
  createDefaultDNA,
  breedAgents,
  calculateFitness,
  mutateGene,
  compareDNA,
  storeDNA,
  loadDNA,
  getTopDNA,
  DNAEvolutionEngine,
  generateDefaultDNA,
  crossbreed,
  checkFitness,
  checkSimilarity,
} from "./agent-dna";

export type {
  AgentDNA,
  DNARecord,
  BreedResult,
  FitnessResult,
} from "./agent-dna";

// ============================================
// ARABIC NLP
// ============================================
export {
  ArabicNLP,
  arabicNLP,
} from "./arabic-nlp";

// ============================================
// LLM ROUTER V2 — 6-tier smart routing
// ============================================
export {
  LLMRouter,
  routeLLM,
  routeLLMWithFallback,
  routeLLMGroq,
  routeLLMGPT4oMini,
  routeLLMDeepSeek,
  routeLLMClaude,
  getLLMCostStats,
  getLLMModelCapabilities,
  analyzeLLMComplexity,
  LLMRequestSchema,
  LLMResponseSchema,
  CostStatsSchema,
  ComplexityAnalysisSchema,
  llmRouter,
  getLLMRouter,
} from "./llm-router";

export type {
  LLMRequest,
  LLMResponse,
  CostStats,
  TokenUsage,
  ModelCapability,
  ComplexityAnalysis,
} from "./llm-router";

// ============================================
// TOKEN PROTOCOL
// ============================================
export {
  TokenProtocol,
  tokenProtocol,
} from "./token-protocol";

// ============================================
// RESPONSE GENERATOR
// ============================================
export {
  ResponseGenerator,
  responseGenerator,
} from "./response-generator";

// ============================================
// SWARM ORCHESTRATOR V2 — SwarmState pattern
// ============================================
export {
  SwarmOrchestratorV2,
  SwarmOrchestrator,
  swarmOrchestrator,
  SwarmStateSchema,
  SwarmInputSchema,
  SwarmOutputSchema,
  SwarmTaskSchema,
  SwarmResultSchema,
  SwarmConfigSchema,
} from "./swarm-orchestrator";

export type {
  SwarmState,
  SwarmInput,
  SwarmOutput,
  SwarmTask,
  SwarmResult,
  SwarmConfig,
} from "./swarm-orchestrator";

// ============================================
// RESPONSE SYNTHESIZER
// ============================================
export {
  ResponseSynthesizer,
  responseSynthesizer,
} from "./response-synthesizer";

// ============================================
// BUBBLE GENERATOR
// ============================================
export {
  BubbleGenerator,
  bubbleGenerator,
} from "./bubble-generator";

// ============================================
// INTEGRATION
// ============================================
export {
  processMessage,
  processBatchMessages,
} from "./integration";

// ============================================
// DATABASE QUERY
// ============================================
export {
  queryDatabase,
} from "./database-query";

// ============================================
// LAM ORCHESTRATOR
// ============================================
export {
  LAMOrchestrator,
  lamOrchestrator,
} from "./lam-orchestrator";

// ============================================
// ESCROW
// ============================================
export {
  EscrowManager,
  escrowManager,
} from "./escrow";

// ============================================
// WEBSOCKET
// ============================================
export {
  JasimWebSocketServer,
  wsServer,
} from "./websocket";

// ============================================
// NOTIFICATION TRIGGERS
// ============================================
export {
  NotificationTriggers,
  notificationTriggers,
} from "./notification-triggers";
