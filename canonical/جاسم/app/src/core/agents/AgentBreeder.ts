import type { AgentDNA } from './AgentDNA';
import { mutateAgentDNA, combineAgentDNA, createAgentDNA } from './AgentDNA';
import type { AgentRole } from './AgentRoles';
import { getRoleById } from './AgentRoles';
import type { AgentTrait } from './AgentTraits';
import { getTraitById } from './AgentTraits';

export interface Agent {
  id: string;
  name: string;
  dna: AgentDNA;
  role: AgentRole;
  traits: AgentTrait[];
  energy: number;
  experience: number;
  level: number;
  status: AgentStatus;
  createdAt: Date;
  lastActiveAt: Date;
}

export type AgentStatus = 'spawning' | 'learning' | 'ready' | 'working' | 'resting' | 'evolving' | 'dormant';

export interface BreedResult {
  agent: Agent;
  mutations: number;
  generation: number;
}

export function breedAgent(
  name: string,
  platform: string,
  roleId: string,
  traitIds: string[] = []
): BreedResult {
  const role = getRoleById(roleId) ?? getRoleById('explorer')!;
  const dna = createAgentDNA(name, platform, roleId);
  const traits = traitIds.map((id) => getTraitById(id)).filter(Boolean) as AgentTrait[];

  const agent: Agent = {
    id: `agent-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    name,
    dna,
    role,
    traits,
    energy: 100,
    experience: 0,
    level: 1,
    status: 'spawning',
    createdAt: new Date(),
    lastActiveAt: new Date(),
  };

  return {
    agent,
    mutations: 0,
    generation: 1,
  };
}

export function evolveAgent(agent: Agent): Agent {
  const newDna = mutateAgentDNA(agent.dna, 0.05);
  const energyCost = 10;
  const experienceGain = 5;

  return {
    ...agent,
    dna: newDna,
    energy: Math.max(0, agent.energy - energyCost),
    experience: agent.experience + experienceGain,
    level: calculateLevel(agent.experience + experienceGain),
    status: 'evolving',
    lastActiveAt: new Date(),
  };
}

export function crossBreedAgents(parentA: Agent, parentB: Agent, name: string): BreedResult {
  const newDna = combineAgentDNA(parentA.dna, parentB.dna);
  const allTraits = [...parentA.traits, ...parentB.traits];
  const uniqueTraits = allTraits.filter((t, i, arr) => arr.findIndex((x) => x.id === t.id) === i);

  const child: Agent = {
    id: `agent-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    name,
    dna: newDna,
    role: parentA.role,
    traits: uniqueTraits.slice(0, 3),
    energy: 80,
    experience: 0,
    level: 1,
    status: 'spawning',
    createdAt: new Date(),
    lastActiveAt: new Date(),
  };

  return {
    agent: child,
    mutations: newDna.sequence.metadata.mutations,
    generation: newDna.sequence.metadata.generation,
  };
}

export function activateAgent(agent: Agent): Agent {
  return { ...agent, status: 'working', energy: Math.max(0, agent.energy - 5), lastActiveAt: new Date() };
}

export function restAgent(agent: Agent): Agent {
  return { ...agent, status: 'resting', energy: Math.min(100, agent.energy + 20), lastActiveAt: new Date() };
}

export function trainAgent(agent: Agent, _skill: string): Agent {
  const expGain = 10;
  return {
    ...agent,
    experience: agent.experience + expGain,
    level: calculateLevel(agent.experience + expGain),
    status: 'learning',
    lastActiveAt: new Date(),
  };
}

export function calculateLevel(experience: number): number {
  return Math.floor(Math.sqrt(experience / 100)) + 1;
}

export function getAgentPower(agent: Agent): number {
  const basePower = agent.level * 10;
  const energyBonus = agent.energy / 10;
  const traitBonus = agent.traits.reduce((sum, t) => sum + (t.effect.multiplier - 1) * 10, 0);
  return basePower + energyBonus + traitBonus;
}

export function getAgentEfficiency(agent: Agent): number {
  const energyFactor = agent.energy / 100;
  const levelFactor = agent.level / 10;
  const traitFactor = agent.traits.reduce((sum, t) => sum + t.effect.multiplier, 0) / Math.max(1, agent.traits.length);
  return Math.min(1, (energyFactor + levelFactor + traitFactor) / 3);
}
