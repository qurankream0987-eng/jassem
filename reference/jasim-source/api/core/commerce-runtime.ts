/**
 * JASIM Commerce Runtime — Generic Commerce Primitives
 *
 * Matching, negotiation, approval, and commerce action primitives.
 * All operations are generic and domain-agnostic.
 */

import { z } from "zod";
import { eq, and, gte, lte, desc } from "drizzle-orm";
import { db } from "../queries/connection";
import { entities, approvals, type Entity, type NewEntity, type Approval, type NewApproval } from "@db/schema";
import {
  type MatchCriteria,
  type MatchResult,
  type MatchCandidate,
  type NegotiationState,
  type NegotiationResult,
  type CapabilityRiskLevel,
  type CommerceAction,
  CAPABILITY_RISK_LEVELS,
  COMMERCE_ACTIONS,
} from "@contracts/jasim";
import {
  ValidationError,
  NotFoundError,
  ApprovalError,
  ERROR_CODES,
} from "@contracts/errors";
import type { Cytoplasm } from "./cytoplasm";

// ═══════════════════════════════════════════════════════════════════════════════
// Commerce Runtime
// ═══════════════════════════════════════════════════════════════════════════════

export class CommerceRuntime {
  private cytoplasm: Cytoplasm;

  constructor(cytoplasm: Cytoplasm) {
    this.cytoplasm = cytoplasm;
  }

  // ── Matching Engine ────────────────────────────────────────────────────────────

  async match(criteria: MatchCriteria): Promise<MatchResult[]> {
    const validated = z.object({
      request: z.string(),
      constraints: z.record(z.unknown()),
      location: z.object({ latitude: z.number(), longitude: z.number(), radiusKm: z.number() }).optional(),
      availability: z.object({ timezone: z.string() }).optional(),
      priceRange: z.object({ min: z.number().optional(), max: z.number().optional(), currency: z.string() }).optional(),
      quality: z.object({ minScore: z.number() }).optional(),
      reputation: z.object({ minScore: z.number() }).optional(),
      capabilities: z.array(z.string()).optional(),
      preferences: z.record(z.unknown()).optional(),
    }).parse(criteria);

    // Build query conditions
    const allEntities = await db.query.entities.findMany({
      limit: 500,
    });

    const results: MatchResult[] = [];

    // Score each entity
    const candidates: MatchCandidate[] = allEntities.map((entity) => {
      let score = 0;
      const breakdown: Record<string, number> = {};

      // Name/description relevance
      const entityName = entity.name?.toLowerCase() ?? "";
      const entityType = entity.type?.toLowerCase() ?? "";
      const requestWords = validated.request.toLowerCase().split(/\s+/);
      let relevance = 0;
      for (const word of requestWords) {
        if (word.length > 2) {
          if (entityName.includes(word)) relevance += 0.15;
          if (entityType.includes(word)) relevance += 0.1;
        }
      }
      breakdown.relevance = Math.min(relevance, 1.0);
      score += breakdown.relevance * 0.3;

      // Reputation score
      const rep = entity.reputation as { score?: number } | null;
      if (rep?.score !== undefined) {
        if (validated.reputation && rep.score < validated.reputation.minScore) {
          breakdown.reputation = 0;
        } else {
          breakdown.reputation = rep.score;
          score += rep.score * 0.2;
        }
      } else {
        breakdown.reputation = 0.5;
        score += 0.1;
      }

      // Attribute matching
      const attrs = entity.attributes as Record<string, unknown> | null;
      if (attrs && validated.constraints) {
        let attrMatch = 0;
        const constraintKeys = Object.keys(validated.constraints);
        for (const key of constraintKeys) {
          if (attrs[key] !== undefined) {
            const expected = validated.constraints[key];
            const actual = attrs[key];
            if (JSON.stringify(expected) === JSON.stringify(actual)) {
              attrMatch += 1;
            }
          }
        }
        breakdown.attributes = constraintKeys.length > 0 ? attrMatch / constraintKeys.length : 0.5;
        score += breakdown.attributes * 0.2;
      } else {
        breakdown.attributes = 0.5;
      }

      // Capability matching
      const entityCaps = entity.capabilities as string[] | null;
      if (validated.capabilities && validated.capabilities.length > 0) {
        const matched = validated.capabilities.filter((c) => entityCaps?.includes(c)).length;
        breakdown.capabilities = validated.capabilities.length > 0 ? matched / validated.capabilities.length : 0;
        score += breakdown.capabilities * 0.3;
      } else {
        breakdown.capabilities = 0.5;
      }

      return {
        entity,
        score: Math.min(score, 1.0),
        breakdown,
        metadata: { source: "generic_matcher" },
      };
    });

    // Filter by threshold and sort
    const filtered = candidates.filter((c) => c.score > 0.2);
    filtered.sort((a, b) => b.score - a.score);

    const result: MatchResult = {
      requestId: `match_${Date.now()}`,
      candidates: filtered.slice(0, 20),
      topCandidateId: filtered.length > 0 ? String(filtered[0].entity.id) : undefined,
      criteria: validated,
      timestamp: new Date().toISOString(),
      metadata: { totalScanned: allEntities.length, matchedCount: filtered.length },
    };

    results.push(result);

    // Log trace
    await this.cytoplasm.tracer.trace({
      inputs: { criteria: validated },
      outputs: { result },
      duration: 0,
      status: "completed",
      metadata: { phase: "commerce.match" },
    });

    return results;
  }

