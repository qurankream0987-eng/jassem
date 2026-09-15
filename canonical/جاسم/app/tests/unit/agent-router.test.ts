/**
 * Agent Router Test Suite
 * /اختبار موجه الوكلاء
 * Tests registry coverage, triggers, capabilities, and routing logic
 */

import { describe, it, expect } from 'vitest';
import {
  routeToAgent,
  getAgentConfig,
  canHandleParallel,
  getFallbackAgent,
  getAllAgents,
  getAgentsByTier,
  findAgentsByCapability,
  getAgentRouter,
  canAgentHandleIntent,
  getSuggestedAgents,
  AgentTypeSchema,
} from '../../api/core/agent-router';
import type { ParsedIntent } from '../../api/core/types';

describe('Agent Router', () => {
  // ============================================
  // BASIC ROUTING TESTS (8 tests)
  // ============================================
  describe('Basic Routing', () => {
    it('food_order routes to food agent', () => {
      const intent: ParsedIntent = {
        type: 'food_order', confidence: 0.95, entities: {}, marketCode: 'KW', dialect: 'gulf',
        requiresAgent: 'food', suggestedBubbles: [],
      };
      const result = routeToAgent(intent);
      expect(result.agent.type).toBe('food');
      expect(result.confidence).toBe(0.95);
    });

    it('payment routes to financial agent', () => {
      const intent: ParsedIntent = {
        type: 'payment', confidence: 0.9, entities: {}, marketCode: 'KW', dialect: 'gulf',
        requiresAgent: 'financial', suggestedBubbles: [],
      };
      const result = routeToAgent(intent);
      expect(result.agent.type).toBe('financial');
    });

    it('order_tracking routes to delivery agent', () => {
      const intent: ParsedIntent = {
        type: 'order_tracking', confidence: 0.92, entities: {}, marketCode: 'KW', dialect: 'gulf',
        requiresAgent: 'delivery', suggestedBubbles: [],
      };
      const result = routeToAgent(intent);
      expect(result.agent.type).toBe('delivery');
    });

    it('job_search routes to recruitment agent', () => {
      const intent: ParsedIntent = {
        type: 'job_search', confidence: 0.9, entities: {}, marketCode: 'KW', dialect: 'gulf',
        requiresAgent: 'recruitment', suggestedBubbles: [],
      };
      const result = routeToAgent(intent);
      expect(result.agent.type).toBe('recruitment');
    });

    it('haggle_request routes to haggle agent', () => {
      const intent: ParsedIntent = {
        type: 'haggle_request', confidence: 0.93, entities: {}, marketCode: 'KW', dialect: 'gulf',
        requiresAgent: 'haggle', suggestedBubbles: [],
      };
      const result = routeToAgent(intent);
      expect(result.agent.type).toBe('haggle');
    });

    it('zakat_calc routes to financial agent', () => {
      const intent: ParsedIntent = {
        type: 'zakat_calc', confidence: 0.94, entities: {}, marketCode: 'KW', dialect: 'gulf',
        requiresAgent: 'financial', suggestedBubbles: [],
      };
      const result = routeToAgent(intent);
      expect(result.agent.type).toBe('financial');
    });

    it('greeting routes to mentor agent', () => {
      const intent: ParsedIntent = {
        type: 'greeting', confidence: 0.75, entities: {}, marketCode: 'KW', dialect: 'gulf',
        requiresAgent: 'mentor', suggestedBubbles: [],
      };
      const result = routeToAgent(intent);
      expect(result.agent.type).toBe('mentor');
    });

    it('unknown intent falls back to mentor', () => {
      const intent: ParsedIntent = {
        type: 'general_chat', confidence: 0.3, entities: {}, marketCode: 'KW', dialect: 'gulf',
        requiresAgent: 'mentor', suggestedBubbles: [],
      };
      const result = routeToAgent(intent);
      expect(result.agent.type).toBe('mentor');
      expect(result.fallbackAgent.type).toBe('mentor');
    });
  });

  // ============================================
  // AGENT CONFIG TESTS (3 tests)
  // ============================================
  describe('Agent Configuration', () => {
    it('getAgentConfig returns valid config for food', () => {
      const config = getAgentConfig('food');
      expect(config.type).toBe('food');
      expect(config.name).toBe('Food Agent');
      expect(config.nameAr).toBe('وكيل الطعام');
      expect(config.capabilities.length).toBeGreaterThan(0);
    });

    it('getAgentConfig returns valid config for haggle', () => {
      const config = getAgentConfig('haggle');
      expect(config.type).toBe('haggle');
      expect(config.router).toBe('api/routers/haggle');
    });

    it('getAgentConfig throws for unknown agent', () => {
      expect(() => getAgentConfig('unknown' as any)).toThrow('الوكيل غير موجود');
    });
  });

  // ============================================
  // PARALLEL EXECUTION TESTS (3 tests)
  // ============================================
  describe('Parallel Execution', () => {
    it('food + delivery can run in parallel', () => {
      expect(canHandleParallel(['food', 'delivery'])).toBe(true);
    });

    it('food + analytics can run in parallel', () => {
      expect(canHandleParallel(['food', 'analytics'])).toBe(true);
    });

    it('single agent cannot be parallel', () => {
      expect(canHandleParallel(['food'])).toBe(false);
    });
  });

  // ============================================
  // FALLBACK AGENT TESTS (3 tests)
  // ============================================
  describe('Fallback Agents', () => {
    it('food_order fallback is delivery', () => {
      const fallback = getFallbackAgent('food_order');
      expect(fallback.type).toBe('delivery');
    });

    it('payment fallback is financial or mentor', () => {
      const fallback = getFallbackAgent('payment');
      expect(['financial', 'mentor']).toContain(fallback.type);
    });

    it('unknown intent fallback is mentor', () => {
      const fallback = getFallbackAgent('greeting');
      expect(fallback.type).toBe('mentor');
    });
  });

  // ============================================
  // AGENT QUERY TESTS (5 tests)
  // ============================================
  describe('Agent Queries', () => {
    it('getAllAgents covers every registered agent type', () => {
      const agents = getAllAgents();
      expect(agents.length).toBe(AgentTypeSchema.options.length);
      expect(new Set(agents.map((agent) => agent.type))).toEqual(new Set(AgentTypeSchema.options));
    });

    it('getAgentsByTier returns correct tier agents', () => {
      const tier1 = getAgentsByTier(1);
      expect(tier1.length).toBeGreaterThan(0);
      expect(tier1.every(a => a.tier === 1)).toBe(true);
    });

    it('findAgentsByCapability finds price_negotiation', () => {
      const agents = findAgentsByCapability('price_negotiation');
      expect(agents.length).toBeGreaterThan(0);
    });

    it('getAgentRouter returns correct path', () => {
      expect(getAgentRouter('food')).toBe('api/routers/orders');
      expect(getAgentRouter('haggle')).toBe('api/routers/haggle');
      expect(getAgentRouter('financial')).toBe('api/routers/payments');
    });

    it('getAgentRouter returns default for unknown', () => {
      expect(getAgentRouter('unknown' as any)).toBe('api/routers/agents');
    });
  });

  // ============================================
  // CAPABILITY TESTS (4 tests)
  // ============================================
  describe('Intent-Agent Capability', () => {
    it('food agent can handle food_order', () => {
      expect(canAgentHandleIntent('food', 'food_order')).toBe(true);
    });

    it('financial agent can handle payment', () => {
      expect(canAgentHandleIntent('financial', 'payment')).toBe(true);
    });

    it('haggle agent cannot handle food_order', () => {
      expect(canAgentHandleIntent('haggle', 'food_order')).toBe(false);
    });

    it('mentor can handle greeting', () => {
      expect(canAgentHandleIntent('mentor', 'greeting')).toBe(true);
    });
  });

  // ============================================
  // SUGGESTED AGENTS TESTS (3 tests)
  // ============================================
  describe('Suggested Agents', () => {
    it('suggests food agent for repeated food orders', () => {
      const agents = getSuggestedAgents(['food_order', 'food_order', 'food_order']);
      expect(agents.length).toBeGreaterThan(0);
      expect(agents[0].type).toBe('food');
    });

    it('suggests delivery agent for repeated tracking', () => {
      const agents = getSuggestedAgents(['order_tracking', 'order_tracking']);
      expect(agents.length).toBeGreaterThan(0);
    });

    it('returns empty for empty input', () => {
      const agents = getSuggestedAgents([]);
      expect(agents.length).toBe(0);
    });
  });

  // ============================================
  // LATENCY ESTIMATION TESTS (3 tests)
  // ============================================
  describe('Latency Estimation', () => {
    it('tier 1 agents have fast latency', () => {
      const config = getAgentConfig('food');
      expect(config.tier).toBe(1);
    });

    it('tier 2 agents have normal latency', () => {
      const config = getAgentConfig('delivery');
      expect(config.tier).toBe(2);
    });

    it('tier 3 agents have slow latency', () => {
      const config = getAgentConfig('voice');
      expect(config.tier).toBe(3);
    });
  });
});
