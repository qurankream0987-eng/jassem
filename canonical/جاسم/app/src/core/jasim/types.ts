export const DnaGene = {
  UI: 'ui',
  CAPABILITY: 'capability',
  TRUST: 'trust',
  MEMORY: 'memory',
  REASONING: 'reasoning',
  PLANNING: 'planning',
  COMMUNICATION: 'communication',
  SECURITY: 'security',
} as const;

export type DnaGeneValue = typeof DnaGene[keyof typeof DnaGene];

export const PlatformCategory = {
  MARKETPLACE: 'marketplace',
  SOCIAL: 'social',
  JOB_BOARD: 'job_board',
  TRANSPORT: 'transport',
  RENTAL: 'rental',
  SHOP_BUILDER: 'shop_builder',
  FREELANCE: 'freelance',
  HEALTHCARE: 'healthcare',
  TRAVEL: 'travel',
  EDUCATION: 'education',
  EVENT: 'event',
  GOVERNMENT: 'government',
  BULK: 'bulk',
  FURNITURE: 'furniture',
  PRODUCT: 'product',
  SERVICE: 'service',
  PROPERTY: 'property',
  VEHICLE: 'vehicle',
  FOOD: 'food',
  CAR_REPAIR: 'car_repair',
  DELIVERY: 'delivery',
  REAL_ESTATE: 'real_estate',
  HOSPITALITY: 'hospitality',
  PROFESSIONAL: 'professional',
  OTHER: 'other',
} as const;

export type PlatformCategoryValue = typeof PlatformCategory[keyof typeof PlatformCategory];

export interface IntentResult {
  category: string;
  confidence: number;
  platform: string;
  keywords: string[];
  language: 'ar' | 'en' | 'mixed';
}

export interface DnaProfile {
  id: string;
  genes: Record<DnaGeneValue, number>;
  platform: string;
  category: string;
  confidence: number;
  features: string[];
  createdAt: Date;
}

export interface TaskNode {
  id: string;
  name: string;
  capability: string;
  dependencies: string[];
  parallelGroup?: string;
  humanGate: boolean;
  fallbackNode?: string;
  timeout: number;
  retries: number;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  result?: unknown;
  error?: string;
}

export interface DagPlan {
  id: string;
  name: string;
  nodes: TaskNode[];
  parallelGroups: Record<string, string[]>;
  startNode: string;
  endNodes: string[];
  status: 'draft' | 'active' | 'paused' | 'completed' | 'failed';
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

export interface ExecutionContext {
  id: string;
  planId: string;
  dnaProfile: DnaProfile;
  variables: Record<string, unknown>;
  stack: TaskNode[];
  results: Record<string, unknown>;
  status: 'initializing' | 'running' | 'waiting_human' | 'completed' | 'failed' | 'dissolved';
  createdAt: Date;
  expiresAt: Date;
}

export interface BubbleSchema {
  id: string;
  type: SchemaType;
  title: string;
  subtitle?: string;
  data: Record<string, unknown>;
  layout: SchemaLayout;
  theme: SchemaTheme;
  trust: SchemaTrust;
  actions: SchemaAction[];
}

export type SchemaType = 'comparison' | 'form' | 'gallery' | 'map' | 'chat' | 'dashboard' | 'timeline' | 'list' | 'card' | 'progress' | 'confirmation' | 'notification';

export interface SchemaLayout {
  columns: number;
  gap: number;
  padding: number;
  rtl: boolean;
  responsive: boolean;
}

export interface SchemaTheme {
  primary: string;
  secondary: string;
  background: string;
  surface: string;
  text: string;
  accent: string;
  gradient: string;
  glassmorphism: boolean;
}

export interface SchemaTrust {
  score: number;
  level: 'bronze' | 'silver' | 'gold' | 'diamond';
  verified: boolean;
  escrow: boolean;
  insurance: boolean;
}

export interface SchemaAction {
  id: string;
  label: string;
  type: 'primary' | 'secondary' | 'danger' | 'ghost';
  icon?: string;
  handler: string;
  disabled: boolean;
}

export interface CapabilityDefinition {
  id: string;
  name: string;
  description: string;
  category: string;
  adapter: string;
  fallbackChain: string[];
  requiredGenes: DnaGeneValue[];
  timeout: number;
  cost: number;
}

export interface JasimEvent {
  id: string;
  type: string;
  source: string;
  target: string;
  payload: Record<string, unknown>;
  timestamp: Date;
  priority: 'low' | 'medium' | 'high' | 'critical';
  handled: boolean;
}

export interface TrustPolicy {
  id: string;
  name: string;
  kycRequired: boolean;
  kycLevel: 'bronze' | 'silver' | 'gold' | 'diamond';
  escrowRequired: boolean;
  insuranceRequired: boolean;
  islamicCompliant: boolean;
  maxTransactionValue: number;
  allowedCategories: string[];
  blockedCategories: string[];
}
