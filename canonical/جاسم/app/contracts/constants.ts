/**
 * JASIM Shared Constants
 * All const objects use `as const` pattern for type-safe literal unions.
 * These are shared between frontend and backend.
 */

// ── Task System ───────────────────────────────────────────────────────────────

export const TASK_STATUSES = {
  CREATED: 'created',
  UNDERSTANDING: 'understanding',
  PLANNING: 'planning',
  WAITING_FOR_INPUT: 'waiting_for_input',
  READY: 'ready',
  EXECUTING: 'executing',
  WAITING_FOR_APPROVAL: 'waiting_for_approval',
  MONITORING: 'monitoring',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  PAUSED: 'paused',
  RETRYING: 'retrying',
  PARTIALLY_COMPLETED: 'partially_completed',
  WAITING_EXTERNAL: 'waiting_external',
} as const;

export const TASK_PRIORITIES = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical',
} as const;

// ── Capability System ───────────────────────────────────────────────────────

export const CAPABILITY_RISK_LEVELS = {
  NONE: 'none',
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical',
} as const;

export const CAPABILITY_SIDE_EFFECTS = {
  NONE: 'none',
  READ: 'read',
  WRITE: 'write',
  EXTERNAL_COMMUNICATION: 'external_communication',
  PAYMENT: 'payment',
  DATA_MODIFICATION: 'data_modification',
} as const;

// ── Agent System ────────────────────────────────────────────────────────────

