/**
 * Block 3 §57–§60 — the ONE generic FeeRule engine.
 *
 * Fees/commissions/margins are NEVER hardcoded per domain and NEVER decided
 * by an LLM. A FeeRule is owner-configured data: fixed, percentage, tiered
 * (the three native formula shapes), plus alias kinds (success, service,
 * booking, usage, subscription, listing, promotion, margin) that must carry
 * a native formula in config. Rules are versioned — changing policy creates
 * a new version row and never rewrites history. Every RevenueEvent cites
 * the rule id + version that produced it.
 */

import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { feeRules, FEE_RULE_KINDS, type FeeRuleRecord } from "@db/schema";
import type { Block2Db } from "../block2/temporal";
import {
  addMoney,
  formatMoney,
  moneyOf,
  normalizeCurrency,
  parseMoney,
  percentageOf,
  subMoney,
  type Money,
} from "./money";

export class FeeRuleError extends Error {
  readonly code: "INVALID_RULE" | "NOT_FOUND" | "INELIGIBLE" | "CURRENCY_MISMATCH";
constructor(
    message: string,
    code: "INVALID_RULE" | "NOT_FOUND" | "INELIGIBLE" | "CURRENCY_MISMATCH",
  ) {
    super(message);
    this.code = code;
  }
}

type FixedConfig = { amountMinor: string; currency: string };
type PercentConfig = { percent: string };
type Tier = { upToMinor: string | null; amountMinor?: string; percent?: string };

function nativeFormula(rule: Pick<FeeRuleRecord, "kind" | "config">): {
  fixed?: FixedConfig;
  percent?: PercentConfig;
  tiers?: Tier[];
} {
  const config = rule.config as Record<string, unknown>;
  switch (rule.kind) {
    case "fixed":
      return { fixed: config as unknown as FixedConfig };
    case "percentage":
      return { percent: config as unknown as PercentConfig };
    case "tiered":
      return { tiers: (config.tiers as Tier[] | undefined) ?? [] };
    default:
      // Alias kinds must carry a native formula — no domain code anywhere.
      return {
        fixed: config.fixed as FixedConfig | undefined,
        percent: config.percent ? { percent: String(config.percent) } : undefined,
        tiers: config.tiers as Tier[] | undefined,
      };
  }
}

/**
 * Evaluate a fee rule against gross money. Exact arithmetic only;
 * HALF_UP at the minor unit, applied once per ratio.
 */
export function evaluateFeeRule(rule: Pick<FeeRuleRecord, "kind" | "config">, gross: Money): Money {
  const { fixed, percent, tiers } = nativeFormula(rule);
  if (fixed) {
    const fee = moneyOf(fixed.amountMinor, normalizeCurrency(fixed.currency));
    if (fee.currency !== gross.currency) {
      throw new FeeRuleError(`Fee currency ${fee.currency} ≠ gross currency ${gross.currency}`, "CURRENCY_MISMATCH");
    }
    return fee;
  }
  if (percent) {
    return percentageOf(gross, percent.percent);
  }
  if (tiers && tiers.length > 0) {
    // Progressive tiers: each slice up to the bracket ceiling is rated.
    const grossMinor = BigInt(gross.minor);
    let remaining = grossMinor;
    let floor = 0n;
    let fee = moneyOf("0", gross.currency);
    for (const tier of tiers) {
      if (remaining <= 0n) break;
      const ceiling = tier.upToMinor === null ? null : BigInt(tier.upToMinor);
      const bracket = ceiling === null ? remaining : remaining < ceiling - floor ? remaining : ceiling - floor;
      if (bracket <= 0n) break;
      const slice = moneyOf(bracket.toString(), gross.currency);
      const sliceFee = tier.amountMinor
        ? moneyOf(tier.amountMinor, gross.currency)
        : tier.percent
          ? percentageOf(slice, tier.percent)
          : moneyOf("0", gross.currency);
      fee = addMoney(fee, sliceFee);
      remaining -= bracket;
      floor = ceiling ?? floor;
    }
    return fee;
  }
  throw new FeeRuleError(`Fee rule ${rule.kind} carries no native formula`, "INVALID_RULE");
}

/** Create a fee rule (version 1 or a superseding new version of a policy). */
export async function createFeeRule(
  db: Block2Db,
  input: {
    ownerId: string;
    worldId?: string;
    kind: FeeRuleRecord["kind"];
    triggerEventType: string;
    config: Record<string, unknown>;
    /** Supersedes this rule id (same policy, new version). */
    supersedesRuleId?: string;
    now?: Date;
  },
): Promise<FeeRuleRecord> {
  if (!FEE_RULE_KINDS.includes(input.kind)) {
    throw new FeeRuleError(`Unknown fee rule kind: ${input.kind}`, "INVALID_RULE");
  }
  let version = 1;
  if (input.supersedesRuleId) {
    const [previous] = await db.select().from(feeRules).where(eq(feeRules.id, input.supersedesRuleId)).limit(1);
    if (!previous || previous.ownerId !== input.ownerId) {
      throw new FeeRuleError(`Superseded rule not found: ${input.supersedesRuleId}`, "NOT_FOUND");
    }
    await db.update(feeRules).set({ status: "SUPERSEDED" }).where(eq(feeRules.id, previous.id));
    version = previous.version + 1;
    if (input.worldId === undefined) input.worldId = previous.worldId ?? undefined;
  }
  const [rule] = await db
    .insert(feeRules)
    .values({
      id: `fee_${randomUUID()}`,
      ownerId: input.ownerId,
      worldId: input.worldId,
      kind: input.kind,
      triggerEventType: input.triggerEventType,
      config: input.config,
      version,
    })
    .returning();
  return rule;
}

/** Active rules bound to a verified economic event type, for an owner. */
export async function activeFeeRulesFor(db: Block2Db, ownerId: string, triggerEventType: string) {
  return db
    .select()
    .from(feeRules)
    .where(and(eq(feeRules.ownerId, ownerId), eq(feeRules.triggerEventType, triggerEventType), eq(feeRules.status, "ACTIVE")));
}

/**
 * Recognize revenue for a VERIFIED economic event: applies every ACTIVE
 * bound rule and returns exact fee lines citing rule id + version. Callers
 * append the JASIM_REVENUE / SELLER_PAYABLE ledger entries themselves.
 */
export function computeFeeLines(
  rules: FeeRuleRecord[],
  gross: Money,
): Array<{ ruleId: string; ruleVersion: number; fee: Money; net: Money }> {
  return rules.map((rule) => {
    const fee = evaluateFeeRule(rule, gross);
    return { ruleId: rule.id, ruleVersion: rule.version, fee, net: subMoney(gross, fee) };
  });
}

/** Human/audit rendering (exact decimal strings — never floats). */
export function describeFee(rule: Pick<FeeRuleRecord, "kind" | "config">, gross: Money): string {
  const fee = evaluateFeeRule(rule, gross);
  return `${formatMoney(fee)} ${fee.currency}`;
}

export { addMoney, parseMoney, type Money };
