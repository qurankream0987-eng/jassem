/**
 * ============================================
 * ADVANCED AGENT DNA SYSTEM
 * 12-Gene Genetic Framework for AI Agents
 * ============================================
 *
 * Each agent carries a 12-gene DNA that determines its capabilities.
 * Agents can be bred (crossover + mutation), evaluated for fitness,
 * and evolved over time. The DNA system enables genetic optimization
 * of the multi-agent swarm for peak performance.
 */

import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { db } from "@db/queries/connection";
import { dnaGenomes, agentLogs } from "@db/schema";
import type { AgentType } from "./types";

// ============================================
// ERROR MESSAGES (Arabic)
// ============================================
const Errors = {
  breedFailed: "فشل في تهجين الوكيلين",
  invalidDNA: "حمض نووي غير صالح",
  fitnessCalcFailed: "فشل في حساب اللياقة",
  evolutionFailed: "فشل في تطوير الحمض النووي",
  storeFailed: "فشل في تخزين الجينوم",
} as const;

// ============================================
// ZOD SCHEMAS
// ============================================

const AgentDNASchema = z.object({
  genes: z.object({
    intelligence: z.number().min(0).max(100),
    speed: z.number().min(0).max(100),
    accuracy: z.number().min(0).max(100),
    creativity: z.number().min(0).max(100),
    empathy: z.number().min(0).max(100),
    negotiation: z.number().min(0).max(100),
    memory: z.number().min(0).max(100),
    learning: z.number().min(0).max(100),
    confidence: z.number().min(0).max(100),
    safety: z.number().min(0).max(100),
    efficiency: z.number().min(0).max(100),
    collaboration: z.number().min(0).max(100),
  }),
});

const BreedInputSchema = z.object({
  parent1Id: z.string(),
  parent2Id: z.string(),
  childName: z.string().optional(),
  mutationRate: z.number().min(0).max(20).default(5),
});

const FitnessWeightsSchema = z.object({
  intelligence: z.number().default(1.0),
  speed: z.number().default(0.8),
  accuracy: z.number().default(1.2),
  creativity: z.number().default(0.7),
  empathy: z.number().default(0.9),
  negotiation: z.number().default(0.6),
  memory: z.number().default(0.8),
  learning: z.number().default(1.0),
  confidence: z.number().default(0.7),
  safety: z.number().default(1.5),
  efficiency: z.number().default(1.0),
  collaboration: z.number().default(0.9),
});

// ============================================
// TYPE DEFINITIONS
// ============================================

export interface AgentDNA {
  genes: {
    intelligence: number; // 0-100 (problem solving)
    speed: number;        // 0-100 (response time)
    accuracy: number;     // 0-100 (correctness)
    creativity: number;   // 0-100 (bubble design)
    empathy: number;      // 0-100 (user understanding)
    negotiation: number;  // 0-100 (haggle skill)
    memory: number;       // 0-100 (recall ability)
    learning: number;     // 0-100 (adaptation)
    confidence: number;   // 0-100 (decision making)
    safety: number;       // 0-100 (Islamic compliance)
    efficiency: number;   // 0-100 (token usage)
    collaboration: number;// 0-100 (A2A skill)
  };
}

export interface DNARecord {
  id: number;
  parent1Id?: number;
  parent2Id?: number;
  name: string;
  type: AgentType;
  genes: AgentDNA["genes"];
  fitness: number;
  generation: number;
  createdAt: Date;
}

export interface BreedResult {
  child: AgentDNA;
  childName: string;
  generation: number;
  inheritedFrom: Record<string, "parent1" | "parent2">;
  mutations: Array<{ gene: string; oldValue: number; newValue: number }>;
}

export interface FitnessResult {
  score: number;
  breakdown: Record<string, number>;
  tier: "S" | "A" | "B" | "C" | "D" | "F";
}

// ============================================
// DEFAULT DNA PROFILES BY AGENT TYPE
// ============================================

