/**
 * Block 3 — canonical Money.
 *
 * Permanent invariants (execution order §3–§6):
 * - Canonical money is an EXACT INTEGER of currency-minor units + a currency.
 *   No floating-point value ever represents canonical financial truth.
 * - Precision is currency-aware (KWD/BHD/OMR… = 3 decimals, JPY = 0,
 *   default = 2). Parsing rejects precision beyond the currency scale —
 *   never silently rounded on entry.
 * - One canonical rounding rule for ratio arithmetic: ROUND_HALF_UP at the
 *   minor unit, applied exactly once per fee/refund computation.
 * - Transport/storage is string-based; Number()/parseFloat are forbidden on
 *   this path (bigint internally, decimal strings at the boundary).
 */

import { z } from "zod";

/** Currency minor-unit scales. Anything unlisted defaults to 2. */
const CURRENCY_SCALES: Record<string, number> = {
  // 3-decimal currencies (incl. KWD — the critical acceptance case)
  KWD: 3, BHD: 3, OMR: 3, TND: 3, LYD: 3, IQD: 3, JOD: 3,
  // 0-decimal currencies
  JPY: 0, KRW: 0, VND: 0, CLP: 0, XOF: 0,
};
const DEFAULT_SCALE = 2;

/**
 * Codes this runtime will treat as MONEY.
 *
 * A unit string alone cannot tell a currency from anything else: «DAY», «KM»
 * and «KWD» are all three uppercase letters. So a code counts as a currency
 * only when it is registered here, and an unregistered one is not money —
 * which fails SAFE, because an unrecognized bound goes unapplied instead of
 * being mis-applied at the wrong scale.
 *
 * This is ISO 4217 metadata, not a currency feature: nothing anywhere branches
 * on a particular code, and adding one changes no behaviour but its scale.
 */
export const KNOWN_CURRENCIES: ReadonlySet<string> = new Set([
  // 3-decimal
  "KWD", "BHD", "OMR", "TND", "LYD", "IQD", "JOD",
  // 0-decimal
  "JPY", "KRW", "VND", "CLP", "XOF", "XAF", "ISK", "PYG", "RWF", "UGX", "VUV",
  // 2-decimal
  "AED", "ARS", "AUD", "BDT", "BGN", "BRL", "CAD", "CHF", "CNY", "COP", "CZK",
  "DKK", "DZD", "EGP", "ETB", "EUR", "GBP", "GHS", "HKD", "HRK", "HUF", "IDR",
  "ILS", "INR", "IRR", "KES", "KZT", "LBP", "LKR", "MAD", "MUR", "MXN", "MYR",
  "NGN", "NOK", "NZD", "PHP", "PKR", "PLN", "QAR", "RON", "RSD", "RUB", "SAR",
  "SDG", "SEK", "SGD", "SYP", "THB", "TRY", "TWD", "TZS", "UAH", "USD", "UYU",
  "UZS", "YER", "ZAR",
]);

/** Whether a unit string names money at all. Never a guess. */
export function isKnownCurrency(unit: string): boolean {
  return KNOWN_CURRENCIES.has(unit.trim().toUpperCase());
}

export const CURRENCY_CODE = /^[A-Z0-9]{3,8}$/;

export function normalizeCurrency(currency: string): string {
  const normalized = currency.trim().toUpperCase();
  if (!CURRENCY_CODE.test(normalized)) {
    throw new MoneyError(`Invalid currency code: ${JSON.stringify(currency)}`, "INVALID_CURRENCY");
  }
  return normalized;
}

export function currencyScale(currency: string): number {
  return CURRENCY_SCALES[normalizeCurrency(currency)] ?? DEFAULT_SCALE;
}

export class MoneyError extends Error {
  readonly code:
    | "INVALID_CURRENCY"
    | "INVALID_AMOUNT"
    | "PRECISION_OVERFLOW"
    | "CURRENCY_MISMATCH"
    | "INVALID_RATIO"
    | "INVALID_QUANTITY";
  constructor(
    message: string,
    code:
      | "INVALID_CURRENCY"
      | "INVALID_AMOUNT"
      | "PRECISION_OVERFLOW"
      | "CURRENCY_MISMATCH"
      | "INVALID_RATIO"
      | "INVALID_QUANTITY",
  ) {
    super(message);
    this.code = code;
  }
}

/** Canonical money: exact integer of minor units (decimal string) + currency. */
export type Money = { minor: string; currency: string };

export const moneySchema = z.object({
  minor: z.string().regex(/^-?\d+$/, "minor must be an exact integer string"),
  currency: z.string().regex(CURRENCY_CODE, "currency must be an uppercase code"),
});

const DECIMAL_INPUT = /^(-?)(\d+)(?:\.(\d+))?$/;

