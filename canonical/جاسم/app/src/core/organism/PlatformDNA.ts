export interface PlatformDNA {
  id: string;
  name: string;
  genes: number[];
  color: string;
  gradient: string;
  personality: PlatformPersonality;
  features: string[];
  agentCount: number;
  bubbleTypes: string[];
  createdAt: Date;
  evolvedAt: Date;
}

export interface PlatformPersonality {
  openness: number;
  innovation: number;
  trust: number;
  speed: number;
  quality: number;
  creativity: number;
  reliability: number;
  friendliness: number;
}

export function generatePlatformDNA(name: string, category: string): PlatformDNA {
  const seed = name + category;
  const genes = generateGenesFromSeed(seed, 32);

  return {
    id: `dna-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    name,
    genes,
    color: geneToColor(genes[0]),
    gradient: `linear-gradient(135deg, ${geneToColor(genes[0])}, ${geneToColor(genes[8])}, ${geneToColor(genes[16])})`,
    personality: {
      openness: genes[0],
      innovation: genes[1],
      trust: genes[2],
      speed: genes[3],
      quality: genes[4],
      creativity: genes[5],
      reliability: genes[6],
      friendliness: genes[7],
    },
    features: generateFeatures(genes),
    agentCount: Math.floor(genes[10] * 20) + 5,
    bubbleTypes: generateBubbleTypes(genes),
    createdAt: new Date(),
    evolvedAt: new Date(),
  };
}

export function evolveDNA(dna: PlatformDNA): PlatformDNA {
  const mutated = dna.genes.map((g) =>
    Math.random() < 0.05 ? Math.max(0, Math.min(1, g + (Math.random() - 0.5) * 0.2)) : g
  );

  return {
    ...dna,
    genes: mutated,
    color: geneToColor(mutated[0]),
    gradient: `linear-gradient(135deg, ${geneToColor(mutated[0])}, ${geneToColor(mutated[8])}, ${geneToColor(mutated[16])})`,
    personality: {
      openness: mutated[0],
      innovation: mutated[1],
      trust: mutated[2],
      speed: mutated[3],
      quality: mutated[4],
      creativity: mutated[5],
      reliability: mutated[6],
      friendliness: mutated[7],
    },
    features: generateFeatures(mutated),
    agentCount: Math.floor(mutated[10] * 20) + 5,
    evolvedAt: new Date(),
  };
}

export function getDNAColorGradient(dna: PlatformDNA): string {
  return dna.gradient;
}

export function serializeDNA(dna: PlatformDNA): string {
  return JSON.stringify({
    id: dna.id,
    name: dna.name,
    genes: dna.genes,
    features: dna.features,
    agentCount: dna.agentCount,
    bubbleTypes: dna.bubbleTypes,
  });
}

export function deserializeDNA(serialized: string): PlatformDNA {
  const data = JSON.parse(serialized);
  return {
    ...data,
    color: geneToColor(data.genes[0]),
    gradient: `linear-gradient(135deg, ${geneToColor(data.genes[0])}, ${geneToColor(data.genes[8])}, ${geneToColor(data.genes[16])})`,
    personality: {
      openness: data.genes[0],
      innovation: data.genes[1],
      trust: data.genes[2],
      speed: data.genes[3],
      quality: data.genes[4],
      creativity: data.genes[5],
      reliability: data.genes[6],
      friendliness: data.genes[7],
    },
    createdAt: new Date(data.createdAt),
    evolvedAt: new Date(data.evolvedAt),
  };
}

function generateGenesFromSeed(seed: string, count: number): number[] {
  const genes: number[] = [];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash) + seed.charCodeAt(i);
    hash |= 0;
  }
  for (let i = 0; i < count; i++) {
    hash = ((hash * 16807) % 2147483647);
    genes.push((hash & 0x7fffffff) / 2147483647);
  }
  return genes;
}

function geneToColor(gene: number): string {
  const hue = Math.floor(gene * 360);
  const saturation = 60 + Math.floor(gene * 20);
  const lightness = 45 + Math.floor(gene * 15);
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

function generateFeatures(genes: number[]): string[] {
  const allFeatures = [
    'search', 'filter', 'sort', 'map', 'chat', 'reviews',
    'payments', 'escrow', 'notifications', 'analytics',
    'ai_recommendations', 'booking', 'messaging', 'video',
    'calendar', 'tracking', 'multi_language', 'rtl_support',
    'dark_mode', 'offline_mode', 'pwa', 'biometric',
    'blockchain', 'smart_contracts', 'dao', 'token_rewards',
  ];
  const count = Math.floor(genes[9] * 10) + 3;
  const selected: string[] = [];
  for (let i = 0; i < count; i++) {
    const idx = Math.floor(genes[(i + 11) % genes.length] * allFeatures.length);
    const feature = allFeatures[idx % allFeatures.length];
    if (!selected.includes(feature)) selected.push(feature);
  }
  return selected;
}

function generateBubbleTypes(genes: number[]): string[] {
  const types = ['product', 'service', 'job', 'property', 'vehicle', 'freelance', 'event', 'education', 'healthcare', 'travel'];
  const count = Math.floor(genes[11] * 5) + 2;
  const selected: string[] = [];
  for (let i = 0; i < count; i++) {
    const idx = Math.floor(genes[(i + 20) % genes.length] * types.length);
    const type = types[idx % types.length];
    if (!selected.includes(type)) selected.push(type);
  }
  return selected;
}