const DEFAULT_DNA_PROFILES: Record<string, Partial<AgentDNA["genes"]>> = {
  food: { intelligence: 75, empathy: 85, speed: 80, creativity: 70 },
  fashion: { creativity: 90, empathy: 80, intelligence: 70, speed: 75 },
  grocery: { accuracy: 85, speed: 90, efficiency: 85, intelligence: 70 },
  pharmacy: { safety: 95, accuracy: 95, intelligence: 80, empathy: 70 },
  delivery: { speed: 95, efficiency: 85, intelligence: 65, collaboration: 80 },
  b2b_supplier: { negotiation: 85, intelligence: 85, confidence: 80, accuracy: 75 },
  cross_border: { intelligence: 85, negotiation: 75, safety: 80, accuracy: 85 },
  haggle: { negotiation: 95, intelligence: 80, confidence: 85, creativity: 70 },
  fleet: { speed: 90, efficiency: 85, collaboration: 80, intelligence: 70 },
  recruitment: { empathy: 85, intelligence: 85, creativity: 75, accuracy: 80 },
  vision: { accuracy: 90, intelligence: 85, speed: 70, creativity: 65 },
  voice: { empathy: 90, accuracy: 85, intelligence: 75, speed: 80 },
  smart_connect: { intelligence: 85, accuracy: 90, efficiency: 80, collaboration: 75 },
  gen_saas: { creativity: 90, intelligence: 85, efficiency: 75, confidence: 80 },
  gen_aggregator: { intelligence: 85, collaboration: 85, creativity: 75, negotiation: 70 },
  widget: { creativity: 90, speed: 80, efficiency: 85, intelligence: 75 },
  a2a: { collaboration: 95, negotiation: 85, confidence: 80, intelligence: 75 },
  analytics: { intelligence: 95, accuracy: 90, efficiency: 80, learning: 85 },
  financial: { accuracy: 95, safety: 90, intelligence: 85, confidence: 75 },
  mentor: { empathy: 95, intelligence: 85, learning: 90, creativity: 80 },
};

// ============================================
// DNA UTILITY FUNCTIONS
// ============================================

/**
 * Create default DNA for an agent type
 */
export function createDefaultDNA(agentType: AgentType): AgentDNA {
  const profile = DEFAULT_DNA_PROFILES[agentType] || {};

  return {
    genes: {
      intelligence: profile.intelligence ?? 70,
      speed: profile.speed ?? 70,
      accuracy: profile.accuracy ?? 70,
      creativity: profile.creativity ?? 70,
      empathy: profile.empathy ?? 70,
      negotiation: profile.negotiation ?? 70,
      memory: profile.memory ?? 70,
      learning: profile.learning ?? 70,
      confidence: profile.confidence ?? 70,
      safety: profile.safety ?? 70,
      efficiency: profile.efficiency ?? 70,
      collaboration: profile.collaboration ?? 70,
    },
  };
}

/**
 * Breed two agents to create a hybrid child
 * Uses crossover (average) + mutation (±mutationRate)
 */
export function breedAgents(
  parent1: AgentDNA,
  parent2: AgentDNA,
  mutationRate: number = 5,
): BreedResult {
  try {
    // Validate
    AgentDNASchema.parse(parent1);
    AgentDNASchema.parse(parent2);

    const child: AgentDNA = { genes: {} as AgentDNA["genes"] };
    const inheritedFrom: Record<string, "parent1" | "parent2"> = {};
    const mutations: Array<{ gene: string; oldValue: number; newValue: number }> = [];

    const geneKeys = Object.keys(parent1.genes) as Array<keyof AgentDNA["genes"]>;

    for (const gene of geneKeys) {
      const p1 = parent1.genes[gene];
      const p2 = parent2.genes[gene];

      // Crossover: weighted average favoring the stronger parent
      const p1Weight = p1 >= p2 ? 0.6 : 0.4;
      const crossover = p1 * p1Weight + p2 * (1 - p1Weight);

      // Mutation: ±mutationRate
      const mutation = (Math.random() - 0.5) * 2 * mutationRate;
      let finalValue = Math.round(crossover + mutation);

      // Clamp to 0-100
      finalValue = Math.max(0, Math.min(100, finalValue));

      child.genes[gene] = finalValue;
      inheritedFrom[gene] = p1 >= p2 ? "parent1" : "parent2";

      // Record mutation if significant
      if (Math.abs(finalValue - Math.round(crossover)) > 1) {
        mutations.push({
          gene,
          oldValue: Math.round(crossover),
          newValue: finalValue,
        });
      }
    }

    // Calculate generation
    const generation = Math.max(
      detectGeneration(parent1),
      detectGeneration(parent2),
    ) + 1;

    return {
      child,
      childName: generateChildName(parent1, parent2, generation),
      generation,
      inheritedFrom,
      mutations,
    };
  } catch (error) {
    console.error("[AgentDNA] breedAgents error:", error);
    throw new Error(Errors.breedFailed);
  }
}

