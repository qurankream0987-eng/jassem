import type { Agent } from './AgentBreeder';
import type { ComposedAgent } from './AgentComposer';

export interface Swarm {
  id: string;
  name: string;
  agents: Agent[];
  composedAgents: ComposedAgent[];
  coordinator: Agent | null;
  status: SwarmStatus;
  objective: string;
  progress: number;
  createdAt: Date;
}

export type SwarmStatus = 'forming' | 'coordinating' | 'executing' | 'completed' | 'failed' | 'disbanded';

export interface SwarmConfig {
  maxAgents: number;
  minAgents: number;
  coordinationStrategy: 'hierarchical' | 'democratic' | 'anarchic';
  communicationMode: 'broadcast' | 'gossip' | 'direct';
}

export const DEFAULT_SWARM_CONFIG: SwarmConfig = {
  maxAgents: 50,
  minAgents: 2,
  coordinationStrategy: 'hierarchical',
  communicationMode: 'broadcast',
} as const;

export function createSwarm(
  name: string,
  objective: string,
  _config: SwarmConfig = DEFAULT_SWARM_CONFIG
): Swarm {
  return {
    id: `swarm-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    name,
    agents: [],
    composedAgents: [],
    coordinator: null,
    status: 'forming',
    objective,
    progress: 0,
    createdAt: new Date(),
  };
}

export function addAgentToSwarm(swarm: Swarm, agent: Agent): Swarm {
  if (swarm.agents.length >= DEFAULT_SWARM_CONFIG.maxAgents) {
    throw new Error('Swarm at maximum capacity');
  }

  const updated = {
    ...swarm,
    agents: [...swarm.agents, agent],
  };

  if (!updated.coordinator || agent.level > updated.coordinator.level) {
    updated.coordinator = agent;
  }

  return updated;
}

export function removeAgentFromSwarm(swarm: Swarm, agentId: string): Swarm {
  const filtered = swarm.agents.filter((a) => a.id !== agentId);
  const newCoordinator = filtered.reduce<Agent | null>((best, agent) => {
    if (!best || agent.level > best.level) return agent;
    return best;
  }, null);

  return {
    ...swarm,
    agents: filtered,
    coordinator: newCoordinator,
  };
}

export function coordinateSwarm(swarm: Swarm): Swarm {
  if (swarm.agents.length < DEFAULT_SWARM_CONFIG.minAgents) {
    return { ...swarm, status: 'forming' };
  }

  const activeAgents = swarm.agents.filter((a) => a.status === 'ready' || a.status === 'working');
  const progress = activeAgents.length / swarm.agents.length;

  return {
    ...swarm,
    status: progress > 0.8 ? 'executing' : 'coordinating',
    progress,
  };
}

export function disbandSwarm(swarm: Swarm): Swarm {
  return {
    ...swarm,
    agents: [],
    composedAgents: [],
    coordinator: null,
    status: 'disbanded',
    progress: 1,
  };
}

export function getSwarmEfficiency(swarm: Swarm): number {
  if (swarm.agents.length === 0) return 0;
  const totalEfficiency = swarm.agents.reduce((sum, a) => sum + (a.energy / 100) * (a.level / 10), 0);
  return totalEfficiency / swarm.agents.length;
}

export function getSwarmSize(swarm: Swarm): number {
  return swarm.agents.length;
}

export function getSwarmRoles(swarm: Swarm): Record<string, number> {
  const roles: Record<string, number> = {};
  for (const agent of swarm.agents) {
    roles[agent.role.name] = (roles[agent.role.name] ?? 0) + 1;
  }
  return roles;
}
