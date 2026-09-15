/**
 * DNA Breeder (Genetic Algorithm) Test Suite
 * /اختبار مربي الحمض النووي
 * Tests genetic breeding for AI model optimization
 */

import { describe, it, expect } from 'vitest';

describe('DNA Breeder - Genetic Algorithm', () => {
  // ============================================
  // GENE DEFINITIONS
  // ============================================
  interface Gene {
    id: string;
    trait: string;
    value: number;
    dominance: number; // 0-1, higher = more dominant
    mutationRate: number;
  }

  interface Genome {
    id: string;
    genes: Gene[];
    fitness: number;
    generation: number;
  }

  /**
   * breedGenomes - Genetic breeding algorithm
   */
  const breedGenomes = (parent1: Genome, parent2: Genome, mutationChance: number = 0.05): Genome => {
    const childGenes: Gene[] = [];

    for (let i = 0; i < Math.max(parent1.genes.length, parent2.genes.length); i++) {
      const g1 = parent1.genes[i];
      const g2 = parent2.genes[i];

      if (!g1 && g2) { childGenes.push({ ...g2 }); continue; }
      if (!g2 && g1) { childGenes.push({ ...g1 }); continue; }
      if (!g1 && !g2) continue;

      // Select based on dominance
      const selected = g1.dominance >= g2.dominance ? g1 : g2;

      // Apply mutation
      const shouldMutate = Math.random() < mutationChance;
      const mutatedValue = shouldMutate
        ? selected.value + (Math.random() - 0.5) * 0.2
        : selected.value;

      childGenes.push({
        ...selected,
        id: `${selected.id}_child_${Date.now()}`,
        value: Math.max(0, Math.min(1, mutatedValue)),
      });
    }

    // Calculate fitness as average of parents + bonus for diversity
    const diversityBonus = Math.abs(parent1.fitness - parent2.fitness) * 0.1;
    const childFitness = Math.max(0, Math.min(1, ((parent1.fitness + parent2.fitness) / 2) + diversityBonus));

    return {
      id: `genome_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      genes: childGenes,
      fitness: Math.round(childFitness * 1000) / 1000,
      generation: Math.max(parent1.generation, parent2.generation) + 1,
    };
  };

  /**
   * selectFittest - Tournament selection
   */
  const selectFittest = (population: Genome[], tournamentSize: number = 3): Genome => {
    const shuffled = [...population].sort(() => Math.random() - 0.5);
    const tournament = shuffled.slice(0, tournamentSize);
    return tournament.reduce((best, current) => current.fitness > best.fitness ? current : best);
  };

  /**
   * calculateDiversity - Population diversity score
   */
  const calculateDiversity = (population: Genome[]): number => {
    if (population.length < 2) return 0;

    let totalDiff = 0;
    let comparisons = 0;

    for (let i = 0; i < Math.min(population.length, 50); i++) {
      for (let j = i + 1; j < Math.min(population.length, 50); j++) {
        const fitnessDiff = Math.abs(population[i].fitness - population[j].fitness);
        totalDiff += fitnessDiff;
        comparisons++;
      }
    }

    return comparisons > 0 ? Math.round((totalDiff / comparisons) * 100) / 100 : 0;
  };

  // ============================================
  // HELPER: Create test genomes
  // ============================================
  const createGenome = (id: string, fitness: number, generation: number = 1): Genome => ({
    id,
    genes: [
      { id: 'learning_rate', trait: 'learning', value: 0.01, dominance: 0.7, mutationRate: 0.1 },
      { id: 'batch_size', trait: 'performance', value: 0.5, dominance: 0.5, mutationRate: 0.05 },
      { id: 'dropout_rate', trait: 'regularization', value: 0.3, dominance: 0.8, mutationRate: 0.15 },
      { id: 'attention_heads', trait: 'architecture', value: 0.7, dominance: 0.6, mutationRate: 0.08 },
    ],
    fitness,
    generation,
  });

  // ============================================
  // BREEDING TESTS
  // ============================================

  describe('Genome Breeding', () => {
    it('should create child with genes from both parents', () => {
      const parent1 = createGenome('p1', 0.8);
      const parent2 = createGenome('p2', 0.6);
      const child = breedGenomes(parent1, parent2, 0);

      expect(child.genes.length).toBe(parent1.genes.length);
      expect(child.generation).toBe(2);
    });

    it('should select dominant gene from parents', () => {
      const parent1 = createGenome('p1', 0.9);
      parent1.genes[0] = { ...parent1.genes[0], dominance: 0.9, value: 0.8 };

      const parent2 = createGenome('p2', 0.5);
      parent2.genes[0] = { ...parent2.genes[0], dominance: 0.3, value: 0.2 };

      const child = breedGenomes(parent1, parent2, 0);
      expect(child.genes[0].value).toBe(0.8);
    });

    it('should calculate child fitness as average of parents', () => {
      const parent1 = createGenome('p1', 0.8);
      const parent2 = createGenome('p2', 0.6);
      const child = breedGenomes(parent1, parent2, 0);

      expect(child.fitness).toBeCloseTo(0.7, 1);
    });

    it('should cap fitness at 1.0', () => {
      const parent1 = createGenome('p1', 0.99);
      const parent2 = createGenome('p2', 0.98);
      const child = breedGenomes(parent1, parent2, 0);

      expect(child.fitness).toBeLessThanOrEqual(1.0);
    });

    it('should increment generation', () => {
      const parent1 = createGenome('p1', 0.8, 5);
      const parent2 = createGenome('p2', 0.7, 3);
      const child = breedGenomes(parent1, parent2, 0);

      expect(child.generation).toBe(6);
    });

    it('should generate unique child ID', () => {
      const parent1 = createGenome('p1', 0.8);
      const parent2 = createGenome('p2', 0.7);
      const child1 = breedGenomes(parent1, parent2, 0);
      const child2 = breedGenomes(parent1, parent2, 0);

      expect(child1.id).not.toBe(child2.id);
    });
  });

  describe('Mutation', () => {
    it('should mutate with 100% chance when set', () => {
      const parent1 = createGenome('p1', 0.8);
      const parent2 = createGenome('p2', 0.7);

      // Multiple runs to account for randomness
      let mutatedCount = 0;
      for (let i = 0; i < 20; i++) {
        const child = breedGenomes(parent1, parent2, 1.0);
        const hasMutation = child.genes.some((g, idx) =>
          g.value !== parent1.genes[idx]?.value && g.value !== parent2.genes[idx]?.value
        );
        if (hasMutation) mutatedCount++;
      }
      expect(mutatedCount).toBeGreaterThan(10);
    });

    it('should not mutate when chance is 0', () => {
      const parent1 = createGenome('p1', 0.8);
      const parent2 = createGenome('p2', 0.7);
      const child = breedGenomes(parent1, parent2, 0);

      // All values should come from one of the parents
      child.genes.forEach((g, i) => {
        const p1Val = parent1.genes[i].value;
        const p2Val = parent2.genes[i].value;
        expect([p1Val, p2Val]).toContain(g.value);
      });
    });

    it('should keep gene values between 0 and 1', () => {
      const parent1 = createGenome('p1', 0.5);
      const parent2 = createGenome('p2', 0.5);

      for (let i = 0; i < 50; i++) {
        const child = breedGenomes(parent1, parent2, 1.0);
        child.genes.forEach(g => {
          expect(g.value).toBeGreaterThanOrEqual(0);
          expect(g.value).toBeLessThanOrEqual(1);
        });
      }
    });
  });

  describe('Tournament Selection', () => {
    it('should select fittest from tournament', () => {
      const population = [
        createGenome('g1', 0.3),
        createGenome('g2', 0.7),
        createGenome('g3', 0.9),
        createGenome('g4', 0.5),
        createGenome('g5', 0.1),
      ];

      // With tournament size covering all, should always get fittest
      const winner = selectFittest(population, 5);
      expect(winner.fitness).toBe(0.9);
    });

    it('should return a genome from population', () => {
      const population = [createGenome('g1', 0.5), createGenome('g2', 0.6)];
      const winner = selectFittest(population, 2);
      expect(population.some(g => g.id === winner.id)).toBe(true);
    });
  });

  describe('Diversity Calculation', () => {
    it('should return 0 for single genome', () => {
      expect(calculateDiversity([createGenome('g1', 0.5)])).toBe(0);
    });

    it('should calculate diversity for uniform population', () => {
      const pop = Array.from({ length: 5 }, () => createGenome(`g`, 0.5));
      pop.forEach((g, i) => { g.id = `g${i}`; });
      const diversity = calculateDiversity(pop);
      expect(diversity).toBe(0);
    });

    it('should calculate diversity for diverse population', () => {
      const pop = [
        createGenome('g1', 0.1),
        createGenome('g2', 0.5),
        createGenome('g3', 0.9),
      ];
      const diversity = calculateDiversity(pop);
      expect(diversity).toBeGreaterThan(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle genomes with different gene counts', () => {
      const p1 = createGenome('p1', 0.8);
      const p2 = createGenome('p2', 0.7);
      p2.genes = p2.genes.slice(0, 2); // Remove some genes

      const child = breedGenomes(p1, p2, 0);
      expect(child.genes.length).toBe(p1.genes.length);
    });

    it('should handle empty gene arrays', () => {
      const p1 = { ...createGenome('p1', 0.8), genes: [] };
      const p2 = { ...createGenome('p2', 0.7), genes: [] };
      const child = breedGenomes(p1, p2, 0);
      expect(child.genes.length).toBe(0);
      expect(child.fitness).toBeGreaterThan(0);
    });

    it('should handle fitness of 0', () => {
      const p1 = createGenome('p1', 0);
      const p2 = createGenome('p2', 0);
      const child = breedGenomes(p1, p2, 0);
      expect(child.fitness).toBe(0);
    });
  });
});