  // ── Negotiation Engine ─────────────────────────────────────────────────────────

  async negotiate(negotiation: NegotiationState): Promise<NegotiationResult> {
    const validated = z.object({
      objective: z.string(),
      limits: z.record(z.object({ min: z.number().optional(), max: z.number().optional() })),
      preferences: z.record(z.unknown()),
      allowedActions: z.array(z.nativeEnum(COMMERCE_ACTIONS)),
      forbiddenActions: z.array(z.nativeEnum(COMMERCE_ACTIONS)),
      authority: z.string(),
      approvalThreshold: z.number(),
      currentOffer: z.record(z.unknown()).optional(),
      counterOffer: z.record(z.unknown()).optional(),
      status: z.enum(["open", "accepted", "rejected", "expired", "countered"]),
      metadata: z.record(z.unknown()).optional(),
    }).parse(negotiation);

    // Evaluate current state
    const result = this.evaluateNegotiation(validated);

    // Log trace
    await this.cytoplasm.tracer.trace({
      inputs: { negotiation: validated },
      outputs: { result },
      duration: 0,
      status: "completed",
      metadata: { phase: "commerce.negotiate" },
    });

    return result;
  }

  // ── Approval Engine ────────────────────────────────────────────────────────────

  async requestApproval(approval: Omit<NewApproval, "id" | "createdAt">): Promise<Approval> {
    const validated = z.object({
      taskId: z.number(),
      stepId: z.number().optional(),
      action: z.string().min(1),
      actor: z.string().optional(),
      permission: z.string().optional(),
      policy: z.record(z.unknown()).optional(),
      riskLevel: z.enum(CAPABILITY_RISK_LEVELS).default("low"),
      required: z.boolean().default(true),
      approved: z.boolean().optional(),
      approvedBy: z.number().optional(),
      approvedAt: z.date().optional(),
      expiresAt: z.date().optional(),
      metadata: z.record(z.unknown()).optional(),
    }).parse(approval);

    const [result] = await db.insert(approvals).values(validated);
    const inserted = await db.query.approvals.findFirst({
      where: eq(approvals.id, Number(result.insertId)),
    });

    if (!inserted) {
      throw new ValidationError(ERROR_CODES.VALIDATION_FAILED, "Approval creation failed");
    }

    // Publish event
    await this.cytoplasm.events.publish({
      type: "APPROVAL_REQUIRED",
      source: "commerce_runtime",
      payload: { approvalId: inserted.id, action: inserted.action, riskLevel: inserted.riskLevel },
      priority: inserted.riskLevel === "critical" ? "critical" : "high",
    });

    return inserted;
  }

