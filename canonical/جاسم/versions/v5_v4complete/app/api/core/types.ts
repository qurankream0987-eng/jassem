/**
 * JASIM Core Types - The foundational type system for the multi-agent brain
 * Coordinates 22 routers, 50 tables, 18 markets across the Arab World
 */

import { z } from "zod";

// ============================================
// AGENT TYPES - 19 specialized AI agents
// ============================================
export type AgentType =
  | 'food' | 'fashion' | 'grocery' | 'pharmacy' | 'delivery'
  | 'b2b_supplier' | 'cross_border' | 'haggle'
  | 'fleet' | 'recruitment' | 'vision' | 'voice'
  | 'smart_connect' | 'gen_saas' | 'gen_aggregator'
  | 'widget' | 'a2a' | 'analytics' | 'financial' | 'mentor';

export const AgentTypeSchema = z.enum([
  'food', 'fashion', 'grocery', 'pharmacy', 'delivery',
  'b2b_supplier', 'cross_border', 'haggle',
  'fleet', 'recruitment', 'vision', 'voice',
  'smart_connect', 'gen_saas', 'gen_aggregator',
  'widget', 'a2a', 'analytics', 'financial', 'mentor',
]);

// ============================================
// INTENT TYPES - User intention classification
// ============================================
export type IntentType =
  | 'food_order' | 'product_search' | 'order_tracking' | 'payment'
  | 'b2b_inquiry' | 'haggle_request' | 'delivery_tracking'
  | 'cv_generation' | 'job_search' | 'job_apply'
  | 'connect_pos' | 'deploy_saas' | 'create_platform'
  | 'embed_widget' | 'agent_trade' | 'zakat_calc'
  | 'general_chat' | 'greeting' | 'help';

export const IntentTypeSchema = z.enum([
  'food_order', 'product_search', 'order_tracking', 'payment',
  'b2b_inquiry', 'haggle_request', 'delivery_tracking',
  'cv_generation', 'job_search', 'job_apply',
  'connect_pos', 'deploy_saas', 'create_platform',
  'embed_widget', 'agent_trade', 'zakat_calc',
  'general_chat', 'greeting', 'help',
]);

// ============================================
// BUBBLE TYPES - Rich UI response components
// ============================================
export type BubbleTheme =
  | 'default' | 'food' | 'fashion' | 'grocery' | 'pharmacy'
  | 'order' | 'payment' | 'map' | 'chart' | 'form'
  | 'job' | 'cv' | 'analytics' | 'islamic' | 'haggle'
  | 'product_card' | 'cart' | 'agent' | 'error' | 'success';

export interface BubbleType {
  type: string;
  theme: BubbleTheme;
  data: Record<string, unknown>;
  priority: number;
}

export const BubbleSchema = z.object({
  type: z.string(),
  theme: z.enum([
    'default', 'food', 'fashion', 'grocery', 'pharmacy',
    'order', 'payment', 'map', 'chart', 'form',
    'job', 'cv', 'analytics', 'islamic', 'haggle',
    'product_card', 'cart', 'agent', 'error', 'success',
  ]),
  data: z.record(z.string(), z.unknown()),
  priority: z.number().min(0).max(100),
});

// ============================================
// PARSED INTENT - NLP output structure
// ============================================
export interface ParsedIntent {
  type: IntentType;
  confidence: number;
  entities: Record<string, string>;
  marketCode: string;
  dialect: string;
  requiresAgent: AgentType;
  suggestedBubbles: BubbleType[];
}

export const ParsedIntentSchema = z.object({
  type: IntentTypeSchema,
  confidence: z.number().min(0).max(1),
  entities: z.record(z.string(), z.string()),
  marketCode: z.string().length(2),
  dialect: z.string(),
  requiresAgent: AgentTypeSchema,
  suggestedBubbles: z.array(BubbleSchema),
});

// ============================================
// MEMORY SYSTEM - User memory & preferences
// ============================================
export type MemoryCategory = 'preference' | 'interaction' | 'context' | 'feedback';

export interface MemoryEntry {
  id: string;
  userId: string;
  marketCode: string;
  type: MemoryCategory;
  key: string;
  value: unknown;
  confidence: number;
  source: string;
  expiresAt?: Date;
  isPermanent: boolean;
  createdAt: Date;
}

export const MemorySchema = z.object({
  id: z.string(),
  userId: z.string(),
  marketCode: z.string(),
  type: z.enum(['preference', 'interaction', 'context', 'feedback']),
  key: z.string(),
  value: z.unknown(),
  confidence: z.number().min(0).max(1),
  source: z.string(),
  expiresAt: z.date().optional(),
  isPermanent: z.boolean(),
  createdAt: z.date(),
});

// ============================================
// MESSAGE & CONVERSATION
// ============================================
export interface MessageEntry {
  role: 'user' | 'assistant' | 'system' | 'agent';
  content: string;
  agentName?: string;
  bubbles?: BubbleType[];
  actions?: Record<string, unknown>[];
  timestamp: Date;
}

export const MessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system', 'agent']),
  content: z.string(),
  agentName: z.string().optional(),
  bubbles: z.array(BubbleSchema).optional(),
  actions: z.array(z.record(z.string(), z.unknown())).optional(),
  timestamp: z.date(),
});

// ============================================
// USER STATES - Conversation state machine
// ============================================
export type UserState = 'browsing' | 'ordering' | 'negotiating' | 'support';

export const UserStateSchema = z.enum([
  'browsing', 'ordering', 'negotiating', 'support',
]);

