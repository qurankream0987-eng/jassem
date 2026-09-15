/**
 * Zakat Calculation Test Suite
 * /اختبار حساب الزكاة
 * Tests 2.5% zakat calculation on cash, gold, silver, investments, and receivables
 */

import { describe, it, expect } from 'vitest';

describe('Zakat Calculator', () => {
  // ============================================
  // NISAB THRESHOLDS (2024 values in grams)
  // ============================================
  const NISAB_GOLD_GRAMS = 85;      // ~85g gold
  const NISAB_SILVER_GRAMS = 595;    // ~595g silver
  const ZAKAT_RATE = 0.025;          // 2.5%

  /**
   * calculateZakat - Core zakat calculation
   * حساب الزكاة الأساسي
   */
  const calculateZakat = (assets: {
    cash: number;
    goldGrams: number;
    silverGrams: number;
    investments: number;
    receivables: number;
    goldPricePerGram: number;  // in local currency
    silverPricePerGram: number; // in local currency
  }): {
    totalWealth: number;
    nisabThreshold: number;
    nisabMet: boolean;
    zakatDue: number;
    breakdown: {
      cash: number;
      gold: number;
      silver: number;
      investments: number;
      receivables: number;
    };
    currency: string;
  } => {
    const goldValue = assets.goldGrams * assets.goldPricePerGram;
    const silverValue = assets.silverGrams * assets.silverPricePerGram;

    const totalWealth = assets.cash + goldValue + silverValue + assets.investments + assets.receivables;
    const nisabThreshold = NISAB_GOLD_GRAMS * assets.goldPricePerGram;
    const nisabMet = totalWealth >= nisabThreshold;

    const zakatDue = nisabMet ? Math.round(totalWealth * ZAKAT_RATE * 100) / 100 : 0;

    return {
      totalWealth: Math.round(totalWealth * 100) / 100,
      nisabThreshold: Math.round(nisabThreshold * 100) / 100,
      nisabMet,
      zakatDue,
      breakdown: {
        cash: Math.round(assets.cash * ZAKAT_RATE * 100) / 100,
        gold: Math.round(goldValue * ZAKAT_RATE * 100) / 100,
        silver: Math.round(silverValue * ZAKAT_RATE * 100) / 100,
        investments: Math.round(assets.investments * ZAKAT_RATE * 100) / 100,
        receivables: Math.round(assets.receivables * ZAKAT_RATE * 100) / 100,
      },
      currency: 'KWD',
    };
  };

  /**
   * calculateHawl - Check if haul (lunar year) has passed
   */
  const calculateHawl = (ownershipDate: Date, currentDate: Date = new Date()): {
    hawlComplete: boolean;
    daysElapsed: number;
    daysRemaining: number;
  } => {
    const oneDay = 24 * 60 * 60 * 1000;
    const daysElapsed = Math.floor((currentDate.getTime() - ownershipDate.getTime()) / oneDay);
    const hawlDays = 354; // Lunar year
    const daysRemaining = Math.max(0, hawlDays - daysElapsed);

    return {
      hawlComplete: daysElapsed >= hawlDays,
      daysElapsed,
      daysRemaining,
    };
  };

  // ============================================
  // BASIC ZAKAT TESTS
  // ============================================

  describe('2.5% Zakat Rate', () => {
    it('should calculate 2.5% of 10,000 KWD = 250 KWD', () => {
      const result = calculateZakat({
        cash: 10000,
        goldGrams: 0,
        silverGrams: 0,
        investments: 0,
        receivables: 0,
        goldPricePerGram: 20,
        silverPricePerGram: 0.5,
      });
      expect(result.zakatDue).toBe(250);
    });

    it('should calculate 2.5% of 50,000 KWD = 1,250 KWD', () => {
      const result = calculateZakat({
        cash: 50000,
        goldGrams: 0,
        silverGrams: 0,
        investments: 0,
        receivables: 0,
        goldPricePerGram: 20,
        silverPricePerGram: 0.5,
      });
      expect(result.zakatDue).toBe(1250);
    });

    it('should calculate 2.5% of 100,000 KWD = 2,500 KWD', () => {
      const result = calculateZakat({
        cash: 100000,
        goldGrams: 0,
        silverGrams: 0,
        investments: 0,
        receivables: 0,
        goldPricePerGram: 20,
        silverPricePerGram: 0.5,
      });
      expect(result.zakatDue).toBe(2500);
    });
  });

  describe('Nisab Threshold', () => {
    it('should NOT require zakat below nisab', () => {
      const result = calculateZakat({
        cash: 500,  // Below nisab (85g * 20 = 1700)
        goldGrams: 0,
        silverGrams: 0,
        investments: 0,
        receivables: 0,
        goldPricePerGram: 20,
        silverPricePerGram: 0.5,
      });
      expect(result.nisabMet).toBe(false);
      expect(result.zakatDue).toBe(0);
    });

    it('should require zakat at nisab threshold', () => {
      const result = calculateZakat({
        cash: 1700,
        goldGrams: 0,
        silverGrams: 0,
        investments: 0,
        receivables: 0,
        goldPricePerGram: 20,
        silverPricePerGram: 0.5,
      });
      expect(result.nisabMet).toBe(true);
      expect(result.zakatDue).toBe(42.5);
    });

    it('should calculate correct nisab threshold at 20 KWD/g gold', () => {
      const result = calculateZakat({
        cash: 0,
        goldGrams: 100,  // Above nisab of 85g
        silverGrams: 0,
        investments: 0,
        receivables: 0,
        goldPricePerGram: 20,
        silverPricePerGram: 0.5,
      });
      expect(result.nisabMet).toBe(true);
      expect(result.zakatDue).toBe(50); // 100g * 20 * 2.5% = 50
    });
  });

  describe('Gold Calculation', () => {
    it('should calculate zakat on 100g gold at 20 KWD/g', () => {
      const result = calculateZakat({
        cash: 0,
        goldGrams: 100,
        silverGrams: 0,
        investments: 0,
        receivables: 0,
        goldPricePerGram: 20,
        silverPricePerGram: 0.5,
      });
      expect(result.breakdown.gold).toBe(50); // 100 * 20 * 2.5%
    });

    it('should calculate zakat on 200g gold at 25 KWD/g', () => {
      const result = calculateZakat({
        cash: 0,
        goldGrams: 200,
        silverGrams: 0,
        investments: 0,
        receivables: 0,
        goldPricePerGram: 25,
        silverPricePerGram: 0.5,
      });
      expect(result.breakdown.gold).toBe(125); // 200 * 25 * 2.5%
    });

    it('should not require zakat on 50g gold (below nisab)', () => {
      const result = calculateZakat({
        cash: 0,
        goldGrams: 50,
        silverGrams: 0,
        investments: 0,
        receivables: 0,
        goldPricePerGram: 20,
        silverPricePerGram: 0.5,
      });
      expect(result.nisabMet).toBe(false);
      expect(result.zakatDue).toBe(0);
    });
  });

  describe('Silver Calculation', () => {
    it('should calculate zakat on 600g silver', () => {
      const result = calculateZakat({
        cash: 10000,
        goldGrams: 0,
        silverGrams: 600,
        investments: 0,
        receivables: 0,
        goldPricePerGram: 20,
        silverPricePerGram: 0.5,
      });
      expect(result.breakdown.silver).toBe(7.5); // 600 * 0.5 * 2.5%
    });
  });

  describe('Mixed Assets', () => {
    it('should calculate zakat on mixed assets correctly', () => {
      const result = calculateZakat({
        cash: 5000,
        goldGrams: 50,
        silverGrams: 200,
        investments: 10000,
        receivables: 2000,
        goldPricePerGram: 20,
        silverPricePerGram: 0.5,
      });
      // Total: 5000 + 1000 + 100 + 10000 + 2000 = 18100
      expect(result.nisabMet).toBe(true);
      expect(result.zakatDue).toBe(452.5); // 18100 * 2.5%
    });

    it('should provide correct breakdown', () => {
      const result = calculateZakat({
        cash: 10000,
        goldGrams: 100,
        silverGrams: 0,
        investments: 5000,
        receivables: 3000,
        goldPricePerGram: 20,
        silverPricePerGram: 0.5,
      });
      expect(result.breakdown.cash).toBe(250);
      expect(result.breakdown.gold).toBe(50);
      expect(result.breakdown.investments).toBe(125);
      expect(result.breakdown.receivables).toBe(75);
    });
  });

  describe('Hawl (Lunar Year)', () => {
    it('should report hawl complete after 354 days', () => {
      const ownershipDate = new Date('2023-01-01');
      const currentDate = new Date('2024-01-15'); // > 354 days
      const result = calculateHawl(ownershipDate, currentDate);
      expect(result.hawlComplete).toBe(true);
    });

    it('should report hawl incomplete before 354 days', () => {
      const ownershipDate = new Date('2024-01-01');
      const currentDate = new Date('2024-06-01'); // < 354 days
      const result = calculateHawl(ownershipDate, currentDate);
      expect(result.hawlComplete).toBe(false);
      expect(result.daysRemaining).toBeGreaterThan(0);
    });

    it('should calculate correct days remaining', () => {
      const ownershipDate = new Date('2024-01-01');
      const currentDate = new Date('2024-02-01'); // ~31 days
      const result = calculateHawl(ownershipDate, currentDate);
      expect(result.daysElapsed).toBe(31);
      expect(result.daysRemaining).toBe(323);
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero assets', () => {
      const result = calculateZakat({
        cash: 0,
        goldGrams: 0,
        silverGrams: 0,
        investments: 0,
        receivables: 0,
        goldPricePerGram: 20,
        silverPricePerGram: 0.5,
      });
      expect(result.zakatDue).toBe(0);
      expect(result.nisabMet).toBe(false);
    });

    it('should handle very large amounts', () => {
      const result = calculateZakat({
        cash: 1000000,
        goldGrams: 1000,
        silverGrams: 0,
        investments: 500000,
        receivables: 100000,
        goldPricePerGram: 20,
        silverPricePerGram: 0.5,
      });
      expect(result.nisabMet).toBe(true);
      // Total wealth: 1M + 20K + 500K + 100K = 1,620,000
      expect(result.zakatDue).toBe(40500); // 1,620,000 * 2.5%
    });

    it('should round to 2 decimal places', () => {
      const result = calculateZakat({
        cash: 9999.99,
        goldGrams: 0,
        silverGrams: 0,
        investments: 0,
        receivables: 0,
        goldPricePerGram: 20,
        silverPricePerGram: 0.5,
      });
      expect(result.zakatDue).toBe(250); // 9999.99 * 2.5% ≈ 250
    });
  });
});
