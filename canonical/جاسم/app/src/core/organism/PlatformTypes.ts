export interface LivingOrganism {
  id: string;
  name: string;
  dna: import('./PlatformDNA').PlatformDNA;
  platforms: Platform[];
  agents: LivingAgent[];
  swarms: AgentSwarm[];
  bubbles: LivingBubble[];
  status: OrganismStatus;
  energy: number;
  experience: number;
  generation: number;
  createdAt: Date;
  lastEvolvedAt: Date;
}

export interface Platform {
  id: string;
  name: string;
  category: string;
  status: 'concept' | 'designing' | 'building' | 'testing' | 'live' | 'evolving' | 'deprecated';
  dna: import('./PlatformDNA').PlatformDNA;
  features: string[];
  agentIds: string[];
  bubbleIds: string[];
}

export interface LivingAgent {
  id: string;
  name: string;
  role: string;
  energy: number;
  experience: number;
  status: 'spawning' | 'learning' | 'ready' | 'working' | 'resting' | 'evolving' | 'dormant';
  dna: import('../agents/AgentDNA').AgentDNA;
  platformId: string;
  tasksCompleted: number;
  lastActiveAt: Date;
}

export interface AgentSwarm {
  id: string;
  name: string;
  objective: string;
  agentIds: string[];
  status: 'forming' | 'coordinating' | 'executing' | 'completed' | 'failed' | 'disbanded';
  progress: number;
  createdAt: Date;
}

export interface LivingBubble {
  id: string;
  type: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  energy: number;
  platformId: string;
  agentId?: string;
  isExpanded: boolean;
  isHovered: boolean;
  connections: string[];
}

export type OrganismStatus = 'embryo' | 'growing' | 'mature' | 'evolving' | 'adaptive';

export function createLivingOrganism(name: string): LivingOrganism {
  const { generatePlatformDNA } = require('./PlatformDNA');
  const dna = generatePlatformDNA(name, 'organism');

  return {
    id: `organism-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    name,
    dna,
    platforms: [],
    agents: [],
    swarms: [],
    bubbles: [],
    status: 'embryo',
    energy: 100,
    experience: 0,
    generation: 1,
    createdAt: new Date(),
    lastEvolvedAt: new Date(),
  };
}

export function evolveOrganism(organism: LivingOrganism): LivingOrganism {
  const { evolveDNA } = require('./PlatformDNA');
  const newDna = evolveDNA(organism.dna);
  const energyCost = 5;
  const expGain = 10;

  return {
    ...organism,
    dna: newDna,
    energy: Math.max(0, organism.energy - energyCost),
    experience: organism.experience + expGain,
    generation: organism.generation + 1,
    status: organism.experience > 1000 ? 'adaptive' : organism.experience > 500 ? 'evolving' : organism.experience > 100 ? 'mature' : 'growing',
    lastEvolvedAt: new Date(),
  };
}

export function addPlatformToOrganism(organism: LivingOrganism, platform: Platform): LivingOrganism {
  return { ...organism, platforms: [...organism.platforms, platform] };
}

export function addAgentToOrganism(organism: LivingOrganism, agent: LivingAgent): LivingOrganism {
  return { ...organism, agents: [...organism.agents, agent] };
}

export function addSwarmToOrganism(organism: LivingOrganism, swarm: AgentSwarm): LivingOrganism {
  return { ...organism, swarms: [...organism.swarms, swarm] };
}

export function addBubbleToOrganism(organism: LivingOrganism, bubble: LivingBubble): LivingOrganism {
  return { ...organism, bubbles: [...organism.bubbles, bubble] };
}

export function getOrganismHealth(organism: LivingOrganism): number {
  const platformHealth = organism.platforms.length > 0
    ? organism.platforms.filter((p) => p.status === 'live').length / organism.platforms.length
    : 0;
  const agentHealth = organism.agents.length > 0
    ? organism.agents.reduce((sum, a) => sum + a.energy, 0) / organism.agents.length / 100
    : 0;
  const energyFactor = organism.energy / 100;
  return (platformHealth + agentHealth + energyFactor) / 3;
}

export function getOrganismStats(organism: LivingOrganism) {
  return {
    platforms: organism.platforms.length,
    agents: organism.agents.length,
    swarms: organism.swarms.length,
    bubbles: organism.bubbles.length,
    energy: organism.energy,
    experience: organism.experience,
    generation: organism.generation,
    health: getOrganismHealth(organism),
    status: organism.status,
  };
}
