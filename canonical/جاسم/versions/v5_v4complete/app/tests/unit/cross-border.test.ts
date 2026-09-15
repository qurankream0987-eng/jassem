/**
 * Cross-Border Customs Calculation Test Suite
 * /اختبار حساب الجمارك العابرة للحدود
 * Tests customs duties, VAT, and shipping cost calculations for Gulf markets
 */

import { describe, it, expect } from 'vitest';

describe('Cross-Border Calculator', () => {
  // ============================================
  // GULF COUNTRY TAX RATES (2024)
  // ============================================
  const TAX_RATES: Record<string, { vat: number; customs: number; nameAr: string }> = {
    KW: { vat: 0, customs: 0.05, nameAr: 'الكويت' },
    SA: { vat: 0.15, customs: 0.05, nameAr: 'السعودية' },
    AE: { vat: 0.05, customs: 0.05, nameAr: 'الإمارات' },
    QA: { vat: 0, customs: 0.05, nameAr: 'قطر' },
    BH: { vat: 0.10, customs: 0.05, nameAr: 'البحرين' },
    OM: { vat: 0.05, customs: 0.05, nameAr: 'عمان' },
  };

  /**
   * calculateCustoms - Full customs calculation
   * حساب الجمارك الكامل
   */
  const calculateCustoms = (
    itemValue: number,
    shippingCost: number,
    insuranceCost: number,
    originCountry: string,
    destinationCountry: string,
    itemCategory: string = 'general'
  ): {
    cifValue: number;
    customsDuty: number;
    vatAmount: number;
    totalTax: number;
    totalCost: number;
    categoryExemptions: string[];
    originAr: string;
    destinationAr: string;
  } => {
    const dest = TAX_RATES[destinationCountry] || TAX_RATES.KW;
    const cifValue = itemValue + shippingCost + insuranceCost;

    // Category exemptions (free from customs)
    const exemptCategories = ['books', 'medicine', 'baby_food', 'educational'];
    const isExempt = exemptCategories.includes(itemCategory);

    const customsRate = isExempt ? 0 : dest.customs;
    const customsDuty = Math.round(cifValue * customsRate * 100) / 100;
    const vatBase = cifValue + customsDuty; // VAT on CIF + customs
    const vatAmount = Math.round(vatBase * dest.vat * 100) / 100;

    const totalTax = customsDuty + vatAmount;
    const totalCost = cifValue + totalTax;

    const countryNamesAr: Record<string, string> = {
      KW: 'الكويت', SA: 'السعودية', AE: 'الإمارات',
      QA: 'قطر', BH: 'البحرين', OM: 'عمان',
      US: 'أمريكا', CN: 'الصين', IN: 'الهند',
      TR: 'تركيا', DE: 'ألمانيا', JP: 'اليابان',
    };

    return {
      cifValue: Math.round(cifValue * 100) / 100,
      customsDuty,
      vatAmount,
      totalTax: Math.round(totalTax * 100) / 100,
      totalCost: Math.round(totalCost * 100) / 100,
      categoryExemptions: exemptCategories,
      originAr: countryNamesAr[originCountry] || originCountry,
      destinationAr: countryNamesAr[destinationCountry] || destinationCountry,
    };
  };

  /**
   * estimateShipping - Shipping cost estimator
   */
  const estimateShipping = (
    weightKg: number,
    origin: string,
    destination: string,
    speed: 'economy' | 'standard' | 'express' = 'standard'
  ): {
    cost: number;
    days: number;
    carrier: string;
  } => {
    const speedMultipliers = { economy: 0.7, standard: 1.0, express: 1.8 };
    const baseRate = 2.5; // KWD per kg
    const regional = ['KW', 'SA', 'AE', 'QA', 'BH', 'OM'];

    const isRegional = regional.includes(origin) && regional.includes(destination);
    const regionalMultiplier = isRegional ? 0.6 : 1.0;

    const cost = Math.round(baseRate * weightKg * speedMultipliers[speed] * regionalMultiplier * 100) / 100;

    const daysMap: Record<string, Record<string, number>> = {
      regional: { economy: 5, standard: 3, express: 1 },
      international: { economy: 14, standard: 7, express: 3 },
    };
    const days = daysMap[isRegional ? 'regional' : 'international'][speed];

    const carriers = ['Aramex', 'DHL', 'FedEx', 'UPS'];
    const carrier = isRegional ? 'Aramex' : carriers[Math.floor(Math.random() * carriers.length)];

    return { cost, days, carrier };
  };

  // ============================================
  // CUSTOMS DUTY TESTS
  // ============================================

  describe('Customs Duty Calculation', () => {
    it('should calculate 5% customs on 100 KWD item to Kuwait', () => {
      const result = calculateCustoms(100, 10, 5, 'CN', 'KW');
      expect(result.cifValue).toBe(115);
      expect(result.customsDuty).toBe(5.75); // 115 * 5%
    });

    it('should calculate 5% customs on 500 KWD item to Saudi', () => {
      const result = calculateCustoms(500, 25, 15, 'US', 'SA');
      expect(result.cifValue).toBe(540);
      expect(result.customsDuty).toBe(27); // 540 * 5%
    });

    it('should calculate 5% customs on 1000 KWD item to UAE', () => {
      const result = calculateCustoms(1000, 50, 25, 'CN', 'AE');
      expect(result.cifValue).toBe(1075);
      expect(result.customsDuty).toBe(53.75);
    });

    it('should calculate 5% customs on 10000 KWD item to Bahrain', () => {
      const result = calculateCustoms(10000, 200, 150, 'DE', 'BH');
      expect(result.cifValue).toBe(10350);
      expect(result.customsDuty).toBe(517.5);
    });
  });

  describe('VAT Calculation', () => {
    it('should calculate 15% VAT for Saudi Arabia', () => {
      const result = calculateCustoms(100, 10, 5, 'CN', 'SA');
      // CIF = 115, customs = 5.75, VAT base = 120.75, VAT = 18.11
      expect(result.vatAmount).toBeCloseTo(18.11, 1);
    });

    it('should calculate 0% VAT for Kuwait', () => {
      const result = calculateCustoms(100, 10, 5, 'US', 'KW');
      expect(result.vatAmount).toBe(0);
    });

    it('should calculate 5% VAT for UAE', () => {
      const result = calculateCustoms(200, 15, 10, 'CN', 'AE');
      // CIF = 225, customs = 11.25, VAT base = 236.25, VAT = 11.81
      expect(result.vatAmount).toBeCloseTo(11.81, 1);
    });

    it('should calculate 10% VAT for Bahrain', () => {
      const result = calculateCustoms(500, 30, 20, 'IN', 'BH');
      // CIF = 550, customs = 27.5, VAT base = 577.5, VAT = 57.75
      expect(result.vatAmount).toBeCloseTo(57.75, 1);
    });

    it('should calculate 0% VAT for Qatar', () => {
      const result = calculateCustoms(1000, 50, 30, 'US', 'QA');
      expect(result.vatAmount).toBe(0);
    });

    it('should calculate 5% VAT for Oman', () => {
      const result = calculateCustoms(300, 20, 10, 'CN', 'OM');
      // CIF = 330, customs = 16.5, VAT base = 346.5, VAT = 17.33
      expect(result.vatAmount).toBeCloseTo(17.33, 1);
    });
  });

  describe('CIF Value Calculation', () => {
    it('should calculate correct CIF = item + shipping + insurance', () => {
      const result = calculateCustoms(500, 25, 15, 'CN', 'KW');
      expect(result.cifValue).toBe(540);
    });

    it('should calculate correct CIF for large shipment', () => {
      const result = calculateCustoms(50000, 1000, 500, 'US', 'SA');
      expect(result.cifValue).toBe(51500);
    });
  });

  describe('Category Exemptions', () => {
    it('should exempt books from customs', () => {
      const result = calculateCustoms(100, 10, 5, 'US', 'SA', 'books');
      expect(result.customsDuty).toBe(0);
    });

    it('should exempt medicine from customs', () => {
      const result = calculateCustoms(500, 20, 10, 'DE', 'KW', 'medicine');
      expect(result.customsDuty).toBe(0);
    });

    it('should exempt baby food from customs', () => {
      const result = calculateCustoms(200, 15, 8, 'US', 'AE', 'baby_food');
      expect(result.customsDuty).toBe(0);
    });

    it('should NOT exempt electronics from customs', () => {
      const result = calculateCustoms(1000, 50, 25, 'CN', 'KW', 'electronics');
      expect(result.customsDuty).toBeGreaterThan(0);
    });
  });

  describe('Total Cost Calculation', () => {
    it('should calculate total cost correctly for Kuwait', () => {
      const result = calculateCustoms(100, 10, 5, 'CN', 'KW');
      // CIF = 115, customs = 5.75, VAT = 0, total = 120.75
      expect(result.totalCost).toBe(120.75);
    });

    it('should calculate total cost correctly for Saudi', () => {
      const result = calculateCustoms(100, 10, 5, 'CN', 'SA');
      // CIF = 115, customs = 5.75, VAT ~18.11, total ~138.86
      expect(result.totalCost).toBeGreaterThan(115);
    });
  });

  describe('Shipping Estimation', () => {
    it('should estimate regional shipping cheaper', () => {
      const regional = estimateShipping(5, 'KW', 'SA', 'standard');
      const international = estimateShipping(5, 'US', 'KW', 'standard');
      expect(regional.cost).toBeLessThan(international.cost);
    });

    it('should estimate express faster than economy', () => {
      const express = estimateShipping(2, 'KW', 'SA', 'express');
      const economy = estimateShipping(2, 'KW', 'SA', 'economy');
      expect(express.days).toBeLessThan(economy.days);
    });

    it('should estimate based on weight', () => {
      const light = estimateShipping(1, 'CN', 'KW', 'standard');
      const heavy = estimateShipping(10, 'CN', 'KW', 'standard');
      expect(heavy.cost).toBeGreaterThan(light.cost);
    });

    it('should return Aramex for regional shipping', () => {
      const result = estimateShipping(3, 'KW', 'AE', 'standard');
      expect(result.carrier).toBe('Aramex');
    });
  });

  describe('Arabic Country Names', () => {
    it('should return Arabic name for Kuwait', () => {
      const result = calculateCustoms(100, 10, 5, 'CN', 'KW');
      expect(result.destinationAr).toBe('الكويت');
    });

    it('should return Arabic name for China origin', () => {
      const result = calculateCustoms(100, 10, 5, 'CN', 'KW');
      expect(result.originAr).toBe('الصين');
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero value items', () => {
      const result = calculateCustoms(0, 10, 5, 'CN', 'KW');
      expect(result.cifValue).toBe(15);
      expect(result.totalCost).toBe(15.75);
    });

    it('should handle very large values', () => {
      const result = calculateCustoms(1000000, 5000, 2500, 'US', 'SA');
      expect(result.cifValue).toBe(1007500);
      expect(result.customsDuty).toBe(50375);
    });

    it('should use Kuwait rates for unknown destination', () => {
      const result = calculateCustoms(100, 10, 5, 'CN', 'XX');
      expect(result.customsDuty).toBeGreaterThan(0);
    });
  });
});
