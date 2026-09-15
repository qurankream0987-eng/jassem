/**
 * Block 3 §92 — canonical Money proofs: currency-aware precision (KWD = 3
 * decimals), exact round-trips, fee/refund arithmetic, zero float drift.
 */
import { describe, expect, it } from "vitest";
import {
  addMoney,
  compareMoney,
  formatMoney,
  moneyOf,
  mulMoneyByQuantity,
  parseMoney,
  percentageOf,
  subMoney,
  moneySchema,
} from "../../api/runtime/block3/money";

describe("Block 3 money — KWD 3-decimal exactness", () => {
  it.each([
    ["0.001", "1"],
    ["1.005", "1005"],
    ["10.125", "10125"],
    ["999999.999", "999999999"],
    ["249.500", "249500"],
  ])("parses %s KWD to exact minor units %s", (amount, minor) => {
    const money = parseMoney(amount, "KWD");
    expect(money).toEqual({ minor, currency: "KWD" });
    expect(formatMoney(money)).toBe(amount);
  });

  it("round-trips KWD through JSON serialization exactly", () => {
    const original = parseMoney("10.125", "KWD");
    const revived = moneySchema.parse(JSON.parse(JSON.stringify(original)));
    expect(revived).toEqual(original);
    expect(formatMoney(revived)).toBe("10.125");
  });

  it("rejects precision beyond the KWD scale instead of rounding silently", () => {
    expect(() => parseMoney("0.0010000002", "KWD")).toThrow(/precision/i);
    expect(() => parseMoney("1.0001", "KWD")).toThrow(/precision/i);
  });
});

describe("Block 3 money — currency-aware precision", () => {
  it("handles different currency scales", () => {
    expect(parseMoney("10.12", "USD")).toEqual({ minor: "1012", currency: "USD" });
    expect(parseMoney("10", "JPY")).toEqual({ minor: "10", currency: "JPY" });
    expect(() => parseMoney("10.5", "JPY")).toThrow(/precision/i);
    expect(formatMoney(parseMoney("0.01", "USD"))).toBe("0.01");
  });

  it("normalizes currency codes and rejects invalid ones", () => {
    expect(parseMoney("1", " kwd ")).toEqual({ minor: "1000", currency: "KWD" });
    expect(() => parseMoney("1", "??")).toThrow(/currency/i);
    expect(() => parseMoney("1", "")).toThrow(/currency/i);
  });

  it("rejects cross-currency arithmetic", () => {
    expect(() => addMoney(parseMoney("1", "KWD"), parseMoney("1", "USD"))).toThrow(/mismatch/i);
    expect(() => compareMoney(parseMoney("1", "KWD"), parseMoney("1", "USD"))).toThrow(/mismatch/i);
  });
});

describe("Block 3 money — exact arithmetic without float drift", () => {
  it("adds and subtracts exactly (0.1 + 0.2 style drift impossible)", () => {
    const a = parseMoney("0.001", "KWD");
    const b = parseMoney("0.002", "KWD");
    expect(formatMoney(addMoney(a, b))).toBe("0.003");
    expect(formatMoney(subMoney(parseMoney("1.005", "KWD"), parseMoney("0.005", "KWD")))).toBe("1.000");
    // The classic float failure: 0.1 + 0.2 must equal 0.3 exactly.
    expect(formatMoney(addMoney(parseMoney("0.1", "USD"), parseMoney("0.2", "USD")))).toBe("0.30");
  });

  it("handles huge values beyond float53 exactly", () => {
    const huge = parseMoney("9007199254740.993", "KWD");
    const one = parseMoney("0.001", "KWD");
    expect(formatMoney(addMoney(huge, one))).toBe("9007199254740.994");
    expect(formatMoney(subMoney(huge, one))).toBe("9007199254740.992");
  });

  it("multiplies by whole quantities", () => {
    expect(formatMoney(mulMoneyByQuantity(parseMoney("12.500", "KWD"), 3))).toBe("37.500");
    expect(() => mulMoneyByQuantity(parseMoney("1", "USD"), 1.5)).toThrow(/quantity/i);
  });
});

describe("Block 3 money — fee and refund arithmetic (one canonical rounding rule)", () => {
  it("computes percentage fees exactly with HALF_UP rounding", () => {
    // 2.5% of 100.000 KWD = 2.500 KWD exactly.
    expect(formatMoney(percentageOf(parseMoney("100.000", "KWD"), "2.5"))).toBe("2.500");
    // 2.5% of 10.125 KWD = 0.253125 → HALF_UP to 0.253.
    expect(formatMoney(percentageOf(parseMoney("10.125", "KWD"), "2.5"))).toBe("0.253");
    // Rounding boundary: 0.0005 minor → rounds up; below → down.
    expect(formatMoney(percentageOf(parseMoney("0.020", "KWD"), "2.5"))).toBe("0.001"); // 0.0005 → 0.001
    expect(formatMoney(percentageOf(parseMoney("0.019", "KWD"), "2.5"))).toBe("0.000"); // 0.000475 → 0.000
  });

  it("computes partial refunds exactly", () => {
    const paid = parseMoney("249.500", "KWD");
    const half = mulRatioHelper(paid);
    expect(formatMoney(half)).toBe("124.750");
    expect(formatMoney(subMoney(paid, half))).toBe("124.750");
  });

  it("never invents money: fee + remainder reconcile to the gross", () => {
    const gross = parseMoney("999999.999", "KWD");
    const fee = percentageOf(gross, "2.5");
    const net = subMoney(gross, fee);
    expect(formatMoney(addMoney(net, fee))).toBe("999999.999");
  });
});

function mulRatioHelper(money: ReturnType<typeof parseMoney>) {
  // 1/2 via the ratio primitive (partial-refund path).
  return percentageOf(money, "50");
}
