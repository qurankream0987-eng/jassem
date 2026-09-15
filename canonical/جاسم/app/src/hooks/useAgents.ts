import { useState, useCallback } from 'react';
import type { Agent } from '../core/agents/AgentBreeder.ts';
import { breedAgent, evolveAgent, restAgent, trainAgent, getAgentPower, getAgentEfficiency } from '../core/agents/AgentBreeder.ts';

export function useAgents() {
  const [agents, setAgents] = useState<Agent[]>([]);

  const createAgent = useCallback((name: string, platform: string, roleId: string) => {
    const result = breedAgent(name, platform, roleId);
    setAgents((prev) => [...prev, result.agent]);
    return result.agent;
  }, []);

  const evolve = useCallback((agentId: string) => {
    setAgents((prev) =>
      prev.map((a) => (a.id === agentId ? evolveAgent(a) : a))
    );
  }, []);

  const train = useCallback((agentId: string, skill: string) => {
    setAgents((prev) =>
      prev.map((a) => (a.id === agentId ? trainAgent(a, skill) : a))
    );
  }, []);

  const rest = useCallback((agentId: string) => {
    setAgents((prev) =>
      prev.map((a) => (a.id === agentId ? restAgent(a) : a))
    );
  }, []);

  const getStats = useCallback(() => {
    return {
      total: agents.length,
      working: agents.filter((a) => a.status === 'working').length,
      resting: agents.filter((a) => a.status === 'resting').length,
      evolving: agents.filter((a) => a.status === 'evolving').length,
      totalPower: agents.reduce((sum, a) => sum + getAgentPower(a), 0),
      avgEfficiency: agents.length > 0
        ? agents.reduce((sum, a) => sum + getAgentEfficiency(a), 0) / agents.length
        : 0,
    };
  }, [agents]);

  return {
    agents,
    createAgent,
    evolve,
    train,
    rest,
    getStats,
  };
}
