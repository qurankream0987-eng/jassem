// ============================================================================
// GenUI Engine v3.0 — المحرك التوليدي الرئيسي
// ============================================================================


export * from './types';
export * from './dna-templates';
export * from './intent-classifier';
export * from './bubble-generator';

import { classifyIntent, isIntentClear } from './intent-classifier';
import { generateBubble, generateWelcomeBubbles } from './bubble-generator';
import type { BubbleExpression } from './types';

export { classifyIntent, isIntentClear, generateBubble, generateWelcomeBubbles };
export type { IntentResult, BubbleExpression };

/** تحويل BubbleExpression إلى BubbleData (لـ BubbleCanvas) */
export function expressionToBubbleData(expr: BubbleExpression) {
  return {
    id: expr.id,
    label: expr.content.title,
    x: expr.position.x,
    y: expr.position.y,
    r: expr.radius,
    color: expr.gene.colors[0],
    color2: expr.gene.colors[1],
    desc: expr.content.subtitle,
    items: expr.content.actions.map((a) => ({
      title: a.label,
      val: a.action,
      up: a.style === 'primary',
    })),
  };
}

/** تحويل مصفوفة expressions إلى BubbleData[] */
export function expressionsToBubbleData(expressions: BubbleExpression[]) {
  return expressions.map(expressionToBubbleData);
}
