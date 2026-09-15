/**
 * JASIM Core Engine - Barrel Exports
 * Central hub for all core brain components
 */

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
// TYPES - Export all core type definitions
// ============================================
export {
  // Agent types
  AgentTypeSchema,
  // Intent types
  IntentTypeSchema,
  // Bubble types
  BubbleSchema,
  // Parsed intent
  ParsedIntentSchema,
  // Memory types
  MemorySchema,
  // Message types
  MessageSchema,
  // User state
  UserStateSchema,
  // Conversation context
  ConversationContextSchema,
  // Swarm task
  SwarmTaskSchema,
  // Agent config
  AgentConfigSchema,
  // Market config
  MarketConfigSchema,
  // Dialect types
  ArabicDialectSchema,
  // Entity types
  ExtractedEntitySchema,
  // Error types
  CoreEngineErrorSchema,
  // Language analysis
  LanguageAnalysisSchema,
  // Routing result
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
// MEMORY ENGINE - User memory & preferences
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
} from "./memory-engine";

export type { MemoryEntry as MemoryEntryType } from "./memory-engine";

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
// AGENT ROUTER - Agent routing & dispatch
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
} from "./agent-router";

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
// CHURN PREVENTION - Merchant/user churn prediction & prevention
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
// AGENT EVOLUTION - Platform trend analysis & self-improvement
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
// AGENT DNA - 12-gene genetic framework for AI agents
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
// ARABIC NLP — Advanced LLM-powered Arabic Processing
// ============================================
export {
  ArabicNLP,
  arabicNLP,
} from "./arabic-nlp";

// ============================================
// LLM ROUTER — Multi-tier AI Routing (DeepSeek/Gemini/Claude)
// ============================================
export {
  LLMRouter,
  llmRouter,
} from "./llm-router";

// ============================================
// TOKEN PROTOCOL — Token-efficient Compression (60-80% savings)
// ============================================
export {
  TokenProtocol,
  tokenProtocol,
} from "./token-protocol";

// ============================================
// RESPONSE GENERATOR — LLM-powered Arabic Response Generation
// ============================================
export {
  ResponseGenerator,
  responseGenerator,
} from "./response-generator";

// ============================================
// SWARM ORCHESTRATOR — Multi-agent coordination
// ============================================
export {
  SwarmOrchestrator,
  swarmOrchestrator,
} from "./swarm-orchestrator";

// ============================================
// RESPONSE SYNTHESIZER — Arabic response synthesis
// ============================================
export {
  ResponseSynthesizer,
  responseSynthesizer,
} from "./response-synthesizer";

// ============================================
// BUBBLE GENERATOR — GenUI bubble generation
// ============================================
export {
  BubbleGenerator,
  bubbleGenerator,
} from "./bubble-generator";

// ============================================
// INTEGRATION — End-to-End Request Pipeline
// ============================================
export {
  processMessage,
  processBatchMessages,
} from "./integration";

// ============================================
// DATABASE QUERY — Smart Query Router
// ============================================
export {
  queryDatabase,
} from "./database-query";

// ============================================
// LAM ORCHESTRATOR — Language Agent Model for API integration
// ============================================
export {
  LAMOrchestrator,
  lamOrchestrator,
} from "./lam-orchestrator";

// ============================================
// ESCROW — Smart Escrow with Conditional Release
// ============================================
export {
  EscrowManager,
  escrowManager,
} from "./escrow";

// ============================================
// WEBSOCKET — Real-time Communication Server
// ============================================
export {
  JasimWebSocketServer,
  wsServer,
} from "./websocket";

// ============================================
// NOTIFICATION TRIGGERS — Auto-generated event notifications
// ============================================
export {
  NotificationTriggers,
  notificationTriggers,
} from "./notification-triggers";