  async processApproval(approvalId: number, decision: boolean, actorId: number): Promise<Approval> {
    const existing = await db.query.approvals.findFirst({
      where: eq(approvals.id, approvalId),
    });

    if (!existing) {
      throw new NotFoundError("Approval", String(approvalId));
    }

    if (existing.approved !== null) {
      throw new ApprovalError(ERROR_CODES.APPROVAL_DENIED, "Approval already processed", String(approvalId));
    }

    if (existing.expiresAt && existing.expiresAt < new Date()) {
      throw new ApprovalError(ERROR_CODES.APPROVAL_EXPIRED, "Approval has expired", String(approvalId));
    }

    // Check policy
    const policyResult = await this.cytoplasm.policies.evaluate(
      existing.action,
      String(actorId),
      `approval:${approvalId}`,
      { riskLevel: existing.riskLevel, decision }
    );

    if (!policyResult.allowed && decision) {
      throw new ApprovalError(
        ERROR_CODES.POLICY_VIOLATION,
        `Policy violation: ${policyResult.reason}`,
        String(approvalId)
      );
    }

    await db.update(approvals).set({
      approved: decision,
      approvedBy: actorId,
      approvedAt: new Date(),
    }).where(eq(approvals.id, approvalId));

    const updated = await db.query.approvals.findFirst({
      where: eq(approvals.id, approvalId),
    });

    if (!updated) {
      throw new NotFoundError("Approval", String(approvalId));
    }

    // Publish event
    await this.cytoplasm.events.publish({
      type: "TASK_UPDATED",
      source: "commerce_runtime",
      payload: { approvalId, decision, actorId, action: existing.action },
      priority: "high",
    });

    return updated;
  }

  // ── Commerce Primitives ──────────────────────────────────────────────────────

  async discover(query: string): Promise<unknown> {
    const entities = await db.query.entities.findMany({
      limit: 50,
    });

    const queryLower = query.toLowerCase();
    const filtered = entities.filter((e) => {
      const name = e.name?.toLowerCase() ?? "";
      const type = e.type?.toLowerCase() ?? "";
      const attrs = JSON.stringify(e.attributes ?? {}).toLowerCase();
      return name.includes(queryLower) || type.includes(queryLower) || attrs.includes(queryLower);
    });

    return {
      query,
      results: filtered,
      total: filtered.length,
      timestamp: new Date().toISOString(),
    };
  }

  async search(query: string, filters: Record<string, unknown>): Promise<unknown> {
    const allEntities = await db.query.entities.findMany({ limit: 200 });

    const queryLower = query.toLowerCase();
    let results = allEntities.filter((e) => {
      const name = e.name?.toLowerCase() ?? "";
      return name.includes(queryLower);
    });

    // Apply generic filters
    if (filters.type) {
      results = results.filter((e) => e.type === filters.type);
    }
    if (filters.minReputation) {
      const min = Number(filters.minReputation);
      results = results.filter((e) => {
        const rep = e.reputation as { score?: number } | null;
        return (rep?.score ?? 0) >= min;
      });
    }

    return {
      query,
      filters,
      results,
      total: results.length,
      timestamp: new Date().toISOString(),
    };
  }

  async compare(items: unknown[]): Promise<unknown> {
    if (items.length < 2) {
      throw new ValidationError(ERROR_CODES.VALIDATION_FAILED, "Compare requires at least 2 items", "items");
    }

    const comparison: Record<string, unknown> = {};
    const keys = new Set<string>();

    for (const item of items) {
      if (item && typeof item === "object") {
        for (const key of Object.keys(item as Record<string, unknown>)) {
          keys.add(key);
        }
      }
    }

    for (const key of keys) {
      comparison[key] = items.map((item) => (item as Record<string, unknown> | null)?.[key] ?? null);
    }

    return {
      items,
      dimensions: Array.from(keys),
      comparison,
      differences: this.findDifferences(items, Array.from(keys)),
      timestamp: new Date().toISOString(),
    };
  }

  async quote(request: Record<string, unknown>): Promise<unknown> {
    const { item, quantity = 1 } = request;
    const basePrice = Math.random() * 100 + 10;
    const total = basePrice * Number(quantity);

    return {
      item,
      quantity,
      unitPrice: basePrice,
      total,
      currency: "USD",
      validUntil: new Date(Date.now() + 86400000).toISOString(),
      timestamp: new Date().toISOString(),
    };
  }

  async offer(request: Record<string, unknown>): Promise<unknown> {
    const { item, offeredPrice, targetPrice } = request;
    const offPrice = Number(offeredPrice);
    const tgtPrice = Number(targetPrice);
    const gap = Math.abs(tgtPrice - offPrice) / tgtPrice;
    const accepted = gap < 0.15;

    return {
      item,
      offeredPrice: offPrice,
      targetPrice: tgtPrice,
      gapPercent: gap * 100,
      accepted,
      counterOffer: accepted ? undefined : offPrice * 0.95,
      timestamp: new Date().toISOString(),
    };
  }