/**
 * Calculate agent fitness score with weighted genes
 */
export function calculateFitness(
  dna: AgentDNA,
  weights?: Partial<Record<keyof AgentDNA["genes"], number>>,
): FitnessResult {
  try {
    AgentDNASchema.parse(dna);

    const defaultWeights = {
      intelligence: 1.0,
      speed: 0.8,
      accuracy: 1.2,
      creativity: 0.7,
      empathy: 0.9,
      negotiation: 0.6,
      memory: 0.8,
      learning: 1.0,
      confidence: 0.7,
      safety: 1.5,
      efficiency: 1.0,
      collaboration: 0.9,
    };

    const w = { ...defaultWeights, ...weights };
    const genes = dna.genes;

    // Calculate weighted average
    let totalWeight = 0;
    let weightedSum = 0;
    const breakdown: Record<string, number> = {};

    for (const gene of Object.keys(genes) as Array<keyof AgentDNA["genes"]>) {
      const weight = w[gene] || 1.0;
      const value = genes[gene];
      weightedSum += value * weight;
      totalWeight += weight;
      breakdown[gene] = Math.round(value * weight);
    }

    const rawScore = weightedSum / totalWeight;
    const score = Math.round(rawScore);

    // Determine tier
    let tier: FitnessResult["tier"] = "F";
    if (score >= 95) tier = "S";
    else if (score >= 85) tier = "A";
    else if (score >= 70) tier = "B";
    else if (score >= 55) tier = "C";
    else if (score >= 40) tier = "D";

    return { score, breakdown, tier };
  } catch (error) {
    console.error("[AgentDNA] calculateFitness error:", error);
    throw new Error(Errors.fitnessCalcFailed);
  }
}

/**
 * Mutate a single gene in an agent's DNA
 */
export function mutateGene(
  dna: AgentDNA,
  gene: keyof AgentDNA["genes"],
  amount: number,
): AgentDNA {
  const newDNA: AgentDNA = {
    genes: { ...dna.genes },
  };

  const currentValue = newDNA.genes[gene];
  let newValue = currentValue + amount;
  newValue = Math.max(0, Math.min(100, newValue));

  newDNA.genes[gene] = Math.round(newValue);
  return newDNA;
}

/**
 * Compare two DNA genomes and return similarity percentage
 */
export function compareDNA(dna1: AgentDNA, dna2: AgentDNA): number {
  const geneKeys = Object.keys(dna1.genes) as Array<keyof AgentDNA["genes"]>;

  let totalDiff = 0;
  for (const gene of geneKeys) {
    totalDiff += Math.abs(dna1.genes[gene] - dna2.genes[gene]);
  }

  const maxDiff = geneKeys.length * 100;
  const similarity = 1 - totalDiff / maxDiff;

  return Math.round(similarity * 100);
}

// ============================================
// DNA STORAGE & RETRIEVAL
// ============================================

/**
 * Store DNA genome to database
 */
export async function storeDNA(
  name: string,
  type: AgentType,
  dna: AgentDNA,
  parent1Id?: number,
  parent2Id?: number,
): Promise<number> {
  try {
    AgentDNASchema.parse(dna);

    const fitness = calculateFitness(dna);

    const [result] = await db.insert(dnaGenomes).values({
      parent1Id: parent1Id || null,
      parent2Id: parent2Id || null,
      name,
      type,
      genes: dna.genes as unknown as Record<string, number>,
      isActive: true,
      createdAt: new Date(),
    });

    const newId = Number(result.insertId);

    // Log
    await db.insert(agentLogs).values({
      agentName: type,
      intent: "dna_store",
      input: JSON.stringify({ name, type, fitness: fitness.score }),
      output: JSON.stringify({ id: newId, status: "stored" }),
      createdAt: new Date(),
    });

    return newId;
  } catch (error) {
    console.error("[AgentDNA] storeDNA error:", error);
    throw new Error(Errors.storeFailed);
  }
}

