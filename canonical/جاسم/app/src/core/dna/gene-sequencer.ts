export interface GeneSequence {
  id: string;
  name: string;
  genes: number[];
  metadata: GeneMetadata;
  createdAt: Date;
  evolvedAt: Date;
}

export interface GeneMetadata {
  generation: number;
  mutations: number;
  fitness: number;
  parentIds: string[];
  platform: string;
  category: string;
}

export interface SequencerConfig {
  geneCount: number;
  mutationRate: number;
  crossoverRate: number;
  elitismRatio: number;
}

export const DEFAULT_SEQUENCER_CONFIG: SequencerConfig = {
  geneCount: 32,
  mutationRate: 0.05,
  crossoverRate: 0.7,
  elitismRatio: 0.1,
} as const;

export function createGeneSequence(
  name: string,
  platform: string,
  category: string,
  config: SequencerConfig = DEFAULT_SEQUENCER_CONFIG
): GeneSequence {
  const genes: number[] = [];
  for (let i = 0; i < config.geneCount; i++) {
    genes.push(Math.random());
  }
  return {
    id: generateSequenceId(),
    name,
    genes,
    metadata: {
      generation: 1,
      mutations: 0,
      fitness: 0.5,
      parentIds: [],
      platform,
      category,
    },
    createdAt: new Date(),
    evolvedAt: new Date(),
  };
}

export function evolveSequence(
  parent: GeneSequence,
  config: SequencerConfig = DEFAULT_SEQUENCER_CONFIG
): GeneSequence {
  const genes = [...parent.genes];
  let mutations = 0;

  for (let i = 0; i < genes.length; i++) {
    if (Math.random() < config.mutationRate) {
      genes[i] = Math.max(0, Math.min(1, genes[i] + (Math.random() - 0.5) * 0.2));
      mutations++;
    }
  }

  return {
    id: generateSequenceId(),
    name: `${parent.name} v${parent.metadata.generation + 1}`,
    genes,
    metadata: {
      generation: parent.metadata.generation + 1,
      mutations: parent.metadata.mutations + mutations,
      fitness: calculateFitness(genes),
      parentIds: [parent.id],
      platform: parent.metadata.platform,
      category: parent.metadata.category,
    },
    createdAt: new Date(),
    evolvedAt: new Date(),
  };
}

export function crossoverSequences(
  parentA: GeneSequence,
  parentB: GeneSequence,
  config: SequencerConfig = DEFAULT_SEQUENCER_CONFIG
): GeneSequence {
  const genes: number[] = [];
  const crossoverPoint = Math.floor(Math.random() * config.geneCount);

  for (let i = 0; i < config.geneCount; i++) {
    genes.push(i < crossoverPoint ? parentA.genes[i] : parentB.genes[i]);
  }

  return {
    id: generateSequenceId(),
    name: `${parentA.name} x ${parentB.name}`,
    genes,
    metadata: {
      generation: Math.max(parentA.metadata.generation, parentB.metadata.generation) + 1,
      mutations: 0,
      fitness: calculateFitness(genes),
      parentIds: [parentA.id, parentB.id],
      platform: parentA.metadata.platform,
      category: parentA.metadata.category,
    },
    createdAt: new Date(),
    evolvedAt: new Date(),
  };
}

export function calculateFitness(genes: number[]): number {
  const sum = genes.reduce((a, b) => a + b, 0);
  const avg = sum / genes.length;
  const variance = genes.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / genes.length;
  return Math.max(0, Math.min(1, avg * (1 - variance)));
}

export function getGeneAt(sequence: GeneSequence, index: number): number {
  return sequence.genes[index] ?? 0.5;
}

export function setGeneAt(sequence: GeneSequence, index: number, value: number): GeneSequence {
  const genes = [...sequence.genes];
  genes[index] = Math.max(0, Math.min(1, value));
  return {
    ...sequence,
    genes,
    metadata: {
      ...sequence.metadata,
      mutations: sequence.metadata.mutations + 1,
      fitness: calculateFitness(genes),
    },
    evolvedAt: new Date(),
  };
}

export function getGeneColor(sequence: GeneSequence, index: number): string {
  const gene = getGeneAt(sequence, index);
  const hue = Math.floor(gene * 360);
  return `hsl(${hue}, 70%, 50%)`;
}

export function getGeneGradient(sequence: GeneSequence): string {
  const color1 = getGeneColor(sequence, 0);
  const color2 = getGeneColor(sequence, 8);
  const color3 = getGeneColor(sequence, 16);
  return `linear-gradient(135deg, ${color1}, ${color2}, ${color3})`;
}

function generateSequenceId(): string {
  return `gene-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}
