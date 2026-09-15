import { useState, useCallback } from 'react';
import type { Swarm } from '../core/agents/SwarmCoordinator.ts';
import { createSwarm, addAgentToSwarm, removeAgentFromSwarm, coordinateSwarm, disbandSwarm, getSwarmEfficiency } from '../core/agents/SwarmCoordinator.ts';
import type { Agent } from '../core/agents/AgentBreeder.ts';

export function useSwarm(name: string = 'Default Swarm', objective: string = 'General') {
  const [swarm, setSwarm] = useState<Swarm>(() => createSwarm(name, objective));

  const addAgent = useCallback((agent: Agent) => {
    setSwarm((prev) => addAgentToSwarm(prev, agent));
  }, []);

  const removeAgent = useCallback((agentId: string) => {
    setSwarm((prev) => removeAgentFromSwarm(prev, agentId));
  }, []);

  const coordinate = useCallback(() => {
    setSwarm((prev) => coordinateSwarm(prev));
  }, []);

  const disband = useCallback(() => {
    setSwarm((prev) => disbandSwarm(prev));
  }, []);

  const efficiency = getSwarmEfficiency(swarm);

  return {
    swarm,
    efficiency,
    addAgent,
    removeAgent,
    coordinate,
    disband,
  };
}
