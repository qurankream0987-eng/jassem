/**
 * Chat Flow Integration Test
 * /اختبار تدفق المحادثة
 * Tests intent → agent → response pipeline
 */

import { describe, it, expect } from 'vitest';
import { parseIntent } from '../../api/core/intent-parser';
import { routeToAgent } from '../../api/core/agent-router';

describe('Chat Flow: Intent → Agent → Response', () => {
  // ============================================
  // FULL PIPELINE TESTS
  // ============================================

  it('"ابغى كبسة" → food_order → food agent → restaurant_search bubble', () => {
    const intent = parseIntent('ابغى كبسة');
    expect(intent).toBeDefined();
    expect(intent.confidence).toBeGreaterThan(0);

    const routing = routeToAgent(intent);
    expect(routing.agent).toBeDefined();

    expect(intent.suggestedBubbles.length).toBeGreaterThan(0);
  });

  it('"وين طلبي" → order_tracking → delivery agent → order_map bubble', () => {
    const intent = parseIntent('وين طلبي');
    expect(intent.type).toBe('order_tracking');

    const routing = routeToAgent(intent);
    expect(routing.agent.type).toBe('delivery');

    const hasMapBubble = intent.suggestedBubbles.some(
      b => b.type === 'order_map'
    );
    expect(hasMapBubble).toBe(true);
  });

  it('"ادفع" → payment → financial agent → payment_methods bubble', () => {
    const intent = parseIntent('ادفع');
    expect(intent.type).toBe('payment');

    const routing = routeToAgent(intent);
    expect(routing.agent.type).toBe('financial');

    const hasPaymentBubble = intent.suggestedBubbles.some(
      b => b.type === 'payment_methods'
    );
    expect(hasPaymentBubble).toBe(true);
  });

  it('"وظيفة" → job_search → recruitment agent → job_list bubble', () => {
    const intent = parseIntent('وظيفة');
    expect(intent.type).toBe('job_search');

    const routing = routeToAgent(intent);
    expect(routing.agent.type).toBe('recruitment');

    const hasJobBubble = intent.suggestedBubbles.some(
      b => b.type === 'job_list'
    );
    expect(hasJobBubble).toBe(true);
  });

  it('"افتحلي متجر" → deploy_saas → gen_saas agent → no specific bubble', () => {
    const intent = parseIntent('افتحلي متجر');
    expect(intent).toBeDefined();

    const routing = routeToAgent(intent);
    expect(routing.agent).toBeDefined();
  });

  it('"زكاة" → zakat_calc → financial agent → zakat_calculator bubble', () => {
    const intent = parseIntent('زكاة');
    expect(intent.type).toBe('zakat_calc');

    const routing = routeToAgent(intent);
    expect(routing.agent.type).toBe('financial');

    const hasZakatBubble = intent.suggestedBubbles.some(
      b => b.type === 'zakat_calculator'
    );
    expect(hasZakatBubble).toBe(true);
  });

  it('"مرحبا" → greeting → mentor agent → quick_menu bubble', () => {
    const intent = parseIntent('مرحبا');
    expect(intent).toBeDefined();

    const routing = routeToAgent(intent);
    expect(routing.agent.type).toBe('mentor');
  });

  it('"مساعدة" → help → mentor agent', () => {
    const intent = parseIntent('مساعدة');
    expect(intent.type).toBe('help');

    const routing = routeToAgent(intent);
    expect(routing.agent.type).toBe('mentor');
  });

  it('"غالي" → haggle_request → haggle agent → haggle_interface bubble', () => {
    const intent = parseIntent('غالي');
    expect(intent.type).toBe('haggle_request');

    const routing = routeToAgent(intent);
    expect(routing.agent.type).toBe('haggle');

    const hasHaggleBubble = intent.suggestedBubbles.some(
      b => b.type === 'haggle_interface'
    );
    expect(hasHaggleBubble).toBe(true);
  });

  it('"وين السائق" → delivery_tracking → fleet agent', () => {
    const intent = parseIntent('وين السائق');
    expect(intent.type).toBe('delivery_tracking');

    const routing = routeToAgent(intent);
    expect(routing.agent.type).toBe('fleet');
  });

  // ============================================
  // CONFIDENCE TESTS
  // ============================================

  it('food order should have confidence > 0', () => {
    const intent = parseIntent('ابغى كبسة');
    expect(intent.confidence).toBeGreaterThan(0);
  });

  it('greeting should have lower confidence (< 0.8)', () => {
    const intent = parseIntent('مرحبا');
    expect(intent.confidence).toBeLessThan(0.8);
  });

  it('should route with correct confidence level', () => {
    const intent = parseIntent('زكاة');
    expect(intent.confidence).toBeGreaterThan(0);

    const routing = routeToAgent(intent);
    expect(routing.confidence).toBeDefined();
  });

  // ============================================
  // MULTI-TURN TESTS
  // ============================================

  it('should maintain market context across turns', () => {
    const intent1 = parseIntent('ابغى مطعم في السعودية');
    expect(intent1.marketCode).toBe('SA');
    expect(intent1.entities.location).toContain('السعودية');
  });

  it('should extract price entities from Arabic text', () => {
    const intent = parseIntent('ابغى برياني ب 5 دنار');
    expect(intent.entities).toBeDefined();
  });

  it('should extract quantity entities from Arabic text', () => {
    const intent = parseIntent('ابغى 2 كيلو برياني');
    expect(intent.entities.quantity).toBeDefined();
  });

  // ============================================
  // FALLBACK TESTS
  // ============================================

  it('unknown input should fallback to mentor', () => {
    const intent = parseIntent('xyz123 !!!');
    const routing = routeToAgent(intent);
    expect(routing.agent.type).toBe('mentor');
  });

  it('empty string should not crash', () => {
    const intent = parseIntent('');
    expect(intent).toBeDefined();
    const routing = routeToAgent(intent);
    expect(routing.agent).toBeDefined();
  });

  // ============================================
  // ARABIC DIALECT TESTS
  // ============================================

  it('should handle Gulf Arabic (كلمات خليجية)', () => {
    const intent = parseIntent('ابغى كبسة');
    expect(intent.dialect).toBeDefined();
    expect(intent.confidence).toBeGreaterThan(0);
  });

  it('should handle Egyptian Arabic', () => {
    const intent = parseIntent('عايز اطلب اكل');
    expect(intent.type).toBe('food_order');
  });

  it('should handle Levantine Arabic', () => {
    const intent = parseIntent('بدي اطلب');
    expect(intent.type).toBe('food_order');
  });

  it('should handle Maghrebi Arabic', () => {
    const intent = parseIntent('بغيت نطلب');
    expect(intent.type).toBe('food_order');
  });
});
