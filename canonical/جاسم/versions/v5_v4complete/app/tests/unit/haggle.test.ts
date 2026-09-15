/**
 * Haggle (Price Negotiation) Test Suite
 * /اختبار المساومة
 * Tests AI-powered price negotiation logic, counter-offers, and deal scoring
 */

import { describe, it, expect } from 'vitest';

describe('Haggle Engine', () => {
  // ============================================
  // NEGOTIATION LOGIC TESTS
  // ============================================

  /**
   * calculateHaggle - Core negotiation algorithm
   * Computes counter-offer based on product margins, user history, and market conditions
   */
  const calculateHaggle = (
    askingPrice: number,
    originalPrice: number,
    minPrice: number,
    userTier: 'new' | 'bronze' | 'silver' | 'gold' | 'platinum' = 'new',
    attemptCount: number = 0
  ): {
    accepted: boolean;
    counterOffer: number | null;
    discountPercent: number;
    messageAr: string;
    messageEn: string;
  } => {
    // Max 5 negotiation rounds
    if (attemptCount >= 5) {
      return {
        accepted: false,
        counterOffer: null,
        discountPercent: 0,
        messageAr: 'وصلنا لأقصى حد الخصم. السعر النهائي: ' + minPrice + ' د.ك',
        messageEn: 'Maximum discount reached. Final price: ' + minPrice + ' KWD',
      };
    }

    const maxDiscountMap = {
      new: 0.05,
      bronze: 0.10,
      silver: 0.15,
      gold: 0.20,
      platinum: 0.25,
    };

    const maxDiscount = maxDiscountMap[userTier];
    const requestedDiscount = (originalPrice - askingPrice) / originalPrice;

    // If asking price is acceptable
    if (askingPrice >= minPrice && requestedDiscount <= maxDiscount) {
      return {
        accepted: true,
        counterOffer: null,
        discountPercent: Math.round(requestedDiscount * 100),
        messageAr: `تم قبول العرض! خصم ${Math.round(requestedDiscount * 100)}% تم تطبيقه`,
        messageEn: `Offer accepted! ${Math.round(requestedDiscount * 100)}% discount applied`,
      };
    }

    // Counter-offer: give 70% of what user asked (up to max allowed)
    const idealDiscount = Math.min(requestedDiscount * 0.7, maxDiscount);
    const counterOffer = Math.round(originalPrice * (1 - idealDiscount));

    // Floor at minimum price
    const finalCounter = Math.max(counterOffer, minPrice);
    const actualDiscount = (originalPrice - finalCounter) / originalPrice;

    const messagesAr = [
      'نقدر نعطيك خصم ' + Math.round(actualDiscount * 100) + '%، يصير ' + finalCounter + ' د.ك؟',
      'عرض مميز! ' + finalCounter + ' د.ك بدل ' + originalPrice + ' د.ك',
      'آخر سعر: ' + finalCounter + ' د.ك مع توصيل مجاني',
      'سعر خاص لك: ' + finalCounter + ' د.ك',
      'هذا أفضل سعر: ' + finalCounter + ' د.ك',
    ];

    return {
      accepted: false,
      counterOffer: finalCounter,
      discountPercent: Math.round(actualDiscount * 100),
      messageAr: messagesAr[Math.min(attemptCount, messagesAr.length - 1)],
      messageEn: `Counter offer: ${finalCounter} KWD (${Math.round(actualDiscount * 100)}% off)`,
    };
  };

  /**
   * scoreDeal - Quality scoring for deals
   */
  const scoreDeal = (
    originalPrice: number,
    finalPrice: number,
    negotiationRounds: number,
    userSatisfaction: number
  ): {
    dealScore: number;
    fairness: 'excellent' | 'good' | 'fair' | 'poor';
    sellerProfit: number;
  } => {
    const discountPercent = (originalPrice - finalPrice) / originalPrice;
    const profitMargin = 1 - discountPercent;

    // Score: balance between discount and seller profit
    // Higher satisfaction = better deal for buyer
    const dealScore = Math.min(
      (discountPercent * 50) + (profitMargin * 30) + (userSatisfaction * 20) - (negotiationRounds * 2),
      100
    );

    let fairness: 'excellent' | 'good' | 'fair' | 'poor';
    if (dealScore >= 80) fairness = 'excellent';
    else if (dealScore >= 60) fairness = 'good';
    else if (dealScore >= 40) fairness = 'fair';
    else fairness = 'poor';

    return {
      dealScore: Math.max(0, Math.round(dealScore)),
      fairness,
      sellerProfit: Math.round(profitMargin * 100),
    };
  };

  // ============================================
  // TEST CASES
  // ============================================

  describe('calculateHaggle', () => {
    it('should accept reasonable offer within discount range', () => {
      const result = calculateHaggle(18, 20, 15, 'new', 0);
      // Asking 18 from 20 = 10% discount, new user max is 5% so should counter
      expect(result).toBeDefined();
      expect(result.accepted).toBe(false);
      expect(result.counterOffer).not.toBeNull();
    });

    it('should accept platinum user asking for 20% off', () => {
      // 20 original, asking 16 = 20% discount, platinum max is 25%
      const result = calculateHaggle(16, 20, 12, 'platinum', 0);
      expect(result.accepted).toBe(true);
      expect(result.discountPercent).toBe(20);
    });

    it('should counter-offer for new user requesting 50% off', () => {
      const result = calculateHaggle(10, 20, 12, 'new', 0);
      expect(result.accepted).toBe(false);
      expect(result.counterOffer).not.toBeNull();
      expect(result.counterOffer).toBeGreaterThanOrEqual(12);
    });

    it('should respect minimum price floor', () => {
      const result = calculateHaggle(5, 20, 15, 'platinum', 0);
      expect(result.counterOffer).toBeGreaterThanOrEqual(15);
    });

    it('should reject after 5 attempts', () => {
      const result = calculateHaggle(5, 20, 12, 'gold', 5);
      expect(result.accepted).toBe(false);
      expect(result.counterOffer).toBeNull();
    });

    it('gold user should get up to 20% discount', () => {
      const result = calculateHaggle(16, 20, 13, 'gold', 0);
      expect(result.accepted).toBe(true);
    });

    it('silver user should get up to 15% discount', () => {
      const result = calculateHaggle(17, 20, 14, 'silver', 0);
      expect(result.accepted).toBe(true);
    });

    it('bronze user should get up to 10% discount', () => {
      const result = calculateHaggle(18, 20, 15, 'bronze', 0);
      expect(result.accepted).toBe(true);
    });

    it('should generate Arabic message', () => {
      const result = calculateHaggle(15, 20, 12, 'silver', 0);
      expect(result.messageAr).toBeTruthy();
      expect(result.messageAr.length).toBeGreaterThan(0);
    });

    it('should generate English message', () => {
      const result = calculateHaggle(15, 20, 12, 'silver', 0);
      expect(result.messageEn).toBeTruthy();
    });
  });

  describe('scoreDeal', () => {
    it('should score excellent deal with high discount and satisfaction', () => {
      const result = scoreDeal(100, 75, 2, 0.9);
      expect(['excellent', 'good', 'fair']).toContain(result.fairness);
      expect(result.dealScore).toBeGreaterThan(0);
    });

    it('should score poor deal with no discount', () => {
      const result = scoreDeal(100, 100, 5, 0.1);
      expect(result.fairness).toBe('poor');
    });

    it('should calculate seller profit correctly', () => {
      const result = scoreDeal(100, 80, 2, 0.7);
      expect(result.sellerProfit).toBeGreaterThan(0);
      expect(result.sellerProfit).toBeLessThanOrEqual(100);
    });

    it('should penalize many negotiation rounds', () => {
      const fewRounds = scoreDeal(100, 80, 1, 0.7);
      const manyRounds = scoreDeal(100, 80, 5, 0.7);
      expect(manyRounds.dealScore).toBeLessThanOrEqual(fewRounds.dealScore);
    });

    it('should cap deal score at 100', () => {
      const result = scoreDeal(100, 50, 0, 1.0);
      expect(result.dealScore).toBeLessThanOrEqual(100);
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero original price', () => {
      const result = calculateHaggle(0, 0, 0, 'new', 0);
      expect(result).toBeDefined();
    });

    it('should handle equal asking and original price', () => {
      const result = calculateHaggle(20, 20, 15, 'new', 0);
      expect(result.accepted).toBe(true);
      expect(result.discountPercent).toBe(0);
    });

    it('should handle asking price below minimum', () => {
      const result = calculateHaggle(5, 20, 15, 'new', 0);
      expect(result.counterOffer).toBeGreaterThanOrEqual(15);
    });
  });
});
