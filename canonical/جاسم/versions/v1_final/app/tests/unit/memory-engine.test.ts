/**
 * Memory Engine Test Suite
 * /اختبار محرك الذاكرة
 * Tests vector-based memory storage, recall, and preference management
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the database before importing the memory engine
vi.mock('../../db/queries/connection', () => ({
  db: {
    insert: vi.fn(() => ({
      values: vi.fn(() => Promise.resolve([{ insertId: '1' }])),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve([])),
          })),
          limit: vi.fn(() => Promise.resolve([])),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve()),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve()),
    })),
  },
}));

vi.mock('../../db/schema', () => ({
  memory: {
    id: { name: 'id' },
    userId: { name: 'userId' },
    key: { name: 'key' },
    value: { name: 'value' },
    category: { name: 'category' },
    createdAt: { name: 'createdAt' },
    updatedAt: { name: 'updatedAt' },
  } as any,
}));

import {
  storeMemory,
  recallMemory,
  getPreferences,
  getRecentInteractions,
  updatePreference,
  clearExpiredMemories,
  getMemoryStats,
  storeInteraction,
  storeFeedback,
  deleteAllMemories,
} from '../../api/core/memory-engine';

describe('Memory Engine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ============================================
  // STORE MEMORY TESTS (5 tests)
  // ============================================
  describe('storeMemory', () => {
    it('should store a preference memory successfully', async () => {
      const { db } = await import('../../db/queries/connection');
      (db.insert as any).mockReturnValue({
        values: vi.fn(() => Promise.resolve([{ insertId: '123' }])),
      });

      const result = await storeMemory({
        userId: '1',
        marketCode: 'KW',
        type: 'preference',
        key: 'favorite_cuisine',
        value: 'برياني',
        confidence: 0.9,
        source: 'user',
        isPermanent: true,
      });

      expect(result).toBeDefined();
      expect(result.userId).toBe('1');
      expect(result.key).toBe('favorite_cuisine');
      expect(result.value).toBe('برياني');
    });

    it('should store interaction memory', async () => {
      const { db } = await import('../../db/queries/connection');
      (db.insert as any).mockReturnValue({
        values: vi.fn(() => Promise.resolve([{ insertId: '2' }])),
      });

      const result = await storeMemory({
        userId: '1',
        type: 'interaction',
        key: 'last_order',
        value: { orderId: '123', amount: 50 },
        confidence: 0.8,
        isPermanent: false,
      });

      expect(result.type).toBe('interaction');
      expect(result.key).toBe('last_order');
    });

    it('should store feedback memory', async () => {
      const { db } = await import('../../db/queries/connection');
      (db.insert as any).mockReturnValue({
        values: vi.fn(() => Promise.resolve([{ insertId: '3' }])),
      });

      const result = await storeMemory({
        userId: '1',
        type: 'feedback',
        key: 'rating',
        value: 5,
        confidence: 1,
        isPermanent: true,
      });

      expect(result.type).toBe('feedback');
      expect(result.confidence).toBe(1);
    });

    it('should handle complex nested values', async () => {
      const { db } = await import('../../db/queries/connection');
      (db.insert as any).mockReturnValue({
        values: vi.fn(() => Promise.resolve([{ insertId: '4' }])),
      });

      const complexValue = {
        restaurant: 'مطعم الكويت',
        items: ['برياني', 'كبسة'],
        total: 15.5,
        rating: 4.5,
      };

      const result = await storeMemory({
        userId: '1',
        type: 'context',
        key: 'order_context',
        value: complexValue,
        confidence: 0.85,
        isPermanent: false,
      });

      expect(result.value).toEqual(complexValue);
    });

    it('should throw on invalid input', async () => {
      await expect(
        storeMemory({
          userId: '',
          type: 'invalid' as any,
          key: '',
          value: null,
          confidence: -1,
        })
      ).rejects.toThrow();
    });
  });

  // ============================================
  // RECALL MEMORY TESTS (4 tests)
  // ============================================
  describe('recallMemory', () => {
    it('should recall memories by user ID', async () => {
      const { db } = await import('../../db/queries/connection');
      const mockRows = [
        { id: 1, userId: 1, key: 'favorite_cuisine', value: '"برياني"', category: 'preference', createdAt: new Date() },
        { id: 2, userId: 1, key: 'last_order', value: '{"amount": 50}', category: 'interaction', createdAt: new Date() },
      ];
      (db.select as any).mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            orderBy: vi.fn(() => ({
              limit: vi.fn(() => Promise.resolve(mockRows)),
            })),
          })),
        })),
      });

      const results = await recallMemory('1', 'favorite');
      expect(results).toBeDefined();
      expect(results.length).toBe(2);
    });

    it('should handle empty results', async () => {
      const { db } = await import('../../db/queries/connection');
      (db.select as any).mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            orderBy: vi.fn(() => ({
              limit: vi.fn(() => Promise.resolve([])),
            })),
          })),
        })),
      });

      const results = await recallMemory('999', 'nonexistent');
      expect(results).toEqual([]);
    });

    it('should respect limit parameter', async () => {
      const { db } = await import('../../db/queries/connection');
      const mockRows = Array.from({ length: 20 }, (_, i) => ({
        id: i, userId: 1, key: `key_${i}`, value: `"value_${i}"`, category: 'interaction', createdAt: new Date(),
      }));
      (db.select as any).mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            orderBy: vi.fn(() => ({
              limit: vi.fn((lim: number) => Promise.resolve(mockRows.slice(0, lim))),
            })),
          })),
        })),
      });

      const results = await recallMemory('1', 'test', undefined, 5);
      expect(results.length).toBeLessThanOrEqual(5);
    });

    it('should parse JSON values', async () => {
      const { db } = await import('../../db/queries/connection');
      const mockRows = [
        { id: 1, userId: 1, key: 'settings', value: '{"theme": "dark", "lang": "ar"}', category: 'preference', createdAt: new Date() },
      ];
      (db.select as any).mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            orderBy: vi.fn(() => ({
              limit: vi.fn(() => Promise.resolve(mockRows)),
            })),
          })),
        })),
      });

      const results = await recallMemory('1', 'settings');
      expect(results[0].value).toEqual({ theme: 'dark', lang: 'ar' });
    });
  });

  // ============================================
  // PREFERENCES TESTS (3 tests)
  // ============================================
  describe('getPreferences', () => {
    it('should return merged preferences', async () => {
      const { db } = await import('../../db/queries/connection');
      const mockRows = [
        { id: 1, userId: 1, key: 'theme', value: '"dark"', category: 'preference', createdAt: new Date() },
        { id: 2, userId: 1, key: 'language', value: '"ar"', category: 'preference', createdAt: new Date() },
      ];
      (db.select as any).mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            orderBy: vi.fn(() => Promise.resolve(mockRows)),
          })),
        })),
      });

      const prefs = await getPreferences('1');
      expect(prefs).toHaveProperty('theme', 'dark');
      expect(prefs).toHaveProperty('language', 'ar');
    });

    it('should return empty object on error', async () => {
      const { db } = await import('../../db/queries/connection');
      (db.select as any).mockImplementation(() => {
        throw new Error('DB error');
      });

      const prefs = await getPreferences('1');
      expect(prefs).toEqual({});
    });

    it('should parse JSON preference values', async () => {
      const { db } = await import('../../db/queries/connection');
      const mockRows = [
        { id: 1, userId: 1, key: 'favorites', value: '["برياني", "كبسة"]', category: 'preference', createdAt: new Date() },
      ];
      (db.select as any).mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            orderBy: vi.fn(() => Promise.resolve(mockRows)),
          })),
        })),
      });

      const prefs = await getPreferences('1');
      expect(prefs).toHaveProperty('favorites', ['برياني', 'كبسة']);
    });
  });

  // ============================================
  // CONVENIENCE WRAPPER TESTS (5 tests)
  // ============================================
  describe('Convenience Wrappers', () => {
    it('storeInteraction wraps storeMemory correctly', async () => {
      const { db } = await import('../../db/queries/connection');
      (db.insert as any).mockReturnValue({
        values: vi.fn(() => Promise.resolve([{ insertId: '5' }])),
      });

      const result = await storeInteraction('1', 'click_event', { button: 'order' });
      expect(result.type).toBe('interaction');
      expect(result.source).toBe('conversation');
    });

    it('storeFeedback wraps storeMemory correctly', async () => {
      const { db } = await import('../../db/queries/connection');
      (db.insert as any).mockReturnValue({
        values: vi.fn(() => Promise.resolve([{ insertId: '6' }])),
      });

      const result = await storeFeedback('1', 'app_rating', 5);
      expect(result.type).toBe('feedback');
      expect(result.confidence).toBe(1);
    });

    it('should handle memory stats', async () => {
      const { db } = await import('../../db/queries/connection');
      const mockRows = [
        { id: 1, userId: 1, key: 'pref1', value: '"v1"', category: 'preference' },
        { id: 2, userId: 1, key: 'int1', value: '"v2"', category: 'interaction' },
        { id: 3, userId: 1, key: 'ctx1', value: '"v3"', category: 'context' },
      ];
      (db.select as any).mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve(mockRows)),
        })),
      });

      const stats = await getMemoryStats('1');
      expect(stats.total).toBe(3);
      expect(stats.preferences).toBe(1);
      expect(stats.interactions).toBe(1);
      expect(stats.contexts).toBe(1);
    });

    it('updatePreference updates existing preference', async () => {
      const { db } = await import('../../db/queries/connection');
      (db.select as any).mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve([{ id: 1, key: 'theme', value: '"light"', category: 'preference' }])),
          })),
        })),
      });
      (db.update as any).mockReturnValue({
        set: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve()),
        })),
      });

      await updatePreference('1', 'theme', 'dark');
      expect(db.update).toHaveBeenCalled();
    });

    it('deleteAllMemories handles GDPR delete', async () => {
      const { db } = await import('../../db/queries/connection');
      (db.delete as any).mockReturnValue({
        where: vi.fn(() => Promise.resolve()),
      });

      await deleteAllMemories('1');
      expect(db.delete).toHaveBeenCalled();
    });
  });

  // ============================================
  // CLEAR EXPIRED TESTS (2 tests)
  // ============================================
  describe('clearExpiredMemories', () => {
    it('should clear old interactions', async () => {
      const { db } = await import('../../db/queries/connection');
      (db.delete as any).mockReturnValue({
        where: vi.fn(() => Promise.resolve()),
      });

      await clearExpiredMemories();
      expect(db.delete).toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      const { db } = await import('../../db/queries/connection');
      (db.delete as any).mockImplementation(() => {
        throw new Error('Delete error');
      });

      await expect(clearExpiredMemories()).rejects.toThrow();
    });
  });
});