export const AGENT_STATUSES = {
  IDLE: 'idle',
  PLANNING: 'planning',
  EXECUTING: 'executing',
  WAITING: 'waiting',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const;

// ── Entity System ───────────────────────────────────────────────────────────

export const ENTITY_TYPES = {
  PERSON: 'person',
  BUSINESS: 'business',
  PRODUCT: 'product',
  SERVICE: 'service',
  OFFER: 'offer',
  ORDER: 'order',
  TOOL: 'tool',
  APPLICATION: 'application',
  PLATFORM: 'platform',
  GENERATED: 'generated',
} as const;

// ── Commerce System ─────────────────────────────────────────────────────────

export const COMMERCE_ACTIONS = {
  DISCOVER: 'discover',
  SEARCH: 'search',
  COMPARE: 'compare',
  PRICE: 'price',
  QUOTE: 'quote',
  OFFER: 'offer',
  COUNTEROFFER: 'counteroffer',
  NEGOTIATE: 'negotiate',
  APPROVE: 'approve',
  ORDER: 'order',
  PURCHASE: 'purchase',
  BOOK: 'book',
  PAY: 'pay',
  TRACK: 'track',
  DELIVER: 'deliver',
  RETURN: 'return',
  REFUND: 'refund',
  REVIEW: 'review',
} as const;

// ── Memory System ────────────────────────────────────────────────────────────

export const MEMORY_SCOPES = {
  USER: 'user',
  TASK: 'task',
  ENTITY: 'entity',
  SYSTEM: 'system',
  CONVERSATION: 'conversation',
} as const;

export const MEMORY_CATEGORIES = {
  PREFERENCE: 'preference',
  HISTORY: 'history',
  RULE: 'rule',
  RELATIONSHIP: 'relationship',
  DECISION: 'decision',
  CONTEXT: 'context',
} as const;

// ── Event System ────────────────────────────────────────────────────────────

export const EVENT_TYPES = {
  USER_MESSAGE: 'user_message',
  TASK_CREATED: 'task_created',
  TASK_UPDATED: 'task_updated',
  STEP_COMPLETED: 'step_completed',
  APPROVAL_REQUIRED: 'approval_required',
  TOOL_INVOKED: 'tool_invoked',
  ERROR: 'error',
  EXTERNAL_WEBHOOK: 'external_webhook',
  SCHEDULED: 'scheduled',
} as const;

// ── UI / Bubble System ──────────────────────────────────────────────────────

export const BUBBLE_TYPES = {
  FORM: 'form',
  LIST: 'list',
  ENTITY_CARD: 'entity_card',
  ENTITY_LIST: 'entity_list',
  ENTITY_GRID: 'entity_grid',
  TEXT: 'text',
  DETAIL: 'detail',
  CHOICE: 'choice',
  CARD: 'card',
  COMPARISON: 'comparison',
  APPROVAL: 'approval',
  CHECKOUT: 'checkout',
  DOCUMENT: 'document',
  MEDIA: 'media',
  WARNING: 'warning',
  ERROR_STATE: 'error_state',
  EMPTY_STATE: 'empty_state',
  RECEIPT: 'receipt',
  STATUS: 'status',
  TRACKER: 'tracker',
  GALLERY: 'gallery',
  MAP: 'map',
  CHAT: 'chat',
  DASHBOARD: 'dashboard',
  TIMELINE: 'timeline',
  PROGRESS: 'progress',
  CONFIRMATION: 'confirmation',
  NOTIFICATION: 'notification',
  TABLE: 'table',
  WIZARD: 'wizard',
  SEARCH: 'search',
  FILTER: 'filter',
} as const;

// ── DNA Primitives ──────────────────────────────────────────────────────────

export const DNA_PRIMITIVES = {
  UNDERSTAND: 'UNDERSTAND',
  INTERPRET: 'INTERPRET',
  CLASSIFY: 'CLASSIFY',
  EXTRACT: 'EXTRACT',
  REASON: 'REASON',
  PLAN: 'PLAN',
  DECOMPOSE: 'DECOMPOSE',
  SEARCH: 'SEARCH',
  DISCOVER: 'DISCOVER',
  RETRIEVE: 'RETRIEVE',
  COMPARE: 'COMPARE',
  MATCH: 'MATCH',
  ANALYZE: 'ANALYZE',
  GENERATE: 'GENERATE',
  CREATE: 'CREATE',
  COMMUNICATE: 'COMMUNICATE',
  ASK: 'ASK',
  CONFIRM: 'CONFIRM',
  NEGOTIATE: 'NEGOTIATE',
  SCHEDULE: 'SCHEDULE',
  BOOK: 'BOOK',
  BUY: 'BUY',
  SELL: 'SELL',
  LIST: 'LIST',
  TRACK: 'TRACK',
  MONITOR: 'MONITOR',
  VERIFY: 'VERIFY',
  VALIDATE: 'VALIDATE',
  DELEGATE: 'DELEGATE',
  EXECUTE: 'EXECUTE',
  WAIT: 'WAIT',
  RETRY: 'RETRY',
  RECOVER: 'RECOVER',
  PERSIST: 'PERSIST',
  REMEMBER: 'REMEMBER',
  FORGET: 'FORGET',
  ADAPT: 'ADAPT',
  LEARN: 'LEARN',
  TRANSFORM: 'TRANSFORM',
  READ: 'READ',
  WRITE: 'WRITE',
  VISION: 'VISION',
  CALCULATE: 'CALCULATE',
  RANK: 'RANK',
  FILTER: 'FILTER',
} as const;

// ── Conversation System ──────────────────────────────────────────────────────

export const MESSAGE_ROLES = {
  USER: 'user',
  ASSISTANT: 'assistant',
  SYSTEM: 'system',
  TOOL: 'tool',
} as const;

// ── Execution System ──────────────────────────────────────────────────────────

export const EXECUTION_STATUSES = {
  PENDING: 'pending',
  RUNNING: 'running',
  SUCCESS: 'success',
  FAILED: 'failed',
  TIMEOUT: 'timeout',
  CANCELLED: 'cancelled',
} as const;

// ── HTTP/Auth integration ──────────────────────────────────────────────────

export const Paths = {
  oauthCallback: "/api/oauth/callback",
  /**
   * Issues a bearer session for native clients. It takes no caller-supplied
   * fields, so an absent body and `{}` are equivalent; any other body is
   * rejected rather than ignored, so the contract stays explicit.
   */
  runtimeSession: "/api/runtime/session",
  /** Server-owned readiness probe. Never served by the SPA. */
  health: "/health",
} as const;

export const Session = {
  cookieName: "jasim_session",
  maxAgeMs: 365 * 24 * 60 * 60 * 1000,
} as const;

export const ErrorMessages = {
  unauthenticated: "Authentication required",
  insufficientRole: "Insufficient role for this operation",
} as const;