  async order(request: Record<string, unknown>): Promise<unknown> {
    const orderId = `order_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // If risk is high, require approval
    const riskLevel = (request.riskLevel as string) ?? "low";
    if (["high", "critical"].includes(riskLevel)) {
      const [approvalResult] = await db.insert(approvals).values({
        taskId: 0,
        action: `order:${orderId}`,
        riskLevel: riskLevel as "low" | "medium" | "high" | "critical",
        required: true,
      });

      return {
        orderId,
        status: "pending_approval",
        approvalId: Number(approvalResult.insertId),
        request,
        timestamp: new Date().toISOString(),
      };
    }

    return {
      orderId,
      status: "confirmed",
      request,
      timestamp: new Date().toISOString(),
    };
  }

  async track(id: string): Promise<unknown> {
    // Generic tracking — resolve entity or return tracking info
    const entity = await db.query.entities.findFirst({
      where: eq(entities.id, Number(id)),
    });

    if (entity) {
      return {
        id,
        type: "entity",
        status: "active",
        entity,
        timestamp: new Date().toISOString(),
      };
    }

    return {
      id,
      type: "unknown",
      status: "not_found",
      timestamp: new Date().toISOString(),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // Private Helpers
  // ═══════════════════════════════════════════════════════════════════════════════

  private evaluateNegotiation(state: NegotiationState): NegotiationResult {
    const { currentOffer, counterOffer, limits, status } = state;

    if (status === "accepted" || status === "rejected" || status === "expired") {
      return {
        agreement: status === "accepted",
        status,
        rounds: 1,
        finalOffer: currentOffer,
        reason: status === "accepted" ? "Both parties agreed" : status === "rejected" ? "Offer rejected" : "Negotiation expired",
      };
    }

    // Check if current offer is within limits
    let withinLimits = true;
    const limitViolations: string[] = [];

    for (const [dimension, bounds] of Object.entries(limits)) {
      const offerValue = currentOffer?.[dimension] as number | undefined;
      if (offerValue !== undefined) {
        if (bounds.min !== undefined && offerValue < bounds.min) {
          withinLimits = false;
          limitViolations.push(`${dimension} below minimum ${bounds.min}`);
        }
        if (bounds.max !== undefined && offerValue > bounds.max) {
          withinLimits = false;
          limitViolations.push(`${dimension} above maximum ${bounds.max}`);
        }
      }
    }

    if (withinLimits && counterOffer) {
      // Check if offer and counter-offer are close enough
      let closeEnough = true;
      for (const key of Object.keys(currentOffer ?? {})) {
        const offerVal = (currentOffer as Record<string, unknown>)?.[key] as number;
        const counterVal = (counterOffer as Record<string, unknown>)?.[key] as number;
        if (typeof offerVal === "number" && typeof counterVal === "number") {
          const gap = Math.abs(offerVal - counterVal) / Math.max(offerVal, counterVal, 1);
          if (gap > 0.2) {
            closeEnough = false;
            break;
          }
        }
      }

      if (closeEnough) {
        return {
          agreement: true,
          status: "accepted",
          rounds: 1,
          finalOffer: currentOffer,
          reason: "Offer and counter-offer are within acceptable range",
        };
      }
    }

    // Generate counter-offer
    const suggestedCounter: Record<string, unknown> = {};
    for (const [dimension, bounds] of Object.entries(limits)) {
      const currentVal = (currentOffer as Record<string, unknown>)?.[dimension] as number | undefined;
      if (currentVal !== undefined) {
        const target = bounds.min !== undefined && bounds.max !== undefined
          ? (bounds.min + bounds.max) / 2
          : currentVal;
        suggestedCounter[dimension] = Math.round(target * 100) / 100;
      }
    }

    return {
      agreement: false,
      status: "countered",
      rounds: 1,
      finalOffer: currentOffer,
      reason: withinLimits ? "Counter-offer generated" : `Limit violations: ${limitViolations.join(", ")}`,
      counterOffer: suggestedCounter,
    };
  }

  private findDifferences(items: unknown[], keys: string[]): Record<string, unknown> {
    const differences: Record<string, unknown> = {};
    for (const key of keys) {
      const values = items.map((item) => (item as Record<string, unknown> | null)?.[key]);
      const unique = [...new Set(values.map((v) => JSON.stringify(v)))];
      if (unique.length > 1) {
        differences[key] = { values, different: true };
      }
    }
    return differences;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Negotiation Result Type (local extension)
// ═══════════════════════════════════════════════════════════════════════════════

export interface NegotiationResult {
  agreement: boolean;
  status: string;
  rounds: number;
  finalOffer?: Record<string, unknown>;
  counterOffer?: Record<string, unknown>;
  reason: string;
}