// ============================================
// CONVERSATION CONTEXT - Full session context
// ============================================
export interface ConversationContext {
  sessionId: string;
  userId: string;
  marketCode: string;
  intent: ParsedIntent;
  history: MessageEntry[];
  activeAgents: AgentType[];
  userState: UserState;
  preferences: Record<string, unknown>;
}

export const ConversationContextSchema = z.object({
  sessionId: z.string(),
  userId: z.string(),
  marketCode: z.string(),
  intent: ParsedIntentSchema,
  history: z.array(MessageSchema),
  activeAgents: z.array(AgentTypeSchema),
  userState: UserStateSchema,
  preferences: z.record(z.string(), z.unknown()),
});

// ============================================
// SWARM TASK - Async task execution
// ============================================
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface SwarmTask {
  id: string;
  type: AgentType;
  priority: number;
  input: unknown;
  output?: unknown;
  status: TaskStatus;
  dependencies: string[];
  timeout: number;
}

export const SwarmTaskSchema = z.object({
  id: z.string(),
  type: AgentTypeSchema,
  priority: z.number().min(0).max(100),
  input: z.unknown(),
  output: z.unknown().optional(),
  status: z.enum(['pending', 'running', 'completed', 'failed']),
  dependencies: z.array(z.string()),
  timeout: z.number().default(30000),
});

// ============================================
// AGENT CONFIG - Agent registration & metadata
// ============================================
export type AgentTier = 1 | 2 | 3 | 4;

export interface AgentConfig {
  type: AgentType;
  name: string;
  nameAr: string;
  description: string;
  triggers: string[];
  confidence: number;
  tier: AgentTier;
  capabilities: string[];
  router: string;
}

export const AgentConfigSchema = z.object({
  type: AgentTypeSchema,
  name: z.string(),
  nameAr: z.string(),
  description: z.string(),
  triggers: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  tier: z.number().min(1).max(4) as z.ZodType<AgentTier>,
  capabilities: z.array(z.string()),
  router: z.string(),
});

// ============================================
// MARKET CONFIG - Per-market settings
// ============================================
export interface MarketConfig {
  code: string;
  nameAr: string;
  nameEn: string;
  currency: string;
  currencySymbol: string;
  language: string;
  dialect: string;
  timezone: string;
  isActive: boolean;
  pricingMultiplier: number;
  defaultAgent: AgentType;
}

export const MarketConfigSchema = z.object({
  code: z.string().length(2),
  nameAr: z.string(),
  nameEn: z.string(),
  currency: z.string(),
  currencySymbol: z.string(),
  language: z.string(),
  dialect: z.string(),
  timezone: z.string(),
  isActive: z.boolean(),
  pricingMultiplier: z.number(),
  defaultAgent: AgentTypeSchema,
});

// ============================================
// DIALECT TYPES - Arabic dialect classification
// ============================================
export type ArabicDialect =
  | 'gulf' | 'levantine' | 'egyptian' | 'maghrebi'
  | 'msa' | 'unknown';

export const ArabicDialectSchema = z.enum([
  'gulf', 'levantine', 'egyptian', 'maghrebi', 'msa', 'unknown',
]);

// ============================================
// ENTITY TYPES - Extracted entities from text
// ============================================
export interface ExtractedEntity {
  type: 'product' | 'location' | 'quantity' | 'price' | 'time'
    | 'person' | 'phone' | 'category' | 'brand' | 'intent_modifier';
  value: string;
  confidence: number;
  position: [number, number]; // start, end indices
  normalized?: string;
}

export const ExtractedEntitySchema = z.object({
  type: z.enum([
    'product', 'location', 'quantity', 'price', 'time',
    'person', 'phone', 'category', 'brand', 'intent_modifier',
  ]),
  value: z.string(),
  confidence: z.number().min(0).max(1),
  position: z.tuple([z.number(), z.number()]),
  normalized: z.string().optional(),
});

// ============================================
// ERROR TYPES - Arabic error messages
// ============================================
export interface CoreEngineError {
  code: string;
  messageAr: string;
  messageEn: string;
  status: number;
  details?: Record<string, unknown>;
}

export const CoreEngineErrorSchema = z.object({
  code: z.string(),
  messageAr: z.string(),
  messageEn: z.string(),
  status: z.number(),
  details: z.record(z.string(), z.unknown()).optional(),
});

// ============================================
// LANGUAGE PROCESSING RESULTS
// ============================================
export interface LanguageAnalysis {
  original: string;
  normalized: string;
  transliterated: string;
  detectedDialect: ArabicDialect;
  dialectConfidence: number;
  isArabic: boolean;
  isTransliterated: boolean;
  language: 'ar' | 'en' | 'mixed';
}

export const LanguageAnalysisSchema = z.object({
  original: z.string(),
  normalized: z.string(),
  transliterated: z.string(),
  detectedDialect: ArabicDialectSchema,
  dialectConfidence: z.number().min(0).max(1),
  isArabic: z.boolean(),
  isTransliterated: z.boolean(),
  language: z.enum(['ar', 'en', 'mixed']),
});

// ============================================
// ROUTING RESULT
// ============================================
export interface RoutingResult {
  agent: AgentConfig;
  confidence: number;
  isParallel: boolean;
  fallbackAgent?: AgentConfig;
  estimatedLatency: number;
}

export const RoutingResultSchema = z.object({
  agent: AgentConfigSchema,
  confidence: z.number().min(0).max(1),
  isParallel: z.boolean(),
  fallbackAgent: AgentConfigSchema.optional(),
  estimatedLatency: z.number(),
});
