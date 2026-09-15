import type { Agent } from './AgentBreeder';
import type { AgentDNA } from './AgentDNA';

export interface ComposedAgent {
  id: string;
  name: string;
  agents: Agent[];
  dna: AgentDNA;
  role: string;
  capabilities: string[];
  context: Record<string, unknown>;
  createdAt: Date;
  expiresAt: Date;
}

export function composeExecution(
  name: string,
  agents: Agent[],
  context: Record<string, unknown> = {}
): ComposedAgent {
  const primaryDna = agents[0]?.dna;
  if (!primaryDna) throw new Error('At least one agent required');

  const allCapabilities = agents.flatMap((a) => a.role.capabilities);
  const uniqueCapabilities = [...new Set(allCapabilities)];

  return {
    id: `composed-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    name,
    agents,
    dna: primaryDna,
    role: agents[0].role.name,
    capabilities: uniqueCapabilities,
    context,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  };
}

export function runExecution(composed: ComposedAgent): ExecutionResult {
  const agentEfficiencies = composed.agents.map((a) => ({
    agent: a,
    efficiency: calculateAgentEfficiency(a),
  }));

  const totalEfficiency = agentEfficiencies.reduce((sum, ae) => sum + ae.efficiency, 0) / agentEfficiencies.length;

  return {
    composedAgentId: composed.id,
    success: totalEfficiency > 0.3,
    efficiency: totalEfficiency,
    agentResults: agentEfficiencies.map((ae) => ({
      agentId: ae.agent.id,
      agentName: ae.agent.name,
      efficiency: ae.efficiency,
      executed: ae.efficiency > 0.2,
    })),
    output: {},
    completedAt: new Date(),
  };
}

export function dissolveExecution(composed: ComposedAgent): void {
  composed.agents = [];
  composed.capabilities = [];
  composed.context = {};
}

export function extendExecution(composed: ComposedAgent, hours: number): ComposedAgent {
  return {
    ...composed,
    expiresAt: new Date(composed.expiresAt.getTime() + hours * 60 * 60 * 1000),
  };
}

export function addAgentToExecution(composed: ComposedAgent, agent: Agent): ComposedAgent {
  return {
    ...composed,
    agents: [...composed.agents, agent],
    capabilities: [...new Set([...composed.capabilities, ...agent.role.capabilities])],
  };
}

export function removeAgentFromExecution(composed: ComposedAgent, agentId: string): ComposedAgent {
  const filtered = composed.agents.filter((a) => a.id !== agentId);
  const allCapabilities = filtered.flatMap((a) => a.role.capabilities);
  return {
    ...composed,
    agents: filtered,
    capabilities: [...new Set(allCapabilities)],
  };
}

function calculateAgentEfficiency(agent: Agent): number {
  const energyFactor = agent.energy / 100;
  const levelFactor = Math.min(1, agent.level / 20);
  const traitBonus = agent.traits.reduce((sum, t) => sum + (t.effect.multiplier - 1), 0);
  return Math.min(1, energyFactor * 0.5 + levelFactor * 0.3 + traitBonus * 0.2);
}

export interface ExecutionResult {
  composedAgentId: string;
  success: boolean;
  efficiency: number;
  agentResults: AgentResult[];
  output: Record<string, unknown>;
  completedAt: Date;
}

export interface AgentResult {
  agentId: string;
  agentName: string;
  efficiency: number;
  executed: boolean;
}
