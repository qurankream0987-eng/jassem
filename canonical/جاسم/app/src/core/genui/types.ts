export const BubbleType = {
  PRODUCT: 'product',
  SERVICE: 'service',
  JOB: 'job',
  PROPERTY: 'property',
  VEHICLE: 'vehicle',
  FREELANCE: 'freelance',
  EVENT: 'event',
  EDUCATION: 'education',
  HEALTHCARE: 'healthcare',
  TRAVEL: 'travel',
  GOVERNMENT: 'government',
  BULK: 'bulk',
  FURNITURE: 'furniture',
  OTHER: 'other',
} as const;

export type BubbleTypeValue = typeof BubbleType[keyof typeof BubbleType];

export const BubbleGene = {
  UI: 'ui',
  CAPABILITY: 'capability',
  TRUST: 'trust',
  MEMORY: 'memory',
  REASONING: 'reasoning',
  PLANNING: 'planning',
  COMMUNICATION: 'communication',
  SECURITY: 'security',
} as const;

export type BubbleGeneValue = typeof BubbleGene[keyof typeof BubbleGene];

export interface BubbleExpression {
  id: string;
  type: ExpressionType;
  content: ExpressionContent;
  style: ExpressionStyle;
  animation: ExpressionAnimation;
  metadata: ExpressionMetadata;
}

export type ExpressionType = 'text' | 'image' | 'chart' | 'map' | 'form' | 'list' | 'card' | 'timeline' | 'progress' | 'notification';

export interface ExpressionContent {
  title?: string;
  subtitle?: string;
  body?: string;
  imageUrl?: string;
  data?: unknown[];
  fields?: FormField[];
  items?: ListItem[];
  steps?: TimelineStep[];
  value?: number;
  maxValue?: number;
}

export interface FormField {
  id: string;
  label: string;
  type: 'text' | 'number' | 'email' | 'select' | 'checkbox' | 'textarea';
  required: boolean;
  options?: string[];
  placeholder?: string;
}

export interface ListItem {
  id: string;
  title: string;
  description?: string;
  icon?: string;
  value?: string;
  status?: 'active' | 'inactive' | 'pending';
}

export interface TimelineStep {
  id: string;
  title: string;
  description: string;
  status: 'completed' | 'current' | 'pending';
  timestamp?: Date;
}

export interface ExpressionStyle {
  background: string;
  textColor: string;
  accentColor: string;
  borderRadius: number;
  padding: number;
  fontSize: 'small' | 'medium' | 'large';
  shadow: 'none' | 'small' | 'medium' | 'large';
}

export interface ExpressionAnimation {
  entrance: 'fade' | 'slide' | 'scale' | 'bounce';
  hover: 'none' | 'scale' | 'glow' | 'lift';
  exit: 'fade' | 'slide' | 'scale' | 'pop';
  duration: number;
}

export interface ExpressionMetadata {
  createdAt: Date;
  expiresAt?: Date;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  author?: string;
  tags: string[];
}

export interface GenUIBubble {
  id: string;
  type: BubbleTypeValue;
  gene: BubbleGeneValue;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  opacity: number;
  scale: number;
  color: string;
  gradient: string;
  icon: string;
  label: string;
  expression: BubbleExpression | null;
  isExpanded: boolean;
  isHovered: boolean;
  isSelected: boolean;
  energy: number;
  pulsePhase: number;
  connections: string[];
  metadata: Record<string, unknown>;
}

export interface DnaTemplate {
  id: string;
  name: string;
  genes: Record<BubbleGeneValue, number>;
  colors: string[];
  gradient: string;
  features: string[];
}