/**
 * Load DNA genome from database
 */
export async function loadDNA(genomeId: number): Promise<DNARecord | null> {
  try {
    const results = await db
      .select()
      .from(dnaGenomes)
      .where(eq(dnaGenomes.id, genomeId))
      .limit(1);

    if (results.length === 0) return null;

    const row = results[0];
    const genes = row.genes as unknown as AgentDNA["genes"];
    const fitness = calculateFitness({ genes });

    // Calculate generation from ancestry
    const generation = await calculateGeneration(row);

    return {
      id: row.id,
      parent1Id: row.parent1Id || undefined,
      parent2Id: row.parent2Id || undefined,
      name: row.name,
      type: row.type as AgentType,
      genes,
      fitness: fitness.score,
      generation,
      createdAt: row.createdAt,
    };
  } catch (error) {
    console.error("[AgentDNA] loadDNA error:", error);
    return null;
  }
}

/**
 * Get top performing DNA genomes
 */
export async function getTopDNA(
  type: AgentType,
  limit: number = 10,
): Promise<DNARecord[]> {
  try {
    const results = await db
      .select()
      .from(dnaGenomes)
      .where(eq(dnaGenomes.type, type))
      .orderBy(desc(dnaGenomes.createdAt))
      .limit(limit);

    const records: DNARecord[] = [];

    for (const row of results) {
      const genes = row.genes as unknown as AgentDNA["genes"];
      const fitness = calculateFitness({ genes });
      const generation = await calculateGeneration(row);

      records.push({
        id: row.id,
        parent1Id: row.parent1Id || undefined,
        parent2Id: row.parent2Id || undefined,
        name: row.name,
        type: row.type as AgentType,
        genes,
        fitness: fitness.score,
        generation,
        createdAt: row.createdAt,
      });
    }

    // Sort by fitness
    records.sort((a, b) => b.fitness - a.fitness);

    return records;
  } catch (error) {
    console.error("[AgentDNA] getTopDNA error:", error);
    return [];
  }
}

// ============================================
// DNA EVOLUTION ENGINE
// ============================================

export class DNAEvolutionEngine {
  private population: AgentDNA[] = [];
  private readonly POPULATION_SIZE = 20;
  private readonly ELITE_COUNT = 4;
  private readonly MUTATION_RATE = 5;

  /**
   * Initialize population with random mutations of a base DNA
   */
  initializePopulation(baseDNA: AgentDNA, size?: number): void {
    const popSize = size || this.POPULATION_SIZE;
    this.population = [baseDNA];

    for (let i = 1; i < popSize; i++) {
      const mutant = this.randomMutate(baseDNA);
      this.population.push(mutant);
    }
  }

  /**
   * Run one generation of evolution
   */
  evolveGeneration(): {
    generation: AgentDNA[];
    best: AgentDNA;
    bestFitness: number;
    avgFitness: number;
  } {
    // Evaluate fitness
    const scored = this.population.map((dna) => ({
      dna,
      fitness: calculateFitness(dna).score,
    }));

    // Sort by fitness descending
    scored.sort((a, b) => b.fitness - a.fitness);

    // Keep elite
    const elite = scored.slice(0, this.ELITE_COUNT).map((s) => s.dna);

    // Create next generation
    const nextGen: AgentDNA[] = [...elite];

    while (nextGen.length < this.POPULATION_SIZE) {
      // Tournament selection
      const parent1 = this.tournamentSelect(scored);
      const parent2 = this.tournamentSelect(scored);

      // Breed
      const result = breedAgents(parent1, parent2, this.MUTATION_RATE);
      nextGen.push(result.child);
    }

    this.population = nextGen;

    const best = scored[0];
    const avgFitness = Math.round(
      scored.reduce((sum, s) => sum + s.fitness, 0) / scored.length
    );

    return {
      generation: nextGen,
      best: best.dna,
      bestFitness: best.fitness,
      avgFitness,
    };
  }

  /**
   * Get current population
   */
  getPopulation(): AgentDNA[] {
    return [...this.population];
  }

  // ── Private helpers ─────────────────────────────────────────────

