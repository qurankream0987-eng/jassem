// ============================================================================
// Living Organism Types v4.0 — JASIM as a living generative entity
// ============================================================================

/** Unique DNA for each generated platform — controls everything */
export interface PlatformDNA {
  id: string;
  name: string;
  nameAr: string;
  slug: string;
  description: string;
  descriptionAr: string;
  category: PlatformCategory;
  geneSequence: number[]; // 32-float gene sequence — the platform's genetic code
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    glow: string;
    warm: string;
    cool: string;
  };
  personality: {
    friendliness: number; // 0-1
    professionalism: number;
    speed: number;
    thoroughness: number;
    creativity: number;
  };
  features: PlatformFeature[];
  agentCount: number;
  complexity: number; // 0-1 — how complex the platform is
  createdAt: number;
  generation: number; // evolves over time
}

/** What category of platform — each has a different base DNA */
export const PlatformCategory = {
  RESTAURANT: 'restaurant',
  CAR_REPAIR: 'car_repair',
  PHARMACY: 'pharmacy',
  FASHION: 'fashion',
  GROCERY: 'grocery',
  REAL_ESTATE: 'real_estate',
  SALON: 'salon',
  CLINIC: 'clinic',
  MARKETPLACE: 'marketplace',
  DELIVERY: 'delivery',
  EDUCATION: 'education',
  FITNESS: 'fitness',
  EVENT: 'event',
  CUSTOM: 'custom',
} as const;
export type PlatformCategory = (typeof PlatformCategory)[keyof typeof PlatformCategory];

/** Features a platform can have — generated dynamically */
export interface PlatformFeature {
  id: string;
  name: string;
  nameAr: string;
  isCore: boolean; // must-have vs nice-to-have
  isEnabled: boolean;
  priority: number; // 0-100
  iconSvg: string;
  requiresAgents: number; // how many agents this feature needs
}

/** A living agent — bred from PlatformDNA */
export interface LivingAgent {
  id: string;
  platformId: string;
  name: string;
  nameAr: string;
  role: AgentRole;
  description: string;
  descriptionAr: string;
  skills: string[];
  geneMarker: number[]; // subset of platform DNA + unique mutation
  color: string;
  glowColor: string;
  iconSvg: string;
  status: AgentStatus;
  energy: number; // 0-100 — decreases with work, regenerates over time
  experience: number; // 0-100 — increases with each task
  tasksCompleted: number;
  lastActiveAt: number;
  createdAt: number;
}

/** Agent roles — each platform breeds different roles */
export const AgentRole = {
  MENU_CURATOR: 'menu_curator',
  ORDER_HANDLER: 'order_handler',
  KITCHEN_COORDINATOR: 'kitchen_coordinator',
  DELIVERY_DISPATCHER: 'delivery_dispatcher',
  CUSTOMER_SUPPORT: 'customer_support',
  PAYMENT_PROCESSOR: 'payment_processor',
  ANALYTICS_EXPERT: 'analytics_expert',
  GARAGE_FINDER: 'garage_finder',
  QUOTE_NEGOTIATOR: 'quote_negotiator',
  BOOKING_SCHEDULER: 'booking_scheduler',
  PROGRESS_TRACKER: 'progress_tracker',
  REVIEW_COLLECTOR: 'review_collector',
  QUALITY_INSPECTOR: 'quality_inspector',
  INVENTORY_MANAGER: 'inventory_manager',
  MARKETING_AGENT: 'marketing_agent',
  SALES_ASSISTANT: 'sales_assistant',
  HR_RECRUITER: 'hr_recruiter',
  FINANCE_ADVISOR: 'finance_advisor',
  COMPLIANCE_GUARD: 'compliance_guard',
  CUSTOM_AGENT: 'custom_agent',
} as const;
export type AgentRole = (typeof AgentRole)[keyof typeof AgentRole];

export const AgentStatus = {
  SPAWNING: 'spawning',    // just created
  LEARNING: 'learning',    // acquiring initial knowledge
  READY: 'ready',          // ready to work
  WORKING: 'working',      // actively processing
  RESTING: 'resting',      // regenerating energy
  EVOLVING: 'evolving',    // upgrading skills
  DORMANT: 'dormant',      // inactive, can be reactivated
} as const;
export type AgentStatus = (typeof AgentStatus)[keyof typeof AgentStatus];

/** A swarm — collection of living agents working together */
export interface AgentSwarm {
  id: string;
  platformId: string;
  name: string;
  nameAr: string;
  agents: LivingAgent[];
  collectiveEnergy: number;
  swarmMood: SwarmMood;
  tasksQueued: number;
  tasksCompleted: number;
  createdAt: number;
  lastActivityAt: number;
}

export const SwarmMood = {
  ENERGETIC: 'energetic',
  FOCUSED: 'focused',
  HARMONIOUS: 'harmonious',
  STRESSED: 'stressed',
  RECOVERING: 'recovering',
  CELEBRATING: 'celebrating',
} as const;
export type SwarmMood = (typeof SwarmMood)[keyof typeof SwarmMood];

/** Result of the living pipeline: intent → platform → swarm → bubbles */
export interface LivingOrganism {
  dna: PlatformDNA;
  swarm: AgentSwarm;
  bubbles: LivingBubble[];
  seedPhrase: string; // the original user intent that spawned this organism
  isAlive: boolean;
  generation: number;
}

/** A living bubble — represents a living agent in the UI */
export interface LivingBubble {
  id: string;
  agentId: string;
  platformId: string;
  x: number;
  y: number;
  radius: number;
  color: string;
  color2: string;
  label: string;
  labelAr: string;
  pulsePhase: number;
  energy: number;
  agentStatus: AgentStatus;
  actions: Array<{
    label: string;
    labelAr: string;
    action: string;
  }>;
  metadata: Record<string, unknown>;
}

/** Intent classification result for platform generation */
export interface PlatformIntent {
  category: PlatformCategory;
  confidence: number;
  entities: Record<string, string[]>;
  originalText: string;
  language: 'ar' | 'en' | 'mixed';
  complexity: number; // estimated platform complexity
}

/** Agent breeding recipe — what agents to breed for a platform */
export interface AgentRecipe {
  role: AgentRole;
  count: number;
  priority: number;
  requiredFeatures: string[];
}