function pow10(scale: number): bigint {
  return 10n ** BigInt(scale);
}

/** Parse an exact decimal string into canonical minor units for the currency. */
export function parseMoney(amount: string, currency: string): Money {
  const code = normalizeCurrency(currency);
  const scale = currencyScale(code);
  const match = DECIMAL_INPUT.exec(amount.trim());
  if (!match) {
    throw new MoneyError(`Amount must be an exact decimal string: ${JSON.stringify(amount)}`, "INVALID_AMOUNT");
  }
  const fracRaw = match[3] ?? "";
  if (fracRaw.length > scale) {
    throw new MoneyError(
      `Amount ${JSON.stringify(amount)} exceeds ${code} precision (${scale} decimals)`,
      "PRECISION_OVERFLOW",
    );
  }
  const frac = fracRaw.padEnd(scale, "0");
  const minor = BigInt(match[2]) * pow10(scale) + BigInt(frac === "" ? "0" : frac);
  return { minor: (match[1] === "-" ? -minor : minor).toString(), currency: code };
}

/** Format canonical money as an exact decimal string at the currency scale. */
export function formatMoney(money: Money): string {
  const scale = currencyScale(money.currency);
  const negative = money.minor.startsWith("-");
  const digits = (negative ? money.minor.slice(1) : money.minor).padStart(scale + 1, "0");
  const intPart = digits.slice(0, digits.length - scale);
  const fracPart = scale === 0 ? "" : `.${digits.slice(digits.length - scale)}`;
  return `${negative ? "-" : ""}${intPart}${fracPart}`;
}

function minorOf(money: Money): bigint {
  moneySchema.parse(money);
  return BigInt(money.minor);
}

function assertSameCurrency(a: Money, b: Money): void {
  if (normalizeCurrency(a.currency) !== normalizeCurrency(b.currency)) {
    throw new MoneyError(`Currency mismatch: ${a.currency} vs ${b.currency}`, "CURRENCY_MISMATCH");
  }
}

export function moneyOf(minor: string | bigint, currency: string): Money {
  return { minor: minor.toString(), currency: normalizeCurrency(currency) };
}

export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return moneyOf(minorOf(a) + minorOf(b), a.currency);
}

export function subMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return moneyOf(minorOf(a) - minorOf(b), a.currency);
}

export function compareMoney(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b);
  const diff = minorOf(a) - minorOf(b);
  return diff > 0n ? 1 : diff < 0n ? -1 : 0;
}

export function isZeroMoney(money: Money): boolean {
  return minorOf(money) === 0n;
}

/** Multiply by a whole-unit quantity (items, units). Quantity must be an integer. */
export function mulMoneyByQuantity(money: Money, quantity: number): Money {
  if (!Number.isSafeInteger(quantity)) {
    throw new MoneyError("Quantity must be a safe integer", "INVALID_QUANTITY");
  }
  return moneyOf(minorOf(money) * BigInt(quantity), money.currency);
}

/**
 * Fee/refund ratio arithmetic: money * numerator / denominator with the ONE
 * canonical rounding rule — ROUND_HALF_UP at the minor unit, applied once.
 * Used for percentage FeeRules (e.g. 2.5% = 25/1000) and partial refunds.
 */
export function mulMoneyByRatio(
  money: Money,
  numerator: string | bigint,
  denominator: string | bigint,
): Money {
  const num = BigInt(numerator);
  const den = BigInt(denominator);
  if (den <= 0n) throw new MoneyError("Ratio denominator must be positive", "INVALID_RATIO");
  const value = minorOf(money);
  const sign = value < 0n ? -1n : 1n;
  const product = value * sign * num;
  const quotient = product / den;
  const remainder = product % den;
  // ROUND_HALF_UP: round away from zero when remainder * 2 >= denominator.
  const rounded = remainder * 2n >= den ? quotient + 1n : quotient;
  return moneyOf(sign * rounded, money.currency);
}

/** Convenience: percentage with up to 4 decimal places (2.5% → 25/1000). */
export function percentageOf(money: Money, percent: string): Money {
  const match = DECIMAL_INPUT.exec(percent.trim());
  if (!match) throw new MoneyError(`Invalid percentage: ${JSON.stringify(percent)}`, "INVALID_RATIO");
  const frac = (match[3] ?? "").padEnd(4, "0").slice(0, 4);
  if ((match[3] ?? "").length > 4) {
    throw new MoneyError("Percentage precision beyond 4 decimals", "INVALID_RATIO");
  }
  const numerator = BigInt(match[2]) * 10000n + BigInt(frac === "" ? "0" : frac);
  return mulMoneyByRatio(money, numerator.toString(), "1000000");
}
