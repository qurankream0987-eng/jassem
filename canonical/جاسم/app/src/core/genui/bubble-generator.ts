import type { GenUIBubble, BubbleTypeValue, BubbleGeneValue, BubbleExpression } from './types';
import { BubbleType, BubbleGene } from './types';
import { getDnaTemplateById } from './dna-templates';
import { classifyIntent, getBubbleIconSvg } from './intent-classifier';

export interface BubbleGenerationConfig {
  count: number;
  canvasWidth: number;
  canvasHeight: number;
  minDistance: number;
  allowOverlap: boolean;
}

export const DEFAULT_BUBBLE_CONFIG: BubbleGenerationConfig = {
  count: 12,
  canvasWidth: 1200,
  canvasHeight: 800,
  minDistance: 80,
  allowOverlap: false,
} as const;

export function generateBubbles(
  query: string,
  config: Partial<BubbleGenerationConfig> = {}
): GenUIBubble[] {
  const mergedConfig = { ...DEFAULT_BUBBLE_CONFIG, ...config };
  const intent = classifyIntent(query);
  const template = getDnaTemplateById(intent.platform) ?? getDnaTemplateById('marketplace')!;

  const bubbles: GenUIBubble[] = [];
  const positions: { x: number; y: number }[] = [];

  for (let i = 0; i < mergedConfig.count; i++) {
    const position = findValidPosition(positions, mergedConfig);
    if (!position) continue;

    const gene = Object.keys(BubbleGene)[i % 8] as BubbleGeneValue;
    const geneValue = template.genes[gene] ?? 0.5;
    const bubbleType = intent.bubbleType;

    const bubble: GenUIBubble = {
      id: `bubble-${Date.now()}-${i}-${Math.random().toString(36).substring(2, 9)}`,
      type: bubbleType,
      gene,
      x: position.x,
      y: position.y,
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.3,
      radius: 30 + geneValue * 20,
      opacity: 0.85,
      scale: 1,
      color: template.colors[0],
      gradient: template.gradient,
      icon: getBubbleIconSvg(bubbleType),
      label: template.name,
      expression: null,
      isExpanded: false,
      isHovered: false,
      isSelected: false,
      energy: 100,
      pulsePhase: Math.random() * Math.PI * 2,
      connections: [],
      metadata: {
        template: template.id,
        confidence: intent.confidence,
        keywords: intent.keywords,
      },
    };

    bubbles.push(bubble);
    positions.push(position);
  }

  return bubbles;
}

export function generateBubbleFromType(
  type: BubbleTypeValue,
  x: number,
  y: number
): GenUIBubble {
  const template = getDnaTemplateById(type) ?? getDnaTemplateById('marketplace')!;
  const gene = Object.keys(BubbleGene)[Math.floor(Math.random() * 8)] as BubbleGeneValue;

  return {
    id: `bubble-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    type,
    gene,
    x,
    y,
    vx: (Math.random() - 0.5) * 0.3,
    vy: (Math.random() - 0.5) * 0.3,
    radius: 35,
    opacity: 0.9,
    scale: 1,
    color: template.colors[0],
    gradient: template.gradient,
    icon: getBubbleIconSvg(type),
    label: template.name,
    expression: null,
    isExpanded: false,
    isHovered: false,
    isSelected: false,
    energy: 100,
    pulsePhase: Math.random() * Math.PI * 2,
    connections: [],
    metadata: { template: template.id },
  };
}

export function updateBubblePosition(
  bubble: GenUIBubble,
  canvasWidth: number,
  canvasHeight: number,
  deltaTime: number
): GenUIBubble {
  const dt = deltaTime / 16;
  let vx = bubble.vx;
  let vy = bubble.vy;

  vy -= 0.005 * dt;
  vx += (Math.random() - 0.5) * 0.02 * dt;
  vy += (Math.random() - 0.5) * 0.02 * dt;

  vx *= 0.99;
  vy *= 0.99;

  const speed = Math.sqrt(vx * vx + vy * vy);
  if (speed > 2) {
    vx = (vx / speed) * 2;
    vy = (vy / speed) * 2;
  }

  let x = bubble.x + vx * dt;
  let y = bubble.y + vy * dt;

  const margin = bubble.radius;
  if (x < margin) { x = margin; vx = Math.abs(vx) * 0.7; }
  if (x > canvasWidth - margin) { x = canvasWidth - margin; vx = -Math.abs(vx) * 0.7; }
  if (y < margin) { y = margin; vy = Math.abs(vy) * 0.7; }
  if (y > canvasHeight - margin) { y = canvasHeight - margin; vy = -Math.abs(vy) * 0.7; }

  return {
    ...bubble,
    x,
    y,
    vx,
    vy,
    pulsePhase: bubble.pulsePhase + 0.05 * dt,
    scale: bubble.isHovered ? 1.15 : bubble.isExpanded ? 1.3 : 1 + Math.sin(bubble.pulsePhase) * 0.03,
    opacity: bubble.isHovered ? 1 : 0.85 + Math.sin(bubble.pulsePhase * 0.5) * 0.1,
  };
}

export function expressionToBubbleData(expression: BubbleExpression): Record<string, unknown> {
  return {
    type: expression.type,
    title: expression.content.title,
    subtitle: expression.content.subtitle,
    body: expression.content.body,
    style: expression.style,
    animation: expression.animation,
    metadata: expression.metadata,
  };
}

function findValidPosition(
  existing: { x: number; y: number }[],
  config: BubbleGenerationConfig
): { x: number; y: number } | null {
  let attempts = 0;
  const maxAttempts = 100;

  while (attempts < maxAttempts) {
    const x = config.minDistance + Math.random() * (config.canvasWidth - config.minDistance * 2);
    const y = config.minDistance + Math.random() * (config.canvasHeight - config.minDistance * 2);

    const isValid = existing.every((pos) => {
      const dx = pos.x - x;
      const dy = pos.y - y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      return dist >= config.minDistance;
    });

    if (isValid || config.allowOverlap) {
      return { x, y };
    }

    attempts++;
  }

  return null;
}
