// ============================================================================
// GenUI Protocol Types v3.0 — const objects instead of enums for Vite compat
// ============================================================================

export const BubbleType = {
  FOOD: 'food',
  JOB: 'job',
  PRODUCT: 'product',
  PAYMENT: 'payment',
  CHAT: 'chat',
  DASHBOARD: 'dashboard',
  AD: 'ad',
  SERVICE: 'service',
  EMERGENCY: 'emergency',
  PLATFORM: 'platform',
  NEGOTIATION: 'negotiation',
  RESTAURANT: 'restaurant',
  PHARMACY: 'pharmacy',
  FASHION: 'fashion',
  GROCERY: 'grocery',
  DELIVERY: 'delivery',
  RECRUITMENT: 'recruitment',
  WALLET: 'wallet',
  ANALYTICS: 'analytics',
  SETTINGS: 'settings',
  SUGGESTIONS: 'suggestions',
  ADS: 'ads',
  SUBCHAT: 'subchat',
  GENERIC: 'generic',
} as const;

export type BubbleType = (typeof BubbleType)[keyof typeof BubbleType];

export const BubbleSize = {
  MICRO: 'micro',
  COMPACT: 'compact',
  STANDARD: 'standard',
  EXPANDED: 'expanded',
  FULLSCREEN: 'fullscreen',
} as const;

export type BubbleSize = (typeof BubbleSize)[keyof typeof BubbleSize];

/** الجين الثابت — DNA template for visual styling */
export interface BubbleGene {
  id: string;
  borderRadius: string;
  backdropBlur: string;
  borderColor: string;
  shadow: string;
  animationIn: string;
  animationHover: string;
  glowColor: string;
  fontFamily: string;
  dir: 'rtl' | 'ltr';
  colors: [string, string];
  glassOpacity: number;
  rimIntensity: number;
}

/** المحتوى المتولد — what's inside the bubble */
export interface BubbleContent {
  title: string;
  subtitle: string;
  body: string;
  actions: Array<{
    label: string;
    action: string;
    style: 'primary' | 'secondary' | 'danger';
    data?: Record<string, unknown>;
  }>;
  metadata: Record<string, unknown>;
  iconType: string;
  accentColor: string;
}

/** التعبير الكامل — gene + content + behavior */
export interface BubbleExpression {
  id: string;
  gene: BubbleGene;
  content: BubbleContent;
  bubbleType: BubbleType;
  size: BubbleSize;
  position: { x: number; y: number };
  radius: number;
  streamMode: boolean;
  expandable: boolean;
  lifetimeMs?: number;
  createdAt: number;
}

/** نتيجة تصنيف النية */
export interface IntentResult {
  type: BubbleType;
  confidence: number;
  entities: string[];
  originalText: string;
}

/** Stream event for bubble rendering */
export interface BubbleStreamEvent {
  type: 'start' | 'chunk' | 'content' | 'actions' | 'complete' | 'error';
  bubbleId: string;
  gene?: BubbleGene;
  content?: Partial<BubbleContent>;
  position?: { x: number; y: number };
  radius?: number;
  chunk?: string;
  actions?: BubbleContent['actions'];
  error?: string;
}

/** Window content generated from bubble */
export interface GeneratedWindow {
  id: string;
  title: string;
  subtitle: string;
  type: BubbleType;
  iconColor: string;
  iconColor2: string;
  items: Array<{
    title: string;
    val: string;
    up: boolean;
    meta?: Record<string, unknown>;
  }>;
  actions: Array<{
    label: string;
    action: string;
    style: string;
  }>;
  footerText: string;
  metadata?: Record<string, unknown>;
}
