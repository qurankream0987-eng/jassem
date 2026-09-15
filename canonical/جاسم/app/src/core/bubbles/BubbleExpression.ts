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

export function createExpression(
  type: ExpressionType,
  content: ExpressionContent,
  style?: Partial<ExpressionStyle>
): BubbleExpression {
  return {
    id: `expr-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    type,
    content,
    style: {
      background: style?.background ?? 'rgba(255,255,255,0.1)',
      textColor: style?.textColor ?? '#ffffff',
      accentColor: style?.accentColor ?? '#3b82f6',
      borderRadius: style?.borderRadius ?? 16,
      padding: style?.padding ?? 16,
      fontSize: style?.fontSize ?? 'medium',
      shadow: style?.shadow ?? 'medium',
    },
    animation: {
      entrance: 'scale',
      hover: 'glow',
      exit: 'fade',
      duration: 300,
    },
    metadata: {
      createdAt: new Date(),
      priority: 'medium',
      tags: [],
    },
  };
}

export function updateExpression(
  expression: BubbleExpression,
  updates: Partial<Omit<BubbleExpression, 'id'>>
): BubbleExpression {
  return {
    ...expression,
    ...updates,
    style: { ...expression.style, ...updates.style },
    content: { ...expression.content, ...updates.content },
    metadata: { ...expression.metadata, ...updates.metadata },
  };
}

export function cloneExpression(expression: BubbleExpression): BubbleExpression {
  return {
    ...expression,
    id: `expr-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    metadata: { ...expression.metadata, createdAt: new Date() },
  };
}
