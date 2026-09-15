import React, { useState, useEffect, useCallback } from 'react';
import type { Agent } from '../../core/agents/AgentBreeder';
import { breedAgent, evolveAgent, restAgent, trainAgent, getAgentPower, getAgentEfficiency } from '../../core/agents/AgentBreeder';
import type { Swarm } from '../../core/agents/SwarmCoordinator';
import { createSwarm, addAgentToSwarm, coordinateSwarm, getSwarmEfficiency } from '../../core/agents/SwarmCoordinator';

interface SwarmPanelProps {
  platformName?: string;
  initialAgents?: number;
}

export const SwarmPanel: React.FC<SwarmPanelProps> = ({
  platformName = 'JASIM',
  initialAgents = 6,
}) => {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [swarms, setSwarms] = useState<Swarm[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [evolutionLog, setEvolutionLog] = useState<string[]>([]);

  useEffect(() => {
    const initial: Agent[] = [];
    const roles = ['explorer', 'builder', 'guardian', 'negotiator', 'curator', 'teacher'];
    for (let i = 0; i < initialAgents; i++) {
      const result = breedAgent(
        `${platformName} Agent ${i + 1}`,
        platformName,
        roles[i % roles.length]
      );
      initial.push(result.agent);
    }
    setAgents(initial);

    const swarm = createSwarm(`${platformName} Swarm`, 'Platform coordination');
    let populated = swarm;
    for (const agent of initial) {
      populated = addAgentToSwarm(populated, agent);
    }
    setSwarms([coordinateSwarm(populated)]);

    const interval = setInterval(() => {
      setAgents((prev) =>
        prev.map((a) => {
          if (a.status === 'working' && a.energy < 20) {
            return restAgent(a);
          }
          if (a.status === 'resting' && a.energy > 80) {
            return { ...a, status: 'ready' as const };
          }
          if (Math.random() < 0.01) {
            const evolved = evolveAgent(a);
            setEvolutionLog((log) => [
              ...log.slice(-20),
              `${evolved.name} evolved to level ${evolved.level}`,
            ]);
            return evolved;
          }
          return a;
        })
      );
    }, 2000);

    return () => clearInterval(interval);
  }, [platformName, initialAgents]);

  const handleEvolve = useCallback((agent: Agent) => {
    setAgents((prev) =>
      prev.map((a) => (a.id === agent.id ? evolveAgent(a) : a))
    );
    setEvolutionLog((log) => [...log.slice(-20), `${agent.name} manually evolved`]);
  }, []);

  const handleTrain = useCallback((agent: Agent) => {
    setAgents((prev) =>
      prev.map((a) => (a.id === agent.id ? trainAgent(a, 'general') : a))
    );
  }, []);

  const handleRest = useCallback((agent: Agent) => {
    setAgents((prev) =>
      prev.map((a) => (a.id === agent.id ? restAgent(a) : a))
    );
  }, []);

  const swarm = swarms[0];
  const swarmEfficiency = swarm ? getSwarmEfficiency(swarm) : 0;

  return (
    <div className="w-full h-full bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 rounded-2xl p-6 overflow-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-white">{platformName} Swarm</h2>
          <p className="text-slate-400 text-sm">
            {agents.length} agents | Swarm efficiency: {(swarmEfficiency * 100).toFixed(1)}%
          </p>
        </div>
        <div className="flex gap-2">
          <div className="px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-400 text-xs">
            Live
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-6">
        {agents.map((agent) => (
          <div
            key={agent.id}
            onClick={() => setSelectedAgent(agent)}
            className={`relative p-4 rounded-xl cursor-pointer transition-all duration-300 ${
              selectedAgent?.id === agent.id
                ? 'bg-white/10 ring-2 ring-blue-500'
                : 'bg-white/5 hover:bg-white/8'
            }`}
          >
            <div className="flex items-center gap-3 mb-2">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm"
                style={{ background: agent.role.dnaMarkers.length > 0 ? `hsl(${agent.role.dnaMarkers[0] * 360}, 70%, 50%)` : '#3b82f6' }}
              >
                {agent.name.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm font-medium truncate">{agent.name}</p>
                <p className="text-slate-400 text-xs">{agent.role.name}</p>
              </div>
            </div>

            <div className="space-y-1 mb-2">
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">Energy</span>
                <span className={agent.energy > 50 ? 'text-emerald-400' : agent.energy > 20 ? 'text-amber-400' : 'text-red-400'}>
                  {agent.energy.toFixed(0)}%
                </span>
              </div>
              <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    agent.energy > 50 ? 'bg-emerald-500' : agent.energy > 20 ? 'bg-amber-500' : 'bg-red-500'
                  }`}
                  style={{ width: `${agent.energy}%` }}
                />
              </div>
            </div>

            <div className="flex justify-between text-xs text-slate-400">
              <span>Level {agent.level}</span>
              <span>Power {getAgentPower(agent).toFixed(0)}</span>
            </div>

            <div className="mt-2 flex flex-wrap gap-1">
              {agent.traits.map((trait) => (
                <span
                  key={trait.id}
                  className="px-1.5 py-0.5 rounded text-[10px] bg-white/10 text-slate-300"
                >
                  {trait.name}
                </span>
              ))}
            </div>

            <div className={`absolute top-2 right-2 w-2 h-2 rounded-full ${
              agent.status === 'working' ? 'bg-emerald-500 animate-pulse' :
              agent.status === 'resting' ? 'bg-amber-500' :
              agent.status === 'evolving' ? 'bg-purple-500 animate-pulse' :
              'bg-blue-500'
            }`} />
          </div>
        ))}
      </div>

      {selectedAgent && (
        <div className="bg-white/5 rounded-xl p-4 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-white">{selectedAgent.name}</h3>
            <button
              onClick={() => setSelectedAgent(null)}
              className="text-slate-400 hover:text-white"
            >
              Close
            </button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <div className="bg-white/5 rounded-lg p-3">
              <p className="text-slate-400 text-xs">Energy</p>
              <p className="text-white text-lg font-bold">{selectedAgent.energy.toFixed(1)}%</p>
            </div>
            <div className="bg-white/5 rounded-lg p-3">
              <p className="text-slate-400 text-xs">Experience</p>
              <p className="text-white text-lg font-bold">{selectedAgent.experience.toFixed(0)}</p>
            </div>
            <div className="bg-white/5 rounded-lg p-3">
              <p className="text-slate-400 text-xs">Level</p>
              <p className="text-white text-lg font-bold">{selectedAgent.level}</p>
            </div>
            <div className="bg-white/5 rounded-lg p-3">
              <p className="text-slate-400 text-xs">Efficiency</p>
              <p className="text-white text-lg font-bold">{(getAgentEfficiency(selectedAgent) * 100).toFixed(1)}%</p>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => handleEvolve(selectedAgent)}
              className="px-4 py-2 rounded-lg bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 transition"
            >
              Evolve
            </button>
            <button
              onClick={() => handleTrain(selectedAgent)}
              className="px-4 py-2 rounded-lg bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 transition"
            >
              Train
            </button>
            <button
              onClick={() => handleRest(selectedAgent)}
              className="px-4 py-2 rounded-lg bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 transition"
            >
              Rest
            </button>
          </div>
        </div>
      )}

      {evolutionLog.length > 0 && (
        <div className="bg-white/5 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-white mb-2">Evolution Log</h3>
          <div className="space-y-1 max-h-32 overflow-auto">
            {evolutionLog.map((log, i) => (
              <p key={i} className="text-xs text-slate-400">{log}</p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