  private randomMutate(dna: AgentDNA): AgentDNA {
    const newDNA: AgentDNA = { genes: { ...dna.genes } };
    const geneKeys = Object.keys(dna.genes) as Array<keyof AgentDNA["genes"]>;

    // Mutate 2-4 random genes
    const numMutations = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < numMutations; i++) {
      const gene = geneKeys[Math.floor(Math.random() * geneKeys.length)];
      const amount = (Math.random() - 0.5) * 20;
      newDNA.genes[gene] = Math.max(0, Math.min(100, Math.round(newDNA.genes[gene] + amount)));
    }

    return newDNA;
  }

  private tournamentSelect(
    scored: Array<{ dna: AgentDNA; fitness: number }>,
  ): AgentDNA {
    // Pick 3 random, return best
    const tournamentSize = 3;
    let best = scored[0];

    for (let i = 0; i < tournamentSize; i++) {
      const random = scored[Math.floor(Math.random() * scored.length)];
      if (random.fitness > best.fitness) {
        best = random;
      }
    }

    return best.dna;
  }
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Detect generation number from DNA ancestry
 */
function detectGeneration(dna: AgentDNA): number {
  // In a real implementation, we'd track generation metadata
  // For now, estimate based on gene variance from defaults
  const defaults = createDefaultDNA("analytics").genes;
  const geneKeys = Object.keys(dna.genes) as Array<keyof AgentDNA["genes"]>;

  let totalVariance = 0;
  for (const gene of geneKeys) {
    totalVariance += Math.abs(dna.genes[gene] - defaults[gene]);
  }

  const avgVariance = totalVariance / geneKeys.length;
  return Math.max(1, Math.floor(avgVariance / 10) + 1);
}

/**
 * Calculate generation from database record
 */
async function calculateGeneration(row: {
  parent1Id: number | null;
  parent2Id: number | null;
  createdAt: Date;
}): Promise<number> {
  if (!row.parent1Id && !row.parent2Id) return 1;

  try {
    // Try to get parent generations
    let maxParentGen = 0;

    if (row.parent1Id) {
      const parent1 = await db
        .select()
        .from(dnaGenomes)
        .where(eq(dnaGenomes.id, row.parent1Id))
        .limit(1);
      if (parent1[0]) {
        maxParentGen = Math.max(maxParentGen, await calculateGeneration(parent1[0]));
      }
    }

    if (row.parent2Id) {
      const parent2 = await db
        .select()
        .from(dnaGenomes)
        .where(eq(dnaGenomes.id, row.parent2Id))
        .limit(1);
      if (parent2[0]) {
        maxParentGen = Math.max(maxParentGen, await calculateGeneration(parent2[0]));
      }
    }

    return maxParentGen + 1;
  } catch {
    return 1;
  }
}

/**
 * Generate a creative name for the child agent
 */
function generateChildName(parent1: AgentDNA, parent2: AgentDNA, generation: number): string {
  const prefixes = ["جاسم", "نور", "براق", "ذكي", "فهد", "رقمي", "ذكاء", "حكيم", "سريع", "بديع"];
  const suffixes = ["الأول", "الثاني", "الجديد", "المطور", "المتقدم", "النبيه", "الفطن", "اللامع"];

  const prefix = prefixes[generation % prefixes.length];
  const suffix = suffixes[Math.floor(Math.random() * suffixes.length)];

  return `${prefix} ${suffix} (الجيل ${generation})`;
}

// ============================================
// STANDALONE WRAPPER FUNCTIONS
// ============================================

/**
 * Quick DNA creation wrapper
 */
export function generateDefaultDNA(agentType: AgentType): AgentDNA {
  return createDefaultDNA(agentType);
}

/**
 * Quick breeding wrapper
 */
export function crossbreed(
  parent1: AgentDNA,
  parent2: AgentDNA,
  mutationRate?: number,
): BreedResult {
  return breedAgents(parent1, parent2, mutationRate);
}

/**
 * Quick fitness check wrapper
 */
export function checkFitness(
  dna: AgentDNA,
  weights?: Partial<Record<keyof AgentDNA["genes"], number>>,
): FitnessResult {
  return calculateFitness(dna, weights);
}

/**
 * Quick similarity check
 */
export function checkSimilarity(dna1: AgentDNA, dna2: AgentDNA): number {
  return compareDNA(dna1, dna2);
}
