import type { GeneSequence } from '../dna/gene-sequencer';

export interface AgentDNA {
  sequence: GeneSequence;
  roleMarkers: number[];
  capabilityGenes: number[];
  personalityGenes: number[];
  memoryGenes: number[];
  learningGenes: number[];
}

export function createAgentDNA(
  name: string,
  platform: string,
  role: string
): AgentDNA {
  const baseSequence: GeneSequence = {
    id: `agent-dna-${Date.now()}`,
    name,
    genes: Array.from({ length: 32 }, () => Math.random()),
    metadata: {
      generation: 1,
      mutations: 0,
      fitness: 0.5,
      parentIds: [],
      platform,
      category: role,
    },
    createdAt: new Date(),
    evolvedAt: new Date(),
  };

  return {
    sequence: baseSequence,
    roleMarkers: baseSequence.genes.slice(0, 5),
    capabilityGenes: baseSequence.genes.slice(5, 15),
    personalityGenes: baseSequence.genes.slice(15, 25),
    memoryGenes: baseSequence.genes.slice(25, 30),
    learningGenes: baseSequence.genes.slice(30, 32),
  };
}

export function mutateAgentDNA(dna: AgentDNA, rate: number = 0.05): AgentDNA {
  const mutate = (genes: number[]) =>
    genes.map((g) => (Math.random() < rate ? Math.max(0, Math.min(1, g + (Math.random() - 0.5) * 0.2)) : g));

  return {
    sequence: {
      ...dna.sequence,
      genes: mutate(dna.sequence.genes),
      metadata: {
        ...dna.sequence.metadata,
        generation: dna.sequence.metadata.generation + 1,
        mutations: dna.sequence.metadata.mutations + 1,
      },
      evolvedAt: new Date(),
    },
    roleMarkers: mutate(dna.roleMarkers),
    capabilityGenes: mutate(dna.capabilityGenes),
    personalityGenes: mutate(dna.personalityGenes),
    memoryGenes: mutate(dna.memoryGenes),
    learningGenes: mutate(dna.learningGenes),
  };
}

export function combineAgentDNA(parentA: AgentDNA, parentB: AgentDNA): AgentDNA {
  const crossover = (a: number[], b: number[]) => {
    const point = Math.floor(Math.random() * a.length);
    return [...a.slice(0, point), ...b.slice(point)];
  };

  return {
    sequence: {
      id: `agent-dna-${Date.now()}`,
      name: `${parentA.sequence.name} x ${parentB.sequence.name}`,
      genes: crossover(parentA.sequence.genes, parentB.sequence.genes),
      metadata: {
        generation: Math.max(parentA.sequence.metadata.generation, parentB.sequence.metadata.generation) + 1,
        mutations: 0,
        fitness: 0.5,
        parentIds: [parentA.sequence.id, parentB.sequence.id],
        platform: parentA.sequence.metadata.platform,
        category: 'hybrid',
      },
      createdAt: new Date(),
      evolvedAt: new Date(),
    },
    roleMarkers: crossover(parentA.roleMarkers, parentB.roleMarkers),
    capabilityGenes: crossover(parentA.capabilityGenes, parentB.capabilityGenes),
    personalityGenes: crossover(parentA.personalityGenes, parentB.personalityGenes),
    memoryGenes: crossover(parentA.memoryGenes, parentB.memoryGenes),
    learningGenes: crossover(parentA.learningGenes, parentB.learningGenes),
  };
}

export function getAgentCapabilityScore(dna: AgentDNA, capability: string): number {
  const index = capability.charCodeAt(0) % dna.capabilityGenes.length;
  return dna.capabilityGenes[index] ?? 0.5;
}

export function getAgentPersonality(dna: AgentDNA): Record<string, number> {
  return {
    openness: dna.personalityGenes[0] ?? 0.5,
    conscientiousness: dna.personalityGenes[1] ?? 0.5,
    extraversion: dna.personalityGenes[2] ?? 0.5,
    agreeableness: dna.personalityGenes[3] ?? 0.5,
    neuroticism: dna.personalityGenes[4] ?? 0.5,
  };
}

export function getAgentLearningRate(dna: AgentDNA): number {
  return (dna.learningGenes[0] ?? 0.5) * 0.9 + 0.1;
}

export function getAgentMemoryCapacity(dna: AgentDNA): number {
  return Math.floor((dna.memoryGenes[0] ?? 0.5) * 10000) + 100;
}
