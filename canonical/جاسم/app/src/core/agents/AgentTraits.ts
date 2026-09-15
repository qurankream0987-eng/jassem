export interface AgentTrait {
  id: string;
  name: string;
  description: string;
  effect: TraitEffect;
  rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
}

export interface TraitEffect {
  stat: string;
  multiplier: number;
  bonus: number;
}

export const AGENT_TRAITS: AgentTrait[] = [
  { id: 'fast_learner', name: 'Fast Learner', description: 'Learns 50% faster', effect: { stat: 'learningRate', multiplier: 1.5, bonus: 0 }, rarity: 'common' },
  { id: 'deep_memory', name: 'Deep Memory', description: 'Remembers 2x more', effect: { stat: 'memoryCapacity', multiplier: 2, bonus: 0 }, rarity: 'uncommon' },
  { id: 'charismatic', name: 'Charismatic', description: 'Better negotiation outcomes', effect: { stat: 'negotiation', multiplier: 1.3, bonus: 0.1 }, rarity: 'rare' },
  { id: 'analytical', name: 'Analytical', description: 'Analysis accuracy +25%', effect: { stat: 'analysis', multiplier: 1.25, bonus: 0.05 }, rarity: 'common' },
  { id: 'creative_spark', name: 'Creative Spark', description: 'Generates unique solutions', effect: { stat: 'creativity', multiplier: 1.4, bonus: 0.1 }, rarity: 'rare' },
  { id: 'iron_will', name: 'Iron Will', description: 'Resists manipulation', effect: { stat: 'willpower', multiplier: 1.5, bonus: 0.2 }, rarity: 'epic' },
  { id: 'networker', name: 'Networker', description: 'Connects faster', effect: { stat: 'connectionSpeed', multiplier: 1.3, bonus: 0 }, rarity: 'uncommon' },
  { id: 'perfectionist', name: 'Perfectionist', description: 'Quality +30%, Speed -10%', effect: { stat: 'quality', multiplier: 1.3, bonus: 0 }, rarity: 'rare' },
  { id: 'adaptable', name: 'Adaptable', description: 'Adjusts to any platform', effect: { stat: 'adaptability', multiplier: 1.5, bonus: 0.1 }, rarity: 'epic' },
  { id: 'legendary_leader', name: 'Legendary Leader', description: 'Swarm efficiency +50%', effect: { stat: 'leadership', multiplier: 1.5, bonus: 0.2 }, rarity: 'legendary' },
];

export function getTraitById(id: string): AgentTrait | undefined {
  return AGENT_TRAITS.find((t) => t.id === id);
}

export function getTraitsByRarity(rarity: AgentTrait['rarity']): AgentTrait[] {
  return AGENT_TRAITS.filter((t) => t.rarity === rarity);
}

export function applyTrait(agent: AgentWithStats, trait: AgentTrait): AgentWithStats {
  const stats = { ...agent.stats };
  const current = stats[trait.effect.stat] ?? 0.5;
  stats[trait.effect.stat] = current * trait.effect.multiplier + trait.effect.bonus;
  return { ...agent, stats, traits: [...agent.traits, trait] };
}

export interface AgentWithStats {
  id: string;
  name: string;
  stats: Record<string, number>;
  traits: AgentTrait[];
}
